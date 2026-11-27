import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  APPOINTMENT_CONTRACT_VERSION,
  APPOINTMENT_STATUS_VALUES,
  isCalendarActionableStatus,
} from "../../domain/appointments/appointment";
import { AGENDA_TIME_ZONE } from "../../domain/availability/availability";
import {
  addCivilDays,
  civilDateOfInstant,
  civilWeekday,
  midnightToEpochMs,
} from "../../domain/calendar/civil_days";
import { conflictError, errResult, okResult, type ApiResult } from "../../domain/errors/api_error";

/**
 * Repositorio de ocupación de cupo (TI2-84, cruces de TI2-96).
 *
 * Capa de Infraestructura: único lugar que toca `ctx.db` en el flujo de
 * ocupación. No decide autorización ni resuelve identidad; solo
 * persiste/recupera con los índices declarados en `convex/schema.ts`,
 * consultando los campos en el orden del índice. La forma genérica del
 * puerto vive en `convex/application/appointments/occupancy.ts`.
 *
 * La adquisición es atómica: `occupySlotAtomically` lee la ocupación y
 * escribe la atención en la misma transacción, así dos intentos que se
 * cruzan crean como máximo una atención y el rechazo no deja ocupación
 * parcial. Una atención ocupa el intervalo `[inicio, fin)` de su
 * estudiante, de su profesional y, si trae sala, de su sala; dos atenciones
 * contiguas no se cruzan. Los cruces se buscan entre todas las atenciones
 * del recurso, sea cual sea su acompañamiento o profesional. Cambiar de
 * horario o de recursos usa la misma operación: valida el destino sin contar
 * la atención que se mueve y solo entonces la actualiza, así un destino
 * ocupado deja el origen intacto. El estado lo persiste
 * `persistAppointmentTransition` tras aplicar la política
 * (`applyAppointmentTransition`); el reagendamiento con fecha nueva queda
 * pendiente del caso de uso de cambio de TI2-109. El rechazo devuelve `conflict` (TI2-88) sin decir
 * qué recurso estaba ocupado ni por quién; `no_availability` queda para la
 * ausencia de cupo en búsqueda (TI2-98). No hay API pública ni tabla
 * `locks`/`reservations` paralela: la única representación es
 * `appointments`.
 *
 * Opera con datos ficticios.
 */

/** Contexto con lectura de base de datos (consultas y mutaciones). */
type DbReader = QueryCtx | MutationCtx;

/**
 * Duración máxima de una atención: 1440 minutos. Acota la lectura, porque una
 * atención que se cruza con `[inicio, fin)` empezó después de
 * `inicio - MAX_APPOINTMENT_MS`. Solo vale si toda atención se escribe por
 * `occupySlotAtomically`, que rechaza las más largas.
 */
export const MAX_APPOINTMENT_MS = 1440 * 60_000;

/**
 * Filas que se leen como máximo por recurso en esa ventana, canceladas
 * incluidas, porque el índice no distingue estados. La participación de un
 * profesional adicional se confirma con las atenciones activas de todo el
 * centro en la ventana (TI2-165), con el mismo tope. Con más filas la
 * ocupación responde `conflict` en vez de decidir con una lista cortada, que
 * podría esconder una atención activa. Límite técnico provisional, no un
 * requisito de CERETI.
 */
export const MAX_APPOINTMENTS_IN_WINDOW = 200;

/**
 * Estados que ocupan el cupo: todo salvo las cancelaciones, que lo liberan.
 * El conjunto completo de estados ya vive en el dominio
 * (`APPOINTMENT_STATUS_VALUES` de TI2-93, persistido por
 * `persistAppointmentTransition`); acá basta distinguir cancelado de no
 * cancelado para que un cupo liberado se pueda volver a ocupar.
 */
const CANCELLED_APPOINTMENT_STATUSES: ReadonlySet<Doc<"appointments">["status"]> = new Set([
  "cancelled_by_student",
  "cancelled_by_cereti",
]);

/** Estados que ocupan el cupo, para leer por índice solo las atenciones activas. */
const BLOCKING_APPOINTMENT_STATUSES = APPOINTMENT_STATUS_VALUES.filter(
  (status) => !CANCELLED_APPOINTMENT_STATUSES.has(status),
);

/** Verdadero cuando la atención existente sigue ocupando su cupo. */
function isBlocking(existing: Doc<"appointments">): boolean {
  return !CANCELLED_APPOINTMENT_STATUSES.has(existing.status);
}

/** Recurso que una atención ocupa durante su intervalo. */
type OccupiedResource =
  | { readonly kind: "student"; readonly id: Id<"users"> }
  | { readonly kind: "professional"; readonly id: Id<"users"> }
  | { readonly kind: "space"; readonly id: Id<"spaces"> };

/** Intervalo `[startsAt, endsAt)` con instantes epoch, como los guarda el esquema. */
interface Interval {
  readonly startsAt: number;
  readonly endsAt: number;
}

/**
 * Atenciones del recurso que empiezan dentro de la ventana que puede cruzarse
 * con el intervalo, hasta una fila más que el tope. Cada índice se consulta
 * con igualdad en el recurso y rango en el inicio, sin filtrar en memoria
 * fuera de la ventana. Leer el rango deja la ventana en el conjunto leído de
 * la transacción: un intento concurrente que escriba en ella obliga a
 * reintentar y la segunda pasada ya ve la atención nueva.
 */
async function readWindow(
  ctx: DbReader,
  resource: OccupiedResource,
  interval: Interval,
): Promise<Doc<"appointments">[]> {
  const from = interval.startsAt - MAX_APPOINTMENT_MS;
  const limit = MAX_APPOINTMENTS_IN_WINDOW + 1;
  switch (resource.kind) {
    case "student":
      return await ctx.db
        .query("appointments")
        .withIndex("by_studentId_and_startsAt", (q) =>
          q.eq("studentId", resource.id).gt("startsAt", from).lt("startsAt", interval.endsAt),
        )
        .take(limit);
    case "professional":
      return await ctx.db
        .query("appointments")
        .withIndex("by_professionalId_and_startsAt", (q) =>
          q.eq("professionalId", resource.id).gt("startsAt", from).lt("startsAt", interval.endsAt),
        )
        .take(limit);
    case "space":
      return await ctx.db
        .query("appointments")
        .withIndex("by_spaceId_and_startsAt", (q) =>
          q.eq("spaceId", resource.id).gt("startsAt", from).lt("startsAt", interval.endsAt),
        )
        .take(limit);
  }
}

/**
 * Verdadero cuando el recurso no está libre en el intervalo: alguna atención
 * que lo ocupa se cruza con él, o la ventana supera el tope y no se puede
 * decidir. Dos intervalos `[a, b)` y `[c, d)` se cruzan cuando `a < d` y
 * `c < b`; la consulta ya garantiza el primer lado. `ownId` es la atención
 * que se mueve: es la única que no cuenta como cruce, aunque sí ocupa lugar
 * en el tope.
 */
async function isResourceTaken(
  ctx: DbReader,
  resource: OccupiedResource,
  interval: Interval,
  ownId: Id<"appointments"> | null,
): Promise<boolean> {
  const rows = await readWindow(ctx, resource, interval);
  if (rows.length > MAX_APPOINTMENTS_IN_WINDOW) {
    return true;
  }
  return rows.some((row) => row._id !== ownId && isBlocking(row) && row.endsAt > interval.startsAt);
}

/**
 * Verdadero cuando el profesional no está libre en el intervalo (TI2-142).
 *
 * Un profesional ocupa su agenda como responsable (`appointments`) y como
 * participante (`appointmentProfessionals`); se revisan las dos vías porque
 * una atención anterior a la migración de TI2-138 todavía no tiene su fila de
 * participante. La fila de participante no guarda horario, porque
 * ATENCION_PROFESIONALES del MER no lo tiene (TI2-165): la participación se
 * confirma desde las atenciones activas del centro que se cruzan con el
 * intervalo, leídas por estado para que las canceladas no cuenten ni ocupen
 * el tope. Con más atenciones activas que el tope en la ventana responde
 * ocupado, como `isResourceTaken`, en vez de decidir con una lista cortada.
 */
async function isProfessionalTaken(
  ctx: DbReader,
  professionalId: Id<"users">,
  interval: Interval,
  ownId: Id<"appointments"> | null,
): Promise<boolean> {
  if (await isResourceTaken(ctx, { kind: "professional", id: professionalId }, interval, ownId)) {
    return true;
  }
  const from = interval.startsAt - MAX_APPOINTMENT_MS;
  let read = 0;
  for (const status of BLOCKING_APPOINTMENT_STATUSES) {
    const rows = await ctx.db
      .query("appointments")
      .withIndex("by_status_and_startsAt", (q) =>
        q.eq("status", status).gt("startsAt", from).lt("startsAt", interval.endsAt),
      )
      .take(MAX_APPOINTMENTS_IN_WINDOW + 1 - read);
    read += rows.length;
    if (read > MAX_APPOINTMENTS_IN_WINDOW) return true;
    for (const row of rows) {
      // Como responsable ya lo resolvió `isResourceTaken`.
      if (row._id === ownId || row.professionalId === professionalId) continue;
      if (row.endsAt <= interval.startsAt) continue;
      if ((await findAppointmentProfessional(ctx, row._id, professionalId)) !== null) return true;
    }
  }
  return false;
}

// ── TI2-138: profesionales participantes ───────────────────────────────────
//
// `appointments.professionalId` sigue siendo el profesional responsable
// principal. La tabla `appointmentProfessionals` registra el conjunto
// completo, sin horario: los cruces se leen de la atención (TI2-165). Acá se
// mantiene al crear o mover la atención; agregar o retirar participantes
// fuera de eso es de los
// casos de uso futuros.

/**
 * Tope técnico de filas de participantes leídas por atención; acota la lectura
 * y la escritura. No es la regla de negocio: cuántos profesionales admite una
 * atención lo fija `MAX_APPOINTMENT_PROFESSIONALS` del dominio (TI2-142), que
 * la reserva aplica antes de escribir.
 */
export const MAX_APPOINTMENT_PROFESSIONAL_ROWS = 200;

/** Fila del profesional en la atención, o `null` si no participa. */
export async function findAppointmentProfessional(
  ctx: DbReader,
  appointmentId: Id<"appointments">,
  professionalId: Id<"users">,
): Promise<Doc<"appointmentProfessionals"> | null> {
  const rows = await ctx.db
    .query("appointmentProfessionals")
    .withIndex("by_appointmentId_and_professionalId", (q) =>
      q.eq("appointmentId", appointmentId).eq("professionalId", professionalId),
    )
    .take(1);
  return rows[0] ?? null;
}

/** Participantes de la atención. */
export async function listAppointmentProfessionals(
  ctx: DbReader,
  appointmentId: Id<"appointments">,
): Promise<Doc<"appointmentProfessionals">[]> {
  return await ctx.db
    .query("appointmentProfessionals")
    .withIndex("by_appointmentId_and_professionalId", (q) => q.eq("appointmentId", appointmentId))
    .take(MAX_APPOINTMENT_PROFESSIONAL_ROWS);
}

/**
 * Registra al profesional en la atención si todavía no participa. No borra a
 * otros participantes porque solo los retira el caso de uso que los
 * administra. Al mover con otro responsable, la fila del anterior no se
 * conserva: la reemplaza `reassignAppointmentProfessional` antes. Devuelve
 * `true` cuando insertó la fila que faltaba.
 */
export async function syncAppointmentProfessional(
  ctx: MutationCtx,
  input: {
    readonly appointmentId: Id<"appointments">;
    readonly professionalId: Id<"users">;
  },
): Promise<boolean> {
  const existing = await findAppointmentProfessional(
    ctx,
    input.appointmentId,
    input.professionalId,
  );
  if (existing !== null) return false;
  await ctx.db.insert("appointmentProfessionals", {
    appointmentId: input.appointmentId,
    professionalId: input.professionalId,
  });
  return true;
}

/**
 * Cambia el responsable de una atención trasladada sin dejar al anterior como
 * participante. Su fila pasa a ser la del nuevo profesional; si el nuevo ya
 * participaba, la fila anterior se retira para no duplicarlo. Así el anterior
 * deja de figurar en una atención que ya no es suya y no aparece ocupado en un
 * horario que nunca aceptó. Devuelve `true` cuando encontró la fila anterior.
 */
export async function reassignAppointmentProfessional(
  ctx: MutationCtx,
  input: {
    readonly appointmentId: Id<"appointments">;
    readonly previousProfessionalId: Id<"users">;
    readonly professionalId: Id<"users">;
  },
): Promise<boolean> {
  if (input.previousProfessionalId === input.professionalId) return false;
  const previous = await findAppointmentProfessional(
    ctx,
    input.appointmentId,
    input.previousProfessionalId,
  );
  if (previous === null) return false;
  const next = await findAppointmentProfessional(ctx, input.appointmentId, input.professionalId);
  if (next === null) {
    await ctx.db.patch(previous._id, { professionalId: input.professionalId });
  } else {
    await ctx.db.delete(previous._id);
  }
  return true;
}

/**
 * Entrada de la ocupación con identificadores Convex.
 */
export interface OccupySlotRow {
  readonly accompanimentId: Id<"accompaniments">;
  readonly studentId: Id<"users">;
  readonly professionalId: Id<"users">;
  readonly modality: Doc<"appointments">["modality"];
  readonly spaceId?: Id<"spaces">;
  readonly startsAt: number;
  readonly endsAt: number;
  /**
   * Referencia del acceso privado de la atención en línea (TI2-138).
   * Opcional: las atenciones presenciales no la usan. Solo se persiste al
   * crear.
   */
  readonly privateAccessReference?: string;
  /**
   * Profesionales que acompañan al responsable (TI2-142), ya normalizados por
   * la reserva. Al crear, cada uno debe estar libre y queda registrado como
   * participante. Al mover se ignoran: los participantes guardados siguen a la
   * atención y se comprueban todos.
   */
  readonly additionalProfessionalIds?: ReadonlyArray<Id<"users">>;
  /**
   * Profesionales adicionales que salen de la atención al moverla (TI2-142),
   * porque ya no son reservables: no se comprueban sus cruces y su fila de
   * participante se retira. Al crear se ignora.
   */
  readonly removedProfessionalIds?: ReadonlyArray<Id<"users">>;
  /**
   * Atención que se cambia de horario o de recursos. Tiene que seguir
   * ocupando su cupo y ser del mismo estudiante y acompañamiento; sin ella
   * se crea una atención nueva.
   */
  readonly movedAppointmentId?: Id<"appointments">;
  /**
   * Fecha original del primer agendamiento ya calculada por la política de
   * TI2-93 (`transitionAppointment`) y entregada por quien la aplicó. Ausente,
   * el campo que hubiera en la fila no se toca: un cambio de recursos no marca
   * reagendamiento, y en reagendamientos encadenados quien aplica la política
   * entrega siempre la primera fecha.
   */
  readonly originalStartsAt?: number;
  /**
   * Estado resultante de la transición ya aplicada por el caso de uso. Ausente,
   * el estado vigente se conserva: marcar `rescheduled` es de quien aplica la
   * política, no del repositorio.
   */
  readonly nextStatus?: Doc<"appointments">["status"];
}

/**
 * Atención que el cambio mueve: `null` cuando se crea una nueva e `"invalid"`
 * cuando la indicada no existe, ya no ocupa su cupo o es de otro estudiante o
 * acompañamiento. El id se normaliza, así uno de otra tabla responde igual
 * que uno inexistente.
 */
async function findMovedAppointment(
  ctx: DbReader,
  input: OccupySlotRow,
): Promise<Doc<"appointments"> | null | "invalid"> {
  if (input.movedAppointmentId === undefined) {
    return null;
  }
  const id = ctx.db.normalizeId("appointments", input.movedAppointmentId);
  const moved = id === null ? null : await ctx.db.get(id);
  if (
    moved === null ||
    !isBlocking(moved) ||
    moved.studentId !== input.studentId ||
    moved.accompanimentId !== input.accompanimentId
  ) {
    return "invalid";
  }
  return moved;
}

/**
 * Profesionales que deben estar libres en el destino, sin repetir (TI2-142).
 *
 * Al crear son el responsable y los adicionales pedidos. Al mover son los
 * participantes guardados de la atención, con el responsable nuevo en lugar
 * del anterior y sin los que salen, porque el traslado conserva a los demás
 * profesionales. `null`
 * cuando la atención tiene más participantes que el tope de lectura y no se
 * puede decidir.
 */
async function professionalsToCheck(
  ctx: DbReader,
  input: OccupySlotRow,
  moved: Doc<"appointments"> | null,
): Promise<Id<"users">[] | null> {
  if (moved === null) {
    return [...new Set([input.professionalId, ...(input.additionalProfessionalIds ?? [])])];
  }
  const participants = await listAppointmentProfessionals(ctx, moved._id);
  if (participants.length >= MAX_APPOINTMENT_PROFESSIONAL_ROWS) return null;
  const leaving = new Set<Id<"users">>([
    moved.professionalId,
    ...(input.removedProfessionalIds ?? []),
  ]);
  const kept = participants
    .map((row) => row.professionalId)
    .filter((professionalId) => !leaving.has(professionalId));
  return [...new Set([input.professionalId, ...kept])];
}

/**
 * Ocupa el cupo de forma atómica: lee la ocupación y escribe la atención en
 * la misma transacción. Si el estudiante, el profesional o la sala ya están
 * ocupados en el intervalo devuelve el error estable `conflict` sin escribir
 * nada; si están libres inserta la atención en estado `scheduled` y devuelve
 * su identificador. El intervalo se valida en el servidor sin confiar en el
 * cliente. La sala se comprueba cuando la atención trae una; que la
 * modalidad la exija o la prohíba es de la compatibilidad de TI2-82.
 *
 * Con `movedAppointmentId` cambia esa atención en el mismo lugar: la busca,
 * valida el destino sin contarla a ella y recién entonces le escribe el
 * horario, el profesional, la modalidad y la sala nuevos. Conserva su
 * identificador y fecha de creación. La fecha original (`originalStartsAt`) y
 * el estado resultante solo se guardan si quien llamó los entrega, tras
 * aplicar la política de TI2-93 (`transitionAppointment`): un cambio de
 * recursos sin reagendamiento no los toca, así Web y Mobile no muestran una
 * atención reagendada que no lo está. La política decide qué transición
 * admite el cambio y el estado que produce lo persiste
 * `persistAppointmentTransition` (estado, `cancelReason` y
 * `originalStartsAt`); el reagendamiento con fecha nueva queda pendiente del
 * caso de uso de cambio de TI2-109. Una atención inexistente, cancelada o de
 * otro estudiante o acompañamiento responde `conflict` sin escribir.
 */
export async function occupySlotAtomically(
  ctx: MutationCtx,
  input: OccupySlotRow,
): Promise<ApiResult<{ appointmentId: Id<"appointments"> }>> {
  if (!Number.isFinite(input.startsAt) || !Number.isFinite(input.endsAt)) {
    throw new Error("El cupo requiere un inicio y un fin finitos");
  }
  if (input.startsAt >= input.endsAt) {
    throw new Error("El fin del cupo debe ser posterior a su inicio");
  }
  if (input.endsAt - input.startsAt > MAX_APPOINTMENT_MS) {
    throw new Error("El cupo no puede durar más de 1440 minutos");
  }
  if (input.originalStartsAt !== undefined && !Number.isFinite(input.originalStartsAt)) {
    throw new Error("La fecha original del cupo debe ser un instante finito");
  }
  const resources: OccupiedResource[] = [{ kind: "student", id: input.studentId }];
  if (input.spaceId !== undefined) {
    resources.push({ kind: "space", id: input.spaceId });
  }
  const moved = await findMovedAppointment(ctx, input);
  if (moved === "invalid") {
    return errResult(conflictError());
  }
  const ownId = moved === null ? null : moved._id;
  const professionalIds = await professionalsToCheck(ctx, input, moved);
  if (professionalIds === null) {
    return errResult(conflictError());
  }
  for (const professionalId of professionalIds) {
    if (await isProfessionalTaken(ctx, professionalId, input, ownId)) {
      return errResult(conflictError());
    }
  }
  for (const resource of resources) {
    if (await isResourceTaken(ctx, resource, input, ownId)) {
      return errResult(conflictError());
    }
  }
  if (moved !== null) {
    // `spaceId: undefined` borra la sala cuando el destino es en línea.
    await ctx.db.patch(moved._id, {
      professionalId: input.professionalId,
      spaceId: input.spaceId,
      modality: input.modality,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      // La fecha original y el estado ya los calculó la política de TI2-93 en
      // el caso de uso; acá se guardan tal cual, y sin ellos la fila conserva
      // lo suyo: un cambio de recursos no marca reagendamiento ni toca la
      // fecha original que exista.
      ...(input.originalStartsAt === undefined ? {} : { originalStartsAt: input.originalStartsAt }),
      ...(input.nextStatus === undefined ? {} : { status: input.nextStatus }),
    });
    // Si el traslado cambia al responsable, la fila del anterior pasa a ser la
    // del nuevo: no queda ocupado en un horario que nunca aceptó.
    await reassignAppointmentProfessional(ctx, {
      appointmentId: moved._id,
      previousProfessionalId: moved.professionalId,
      professionalId: input.professionalId,
    });
    // Los adicionales que ya no son reservables salen con el mismo cambio. El
    // responsable nuevo nunca está entre ellos: el caso de uso lo excluye.
    for (const professionalId of input.removedProfessionalIds ?? []) {
      if (professionalId === input.professionalId) continue;
      const row = await findAppointmentProfessional(ctx, moved._id, professionalId);
      if (row !== null) await ctx.db.delete(row._id);
    }
    await syncAppointmentProfessional(ctx, {
      appointmentId: moved._id,
      professionalId: input.professionalId,
    });
    return okResult({ appointmentId: moved._id });
  }
  const appointmentId = await ctx.db.insert("appointments", {
    accompanimentId: input.accompanimentId,
    studentId: input.studentId,
    professionalId: input.professionalId,
    ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
    modality: input.modality,
    status: "scheduled",
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    ...(input.privateAccessReference === undefined
      ? {}
      : { privateAccessReference: input.privateAccessReference }),
    createdAt: Date.now(),
  });
  for (const professionalId of [input.professionalId, ...(input.additionalProfessionalIds ?? [])]) {
    await syncAppointmentProfessional(ctx, { appointmentId, professionalId });
  }
  return okResult({ appointmentId });
}

/**
 * Valida que la cadena sea un identificador de `appointments` sin revelar
 * existencia: `null` cuando no pertenece a la tabla.
 */
export function normalizeAppointmentId(ctx: DbReader, raw: string): Id<"appointments"> | null {
  return ctx.db.normalizeId("appointments", raw);
}

/** La atención con ese identificador, o `null` cuando no existe. */
export async function getAppointmentById(
  ctx: DbReader,
  id: Id<"appointments">,
): Promise<Doc<"appointments"> | null> {
  return await ctx.db.get(id);
}

/** Campos de la transición ya aplicada: solo los que la política produjo. */
export interface PersistedAppointmentTransition {
  readonly status: Doc<"appointments">["status"];
  readonly cancelReason?: string;
  readonly originalStartsAt?: number;
  readonly justificationExplanation?: string;
  readonly justificationSubmittedAt?: number;
  readonly justificationReview?: Doc<"appointments">["justificationReview"];
  readonly justificationReviewExplanation?: string;
  readonly supportingDocumentReceived?: boolean;
}

/**
 * Guarda el resultado de una transición ya aplicada por la política de
 * TI2-93: el estado y, solo si la política los produjo, el motivo de
 * cancelación y la fecha original. Única vía de escritura de cambio de
 * estado fuera de la ocupación (`occupySlotAtomically`); la llamada la hace
 * el caso de uso de TI2-107 tras aplicar `transitionAppointment`, así ningún
 * consumidor decide qué campos cuadrar.
 */
export async function persistAppointmentTransition(
  ctx: MutationCtx,
  id: Id<"appointments">,
  fields: PersistedAppointmentTransition,
): Promise<void> {
  await ctx.db.patch(id, {
    status: fields.status,
    ...(fields.cancelReason === undefined ? {} : { cancelReason: fields.cancelReason }),
    ...(fields.originalStartsAt === undefined ? {} : { originalStartsAt: fields.originalStartsAt }),
    ...(fields.justificationExplanation === undefined
      ? {}
      : { justificationExplanation: fields.justificationExplanation }),
    ...(fields.justificationSubmittedAt === undefined
      ? {}
      : { justificationSubmittedAt: fields.justificationSubmittedAt }),
    ...(fields.justificationReview === undefined
      ? {}
      : { justificationReview: fields.justificationReview }),
    ...(fields.justificationReviewExplanation === undefined
      ? {}
      : { justificationReviewExplanation: fields.justificationReviewExplanation }),
    ...(fields.supportingDocumentReceived === undefined
      ? {}
      : { supportingDocumentReceived: fields.supportingDocumentReceived }),
  });
}

/**
 * Adaptador de lectura y persistencia de transiciones de atención para la capa de Aplicación.
 */
export function appointmentTransitionRepository(ctx: MutationCtx) {
  return {
    reader: {
      normalizeAppointmentId: (raw: string) => {
        const id = normalizeAppointmentId(ctx, raw);
        return id === null ? null : (id as unknown as string);
      },
      getAppointmentById: async (id: string) => {
        const convexId = normalizeAppointmentId(ctx, id);
        if (convexId === null) return null;
        const doc = await getAppointmentById(ctx, convexId);
        if (doc === null) return null;
        return {
          status: doc.status,
          startsAt: doc.startsAt,
          ...(doc.originalStartsAt === undefined ? {} : { originalStartsAt: doc.originalStartsAt }),
          ...(doc.justificationExplanation === undefined
            ? {}
            : { justificationExplanation: doc.justificationExplanation }),
          ...(doc.justificationSubmittedAt === undefined
            ? {}
            : { justificationSubmittedAt: doc.justificationSubmittedAt }),
          ...(doc.justificationReview === undefined
            ? {}
            : { justificationReview: doc.justificationReview }),
          ...(doc.justificationReviewExplanation === undefined
            ? {}
            : { justificationReviewExplanation: doc.justificationReviewExplanation }),
          ...(doc.supportingDocumentReceived === undefined
            ? {}
            : { supportingDocumentReceived: doc.supportingDocumentReceived }),
        };
      },
    },
    persister: {
      persistAppointmentTransition: async (
        id: string,
        fields: {
          readonly status: Doc<"appointments">["status"];
          readonly cancelReason?: string;
          readonly originalStartsAt?: number;
          readonly justificationExplanation?: string;
          readonly justificationSubmittedAt?: number;
          readonly justificationReview?: Doc<"appointments">["justificationReview"];
          readonly justificationReviewExplanation?: string;
          readonly supportingDocumentReceived?: boolean;
        },
      ) => {
        const convexId = normalizeAppointmentId(ctx, id);
        if (convexId === null) {
          throw new Error("Invalid appointment ID");
        }
        await persistAppointmentTransition(ctx, convexId, fields);
      },
    },
  };
}

// ── TI2-111: adaptadores de los puertos de búsqueda y reserva ───────────────
//
// Cumplen por forma `SlotOccupancyReader` (TI2-97) y `AppointmentOccupier`
// (TI2-84) sin importar Aplicación. Traducen el vocabulario del contrato
// (`startAt`/`endAt` e identificadores de texto) al de este repositorio.

/**
 * Ocupación para la búsqueda: el cupo está ocupado cuando el profesional (como
 * responsable o participante), el estudiante o la sala ya tienen una atención
 * que lo cruza, los mismos
 * recursos y la misma lectura por ventana que `occupySlotAtomically`. Una
 * ventana sobre el tope o un identificador que no es de su tabla cuentan como
 * ocupados, así la búsqueda no ofrece un cupo que la reserva rechazaría.
 */
export function slotOccupancyReader(ctx: DbReader) {
  return {
    isSlotOccupied: async (slot: {
      readonly professionalId: string;
      readonly studentId: string;
      readonly spaceId?: string;
      readonly startAt: number;
      readonly endAt: number;
    }) => {
      const professionalId = ctx.db.normalizeId("users", slot.professionalId);
      const studentId = ctx.db.normalizeId("users", slot.studentId);
      const spaceId =
        slot.spaceId === undefined ? undefined : ctx.db.normalizeId("spaces", slot.spaceId);
      if (professionalId === null || studentId === null || spaceId === null) return true;
      const interval = { startsAt: slot.startAt, endsAt: slot.endAt };
      // El profesional se revisa como responsable y como participante, con la
      // misma comprobación que la reserva (TI2-142): así la búsqueda no ofrece
      // un cupo que la reserva rechazaría por una atención coordinada.
      if (await isProfessionalTaken(ctx, professionalId, interval, null)) return true;
      const resources: OccupiedResource[] = [{ kind: "student", id: studentId }];
      if (spaceId !== undefined) {
        resources.push({ kind: "space", id: spaceId });
      }
      for (const resource of resources) {
        if (await isResourceTaken(ctx, resource, interval, null)) return true;
      }
      return false;
    },
  };
}

// ── TI2-121: lectura de la atención que se cambia ─────────────────────────
//
// Cumple por forma el puerto `AppointmentChangeReader` (TI2-109/TI2-110) sin
// importar Aplicación. Traduce el vocabulario del contrato (`startAt`/`endAt`
// e identificadores de texto) al de este repositorio.

/**
 * Lectura de la atención que se cambia. Un identificador que no pertenece a
 * `appointments` responde igual que uno inexistente: `null`.
 */
export function appointmentChangeReader(ctx: DbReader) {
  return {
    getAppointment: async (appointmentId: string) => {
      const id = normalizeAppointmentId(ctx, appointmentId);
      const doc = id === null ? null : await getAppointmentById(ctx, id);
      if (doc === null) return null;
      const additionalProfessionalIds = await additionalProfessionalIdsOf(ctx, doc);
      return {
        id: doc._id,
        accompanimentId: doc.accompanimentId,
        studentId: doc.studentId,
        professionalId: doc.professionalId,
        status: doc.status,
        startAt: doc.startsAt,
        endAt: doc.endsAt,
        ...(doc.originalStartsAt === undefined ? {} : { originalStartAt: doc.originalStartsAt }),
        ...(doc.justificationExplanation === undefined
          ? {}
          : { justificationExplanation: doc.justificationExplanation }),
        ...(doc.justificationSubmittedAt === undefined
          ? {}
          : { justificationSubmittedAt: doc.justificationSubmittedAt }),
        ...(doc.justificationReview === undefined
          ? {}
          : { justificationReview: doc.justificationReview }),
        ...(doc.justificationReviewExplanation === undefined
          ? {}
          : { justificationReviewExplanation: doc.justificationReviewExplanation }),
        ...(doc.supportingDocumentReceived === undefined
          ? {}
          : { supportingDocumentReceived: doc.supportingDocumentReceived }),
        ...(additionalProfessionalIds.length === 0 ? {} : { additionalProfessionalIds }),
      };
    },
  };
}

/**
 * Lote acotado de inasistencias pendientes para el barrido de vencimiento
 * (TI2-147). Pagina por `by_status_and_startsAt` con el cursor del índice, de
 * la más antigua a la más reciente: las filas que no se pueden cerrar quedan
 * atrás y no bloquean a las siguientes. `isDone` cierra la cadena de
 * continuaciones sin programar continuaciones infinitas.
 */
export function pendingJustificationsReader(ctx: DbReader) {
  return {
    listPendingJustifications: async ({
      cursor,
      limit,
    }: {
      readonly cursor: string | null;
      readonly limit: number;
    }) => {
      const page = await ctx.db
        .query("appointments")
        .withIndex("by_status_and_startsAt", (q) => q.eq("status", "no_show"))
        .paginate({ numItems: limit, cursor });
      const pending = [];
      for (const row of page.page) {
        const additionalProfessionalIds = await additionalProfessionalIdsOf(ctx, row);
        pending.push({
          id: row._id as string,
          accompanimentId: row.accompanimentId as string,
          studentId: row.studentId as string,
          professionalId: row.professionalId as string,
          status: row.status,
          startAt: row.startsAt,
          ...(row.originalStartsAt === undefined ? {} : { originalStartAt: row.originalStartsAt }),
          ...(row.justificationSubmittedAt === undefined
            ? {}
            : { justificationSubmittedAt: row.justificationSubmittedAt }),
          ...(additionalProfessionalIds.length === 0 ? {} : { additionalProfessionalIds }),
        });
      }
      return { rows: pending, cursor: page.continueCursor, isDone: page.isDone };
    },
  };
}

/**
 * Profesionales de la atención distintos del responsable, en el orden del
 * índice. Una atención sin filas de participante (anterior a la migración) no
 * tiene adicionales.
 */
async function additionalProfessionalIdsOf(
  ctx: DbReader,
  doc: Doc<"appointments">,
): Promise<Id<"users">[]> {
  const rows = await listAppointmentProfessionals(ctx, doc._id);
  return rows
    .map((row) => row.professionalId)
    .filter((professionalId) => professionalId !== doc.professionalId);
}

// ── TI2-142: acceso privado de la atención en línea ────────────────────────

/**
 * Lectura y escritura del enlace privado de la atención. Cumple por forma
 * `OnlineAccessStore` de Aplicación sin importarla. La lectura entrega los
 * profesionales adicionales para autorizar a todos los participantes; la
 * reutilización se comprueba con el índice `by_privateAccessReference`.
 */
export function onlineAccessStore(ctx: MutationCtx) {
  return {
    ...onlineAccessReader(ctx),
    isReferenceInUse: async (reference: string, exceptAppointmentId: string) => {
      const rows = await ctx.db
        .query("appointments")
        .withIndex("by_privateAccessReference", (q) => q.eq("privateAccessReference", reference))
        .take(2);
      return rows.some((row) => row._id !== exceptAppointmentId);
    },
    saveReference: async (appointmentId: string, reference: string) => {
      const id = normalizeAppointmentId(ctx, appointmentId);
      if (id === null) throw new Error("La atención del enlace privado no existe.");
      await ctx.db.patch(id, { privateAccessReference: reference });
    },
  };
}

/** Lectura del acceso en línea para las consultas, sin escritura. */
export function onlineAccessReader(ctx: DbReader) {
  return {
    getAppointment: async (appointmentId: string) => {
      const id = normalizeAppointmentId(ctx, appointmentId);
      const doc = id === null ? null : await getAppointmentById(ctx, id);
      if (doc === null) return null;
      return {
        id: doc._id,
        accompanimentId: doc.accompanimentId,
        studentId: doc.studentId,
        professionalId: doc.professionalId,
        additionalProfessionalIds: await additionalProfessionalIdsOf(ctx, doc),
        modality: doc.modality,
        status: doc.status,
        ...(doc.privateAccessReference === undefined
          ? {}
          : { privateAccessReference: doc.privateAccessReference }),
      };
    },
  };
}

// ── TI2-122: lectura y referencia del evento de calendario ─────────────────
//
// Cumplen por forma los puertos de calendario de Aplicación sin importarla.
// La lectura de la atención devuelve la pertenencia que autoriza el caso de
// uso y la referencia ya guardada; el listado se acota por el índice del
// acompañamiento y no expone profesional, sala ni notas.

/**
 * Lectura de una atención para el calendario. Un identificador que no
 * pertenece a `appointments` responde igual que uno inexistente: `null`.
 */
export function appointmentCalendarReader(ctx: DbReader) {
  return {
    getAppointment: async (appointmentId: string) => {
      const id = normalizeAppointmentId(ctx, appointmentId);
      const doc = id === null ? null : await getAppointmentById(ctx, id);
      if (doc === null) return null;
      return {
        _id: doc._id,
        accompanimentId: doc.accompanimentId,
        studentId: doc.studentId,
        professionalId: doc.professionalId,
        status: doc.status,
        startAt: doc.startsAt,
        endAt: doc.endsAt,
        createdAt: doc.createdAt,
        ...(doc.calendarEventId === undefined ? {} : { calendarEventId: doc.calendarEventId }),
        ...(doc.calendarEventAddedAt === undefined
          ? {}
          : { calendarEventAddedAt: doc.calendarEventAddedAt }),
        ...(doc.calendarEventStartsAt === undefined
          ? {}
          : { calendarEventStartsAt: doc.calendarEventStartsAt }),
        ...(doc.calendarEventEndsAt === undefined
          ? {}
          : { calendarEventEndsAt: doc.calendarEventEndsAt }),
      };
    },
  };
}

/** Tope de atenciones leídas de un acompañamiento para decidir su cierre. */
export const MAX_ACCOMPANIMENT_APPOINTMENTS = 500;

/**
 * Atenciones vigentes (agendadas o con cambio de horario) del acompañamiento
 * (TI2-152). Cumple por forma el puerto `PendingAppointmentsReader` de
 * Aplicación sin importarla. No hay índice por estado, así que lee todas las
 * atenciones del acompañamiento hasta el tope y entrega `complete: false`
 * cuando lo supera, para que el cierre se rechace en vez de dejar atenciones
 * vigentes sin revisar.
 */
export function pendingAppointmentsReader(ctx: DbReader) {
  return {
    listPendingAppointments: async (accompanimentId: string) => {
      const id = ctx.db.normalizeId("accompaniments", accompanimentId);
      if (id === null) return { complete: true, appointments: [] };
      const rows = await ctx.db
        .query("appointments")
        .withIndex("by_accompanimentId_and_startsAt", (q) => q.eq("accompanimentId", id))
        .take(MAX_ACCOMPANIMENT_APPOINTMENTS + 1);
      const appointments = [];
      for (const row of rows) {
        if (!isCalendarActionableStatus(row.status)) continue;
        // Los participantes van con la atención: la cancelación por cierre
        // avisa también a los profesionales adicionales (TI2-150).
        const additionalProfessionalIds = await additionalProfessionalIdsOf(ctx, row);
        appointments.push({
          id: row._id as string,
          studentId: row.studentId as string,
          professionalId: row.professionalId as string,
          status: row.status,
          startAt: row.startsAt,
          ...(row.originalStartsAt === undefined ? {} : { originalStartAt: row.originalStartsAt }),
          ...(additionalProfessionalIds.length === 0 ? {} : { additionalProfessionalIds }),
        });
      }
      return { complete: rows.length <= MAX_ACCOMPANIMENT_APPOINTMENTS, appointments };
    },
  };
}

/**
 * Listado acotado de atenciones del acompañamiento, de la más reciente a la
 * más antigua. La autorización ya la resolvió Aplicación con
 * `appointment:read`; acá solo se recorta la forma para el portal.
 */
export function appointmentListReader(ctx: DbReader) {
  return {
    listByAccompaniment: async (input: {
      readonly accompanimentId: string;
      readonly limit: number;
    }) => {
      const accompanimentId = ctx.db.normalizeId("accompaniments", input.accompanimentId);
      if (accompanimentId === null) return [];
      const rows = await ctx.db
        .query("appointments")
        .withIndex("by_accompanimentId_and_startsAt", (q) =>
          q.eq("accompanimentId", accompanimentId),
        )
        .order("desc")
        .take(input.limit);
      return rows.map((row) => {
        const referenceIsCurrent =
          row.calendarEventId !== undefined &&
          row.calendarEventStartsAt === row.startsAt &&
          row.calendarEventEndsAt === row.endsAt;
        return {
          appointmentId: row._id,
          status: row.status,
          startAt: row.startsAt,
          endAt: row.endsAt,
          modality: row.modality,
          calendarAdded: referenceIsCurrent,
          calendarNeedsUpdate: row.calendarEventId !== undefined && !referenceIsCurrent,
          // Estado de sincronización automática (TI2-162): ausente en filas
          // anteriores a TI2-145; `pending` no pide nada cuando nadie vinculó
          // y `error/not_connected` pide volver a vincular.
          ...(row.calendarSyncStatus === undefined
            ? {}
            : { calendarSyncStatus: row.calendarSyncStatus }),
          ...(row.calendarSyncErrorCode === undefined
            ? {}
            : { calendarSyncErrorCode: row.calendarSyncErrorCode }),
        };
      });
    },
  };
}

/**
 * Guarda la referencia del evento creado o actualizado por TI2-122 y TI2-162.
 * Solo la llama la mutación interna que compone la acción después de un
 * resultado exitoso del proveedor; un reintento con el mismo identificador
 * determinista no duplica el evento aunque esta escritura se repita. El
 * horario guardado es el que realmente tiene el evento: al reagendar la
 * atención después, la referencia conserva el horario anterior y queda
 * obsoleta. `ownerId` guarda de qué calendario es el evento (el `subject` de
 * Better Auth que lo creó) para que actualizar y eliminar usen siempre ese
 * calendario; cuando llega, reemplaza al anterior.
 */
export async function recordCalendarEvent(
  ctx: MutationCtx,
  appointmentId: Id<"appointments">,
  input: {
    readonly eventId: string;
    readonly addedAt: number;
    readonly startsAt: number;
    readonly endsAt: number;
    readonly ownerId?: string;
  },
): Promise<void> {
  await ctx.db.patch(appointmentId, {
    calendarEventId: input.eventId,
    calendarEventAddedAt: input.addedAt,
    calendarEventStartsAt: input.startsAt,
    calendarEventEndsAt: input.endsAt,
    ...(input.ownerId === undefined ? {} : { calendarEventOwnerId: input.ownerId }),
  });
}

/**
 * Escritura atómica para la reserva y el reagendamiento sobre
 * `occupySlotAtomically`. Un identificador que no es de su tabla responde
 * `conflict` sin escribir, en vez de llegar a la base con otra forma. El
 * reagendamiento mueve la misma fila con `movedAppointmentId`.
 */
export function appointmentOccupier(ctx: MutationCtx) {
  return {
    occupySlot: async (slot: {
      readonly accompanimentId: string;
      readonly studentId: string;
      readonly professionalId: string;
      readonly modality: Doc<"appointments">["modality"];
      readonly spaceId?: string;
      readonly startAt: number;
      readonly endAt: number;
      readonly privateAccessReference?: string;
      readonly additionalProfessionalIds?: readonly string[];
      readonly removedProfessionalIds?: readonly string[];
      readonly movedAppointmentId?: string;
    }): Promise<ApiResult<{ appointmentId: string }>> => {
      const additionalProfessionalIds = (slot.additionalProfessionalIds ?? []).map((id) =>
        ctx.db.normalizeId("users", id),
      );
      const removedProfessionalIds = (slot.removedProfessionalIds ?? []).map((id) =>
        ctx.db.normalizeId("users", id),
      );
      const accompanimentId = ctx.db.normalizeId("accompaniments", slot.accompanimentId);
      const studentId = ctx.db.normalizeId("users", slot.studentId);
      const professionalId = ctx.db.normalizeId("users", slot.professionalId);
      const spaceId =
        slot.spaceId === undefined ? undefined : ctx.db.normalizeId("spaces", slot.spaceId);
      const movedAppointmentId =
        slot.movedAppointmentId === undefined
          ? undefined
          : ctx.db.normalizeId("appointments", slot.movedAppointmentId);
      if (
        accompanimentId === null ||
        studentId === null ||
        professionalId === null ||
        spaceId === null ||
        movedAppointmentId === null ||
        additionalProfessionalIds.includes(null) ||
        removedProfessionalIds.includes(null)
      ) {
        return errResult(conflictError());
      }
      return await occupySlotAtomically(ctx, {
        accompanimentId,
        studentId,
        professionalId,
        modality: slot.modality,
        ...(spaceId === undefined ? {} : { spaceId }),
        startsAt: slot.startAt,
        endsAt: slot.endAt,
        ...(slot.privateAccessReference === undefined
          ? {}
          : { privateAccessReference: slot.privateAccessReference }),
        ...(additionalProfessionalIds.length === 0
          ? {}
          : {
              additionalProfessionalIds: additionalProfessionalIds.filter(
                (id): id is Id<"users"> => id !== null,
              ),
            }),
        ...(removedProfessionalIds.length === 0
          ? {}
          : {
              removedProfessionalIds: removedProfessionalIds.filter(
                (id): id is Id<"users"> => id !== null,
              ),
            }),
        ...(movedAppointmentId === undefined ? {} : { movedAppointmentId }),
      });
    },
  };
}

// ── TI2-112: lectura de la agenda y del detalle ─────────────────────────────
//
// Cumple por forma `AppointmentAgendaReader` sin importar Aplicación. Traduce
// al vocabulario del contrato (`startAt`/`endAt` e identificadores de texto),
// no decide autorización y no entrega `studentId`.

/**
 * Tope de atenciones por rango. Superarlo responde `conflict` en vez de
 * truncar: una agenda cortada escondería atenciones sin aviso. Es provisional,
 * igual que el rango de hasta `MAX_EXPANSION_DAYS` días que acota.
 */
export const MAX_APPOINTMENTS_IN_RANGE = 300;

/** Atención en el vocabulario del contrato, sin claves `undefined`. */
function toAgendaAppointment(doc: Doc<"appointments">) {
  return {
    id: doc._id,
    accompanimentId: doc.accompanimentId,
    professionalId: doc.professionalId,
    modality: doc.modality,
    ...(doc.spaceId === undefined ? {} : { spaceId: doc.spaceId }),
    startAt: doc.startsAt,
    endAt: doc.endsAt,
    ...(doc.originalStartsAt === undefined ? {} : { originalStartAt: doc.originalStartsAt }),
    ...(doc.cancelReason === undefined ? {} : { cancelReason: doc.cancelReason }),
    ...(doc.justificationExplanation === undefined
      ? {}
      : { justificationExplanation: doc.justificationExplanation }),
    ...(doc.justificationSubmittedAt === undefined
      ? {}
      : { justificationSubmittedAt: doc.justificationSubmittedAt }),
    ...(doc.justificationReview === undefined
      ? {}
      : { justificationReview: doc.justificationReview }),
    ...(doc.justificationReviewExplanation === undefined
      ? {}
      : { justificationReviewExplanation: doc.justificationReviewExplanation }),
    ...(doc.supportingDocumentReceived === undefined
      ? {}
      : { supportingDocumentReceived: doc.supportingDocumentReceived }),
    status: doc.status,
    version: APPOINTMENT_CONTRACT_VERSION,
  };
}

/** Las lecturas piden una fila de más: si llega, el rango superó el tope. */
function agendaRangeResult(
  rows: readonly Doc<"appointments">[],
): ApiResult<ReadonlyArray<ReturnType<typeof toAgendaAppointment>>> {
  if (rows.length > MAX_APPOINTMENTS_IN_RANGE) return errResult(conflictError());
  return okResult(rows.map(toAgendaAppointment));
}

/** Intervalo `[startAt, endAt)` de la lectura, con el fin excluido. */
type AgendaRange = { readonly startAt: number; readonly endAt: number };

/**
 * Atenciones que empiezan dentro del intervalo, en orden de inicio, por
 * estudiante, profesional o acompañamiento, más la lectura por id. Un
 * identificador que no pertenece a su tabla responde igual que uno sin
 * atenciones.
 */
export function appointmentAgendaReader(ctx: DbReader) {
  return {
    listByStudent: async (studentId: string, range: AgendaRange) => {
      const id = ctx.db.normalizeId("users", studentId);
      if (id === null) return agendaRangeResult([]);
      return agendaRangeResult(
        await ctx.db
          .query("appointments")
          .withIndex("by_studentId_and_startsAt", (q) =>
            q.eq("studentId", id).gte("startsAt", range.startAt).lt("startsAt", range.endAt),
          )
          .take(MAX_APPOINTMENTS_IN_RANGE + 1),
      );
    },
    listByProfessional: async (professionalId: string, range: AgendaRange) => {
      const id = ctx.db.normalizeId("users", professionalId);
      if (id === null) return agendaRangeResult([]);
      return agendaRangeResult(
        await ctx.db
          .query("appointments")
          .withIndex("by_professionalId_and_startsAt", (q) =>
            q.eq("professionalId", id).gte("startsAt", range.startAt).lt("startsAt", range.endAt),
          )
          .take(MAX_APPOINTMENTS_IN_RANGE + 1),
      );
    },
    listByAccompaniment: async (accompanimentId: string, range: AgendaRange) => {
      const id = ctx.db.normalizeId("accompaniments", accompanimentId);
      if (id === null) return agendaRangeResult([]);
      return agendaRangeResult(
        await ctx.db
          .query("appointments")
          .withIndex("by_accompanimentId_and_startsAt", (q) =>
            q.eq("accompanimentId", id).gte("startsAt", range.startAt).lt("startsAt", range.endAt),
          )
          .take(MAX_APPOINTMENTS_IN_RANGE + 1),
      );
    },
    getAppointment: async (appointmentId: string) => {
      const id = normalizeAppointmentId(ctx, appointmentId);
      const doc = id === null ? null : await getAppointmentById(ctx, id);
      return doc === null ? null : toAgendaAppointment(doc);
    },
  };
}

/**
 * Participantes adicionales de una atención (TI2-156, marca de coordinación).
 * Cumple por forma el puerto de la agenda sin importar Aplicación.
 */
export function appointmentParticipantsReader(ctx: DbReader) {
  return {
    listAdditionalIds: async (appointmentId: string): Promise<readonly string[]> => {
      const id = normalizeAppointmentId(ctx, appointmentId);
      if (id === null) return [];
      const doc = await getAppointmentById(ctx, id);
      if (doc === null) return [];
      return (await additionalProfessionalIdsOf(ctx, doc)).map((row) => row as string);
    },
  };
}

// ── TI2-156: atenciones futuras afectadas por cambios de configuración ─────
//
// Lecturas para detectar atenciones confirmadas que un cambio de
// disponibilidad, sala o necesidades puede dejar sin compatibilidad. Solo
// futuras vigentes (`scheduled`/`rescheduled` con `startsAt` posterior al
// instante del cambio): las anteriores no cambian y las terminales no se
// avisan. Nunca trunca en silencio: sobre el tope responde `complete: false`
// para que el caso de uso rechace en vez de avisar a medias.

/** Atención futura con lo mínimo para evaluar compatibilidad y avisar. */
export interface FutureActionableAppointment {
  readonly id: string;
  readonly accompanimentId: string;
  readonly studentId: string;
  readonly professionalId: string;
  readonly modality: Doc<"appointments">["modality"];
  readonly spaceId?: string;
  readonly status: Doc<"appointments">["status"];
  readonly startAt: number;
  readonly endAt: number;
  readonly additionalProfessionalIds: readonly string[];
}

async function toFutureActionable(
  ctx: DbReader,
  row: Doc<"appointments">,
): Promise<FutureActionableAppointment> {
  const additional = await additionalProfessionalIdsOf(ctx, row);
  return {
    id: row._id as string,
    accompanimentId: row.accompanimentId as string,
    studentId: row.studentId as string,
    professionalId: row.professionalId as string,
    modality: row.modality,
    ...(row.spaceId === undefined ? {} : { spaceId: row.spaceId as string }),
    status: row.status,
    startAt: row.startsAt,
    endAt: row.endsAt,
    additionalProfessionalIds: additional.map((id) => id as string),
  };
}

async function collectFutureActionable(
  ctx: DbReader,
  rows: Doc<"appointments">[],
  now: number,
): Promise<{ readonly complete: boolean; readonly appointments: FutureActionableAppointment[] }> {
  if (rows.length > MAX_APPOINTMENTS_IN_RANGE) {
    return { complete: false, appointments: [] };
  }
  const appointments: FutureActionableAppointment[] = [];
  for (const row of rows) {
    if (!isCalendarActionableStatus(row.status)) continue;
    if (row.startsAt <= now) continue;
    appointments.push(await toFutureActionable(ctx, row));
  }
  return { complete: true, appointments };
}

/**
 * Atenciones futuras del centro donde el profesional participa sin ser el
 * responsable (TI2-156, TI2-142). Recorre las futuras vigentes del centro por
 * `by_status_and_startsAt` (`scheduled` y `rescheduled` desde `now`, sin
 * límite de historial) y confirma la participación con
 * `by_appointmentId_and_professionalId`. Si el profesional nunca fue adicional
 * (`take(1)` vacío) no se lee nada más. Con `range` (lectura por fecha) el
 * rango va en el índice y solo se lee ese día. El tope es sobre las
 * coincidentes (`MAX_APPOINTMENTS_IN_RANGE`), nunca sobre el historial; si el
 * barrido no drena (20 páginas por estado) responde `complete: false` en vez
 * de truncar en silencio.
 */
async function collectCenterParticipating(
  ctx: DbReader,
  professionalId: Id<"users">,
  now: number,
  matchesDate: (startsAt: number) => boolean,
  range?: { readonly start: number; readonly end: number },
  pageSize = 200,
): Promise<{ readonly complete: boolean; readonly appointments: FutureActionableAppointment[] }> {
  const rows: Doc<"appointments">[] = [];
  const seen = new Set<string>();
  const lower = range === undefined ? now : Math.max(now, range.start);
  for (const status of ["scheduled", "rescheduled"] as const) {
    let cursor = lower;
    let first = true;
    let drained = false;
    for (let round = 0; round < 20; round += 1) {
      const page = await ctx.db
        .query("appointments")
        .withIndex("by_status_and_startsAt", (q) => {
          const base = q.eq("status", status);
          if (range === undefined) {
            return first ? base.gt("startsAt", cursor) : base.gte("startsAt", cursor);
          }
          if (first && cursor === now) {
            return base.gt("startsAt", cursor).lt("startsAt", range.end);
          }
          return base.gte("startsAt", cursor).lt("startsAt", range.end);
        })
        .take(pageSize + 1);
      first = false;
      if (page.length === 0) {
        drained = true;
        break;
      }
      let fresh = 0;
      const limit = Math.min(page.length, pageSize);
      for (let index = 0; index < limit; index += 1) {
        const row = page[index] as Doc<"appointments">;
        if (seen.has(row._id as string)) continue;
        seen.add(row._id as string);
        fresh += 1;
        if (row.startsAt <= now || !matchesDate(row.startsAt)) continue;
        if (row.professionalId === professionalId) continue;
        const participation = await findAppointmentProfessional(ctx, row._id, professionalId);
        if (participation === null) continue;
        rows.push(row);
        if (rows.length > MAX_APPOINTMENTS_IN_RANGE) {
          return { complete: false, appointments: [] } as const;
        }
      }
      if (page.length <= pageSize) {
        drained = true;
        break;
      }
      if (fresh === 0) return { complete: false, appointments: [] } as const;
      cursor = (page[page.length - 1] as Doc<"appointments">).startsAt;
    }
    if (!drained) return { complete: false, appointments: [] } as const;
  }
  return await collectFutureActionable(ctx, rows, now);
}

/**
 * Atenciones futuras por profesional, espacio, acompañamiento o participante
 * (TI2-156). Cumple por forma los puertos de impacto sin importar Aplicación.
 * Un identificador de otra tabla responde como vacío con `complete: true`.
 */
export function futureAppointmentsReader(ctx: DbReader) {
  return {
    listResponsibleByDate: async (professionalId: string, date: string, now: number) => {
      const id = ctx.db.normalizeId("users", professionalId);
      if (id === null) return { complete: true, appointments: [] } as const;
      const dayStart = midnightToEpochMs(date, AGENDA_TIME_ZONE);
      const dayEnd = midnightToEpochMs(addCivilDays(date, 1), AGENDA_TIME_ZONE);
      const rows = await ctx.db
        .query("appointments")
        .withIndex("by_professionalId_and_startsAt", (q) =>
          q.eq("professionalId", id).gte("startsAt", dayStart).lt("startsAt", dayEnd),
        )
        .take(51);
      if (rows.length > 50) return { complete: false, appointments: [] } as const;
      return await collectFutureActionable(ctx, rows, now);
    },
    listResponsibleByWeekdays: async (
      professionalId: string,
      weekdays: readonly number[],
      now: number,
      pageSize = 200,
    ) => {
      const id = ctx.db.normalizeId("users", professionalId);
      if (id === null) return { complete: true, appointments: [] } as const;
      const rows: Doc<"appointments">[] = [];
      const seen = new Set<string>();
      let cursor = now;
      let first = true;
      let drained = false;
      for (let round = 0; round < 20; round += 1) {
        const page = await ctx.db
          .query("appointments")
          .withIndex("by_professionalId_and_startsAt", (q) =>
            first
              ? q.eq("professionalId", id).gt("startsAt", cursor)
              : q.eq("professionalId", id).gte("startsAt", cursor),
          )
          .take(pageSize + 1);
        first = false;
        if (page.length === 0) {
          drained = true;
          break;
        }
        let fresh = 0;
        for (const row of page.slice(0, pageSize)) {
          if (seen.has(row._id as string)) continue;
          seen.add(row._id as string);
          fresh += 1;
          if (
            (weekdays as readonly number[]).includes(
              civilWeekday(civilDateOfInstant(row.startsAt, AGENDA_TIME_ZONE)),
            )
          ) {
            rows.push(row);
            if (rows.length > MAX_APPOINTMENTS_IN_RANGE) {
              return { complete: false, appointments: [] } as const;
            }
          }
        }
        if (page.length <= pageSize) {
          drained = true;
          break;
        }
        if (fresh === 0) return { complete: false, appointments: [] } as const;
        cursor = page[page.length - 1].startsAt;
      }
      if (!drained) return { complete: false, appointments: [] } as const;
      return await collectFutureActionable(ctx, rows, now);
    },
    listAdditionalByWeekdays: async (
      professionalId: string,
      weekdays: readonly number[],
      now: number,
      pageSize = 200,
    ) => {
      const id = ctx.db.normalizeId("users", professionalId);
      if (id === null) return { complete: true, appointments: [] } as const;
      const probe = await ctx.db
        .query("appointmentProfessionals")
        .withIndex("by_professionalId", (q) => q.eq("professionalId", id))
        .take(1);
      if (probe.length === 0) return { complete: true, appointments: [] } as const;
      const matchesDate = (startsAt: number): boolean =>
        (weekdays as readonly number[]).includes(
          civilWeekday(civilDateOfInstant(startsAt, AGENDA_TIME_ZONE)),
        );
      return await collectCenterParticipating(ctx, id, now, matchesDate, undefined, pageSize);
    },
    listAdditionalByDate: async (
      professionalId: string,
      date: string,
      now: number,
      pageSize = 200,
    ) => {
      const id = ctx.db.normalizeId("users", professionalId);
      if (id === null) return { complete: true, appointments: [] } as const;
      const probe = await ctx.db
        .query("appointmentProfessionals")
        .withIndex("by_professionalId", (q) => q.eq("professionalId", id))
        .take(1);
      if (probe.length === 0) return { complete: true, appointments: [] } as const;
      const dayStart = midnightToEpochMs(date, AGENDA_TIME_ZONE);
      const dayEnd = midnightToEpochMs(addCivilDays(date, 1), AGENDA_TIME_ZONE);
      const matchesDate = (startsAt: number): boolean => startsAt >= dayStart && startsAt < dayEnd;
      return await collectCenterParticipating(
        ctx,
        id,
        now,
        matchesDate,
        { start: dayStart, end: dayEnd },
        pageSize,
      );
    },
    listFutureBySpace: async (spaceId: string, now: number) => {
      const id = ctx.db.normalizeId("spaces", spaceId);
      if (id === null) return { complete: true, appointments: [] } as const;
      const rows = await ctx.db
        .query("appointments")
        .withIndex("by_spaceId_and_startsAt", (q) => q.eq("spaceId", id).gt("startsAt", now))
        .take(MAX_APPOINTMENTS_IN_RANGE + 1);
      return await collectFutureActionable(ctx, rows, now);
    },
    listFutureByAccompaniment: async (accompanimentId: string, now: number) => {
      const id = ctx.db.normalizeId("accompaniments", accompanimentId);
      if (id === null) return { complete: true, appointments: [] } as const;
      const rows = await ctx.db
        .query("appointments")
        .withIndex("by_accompanimentId_and_startsAt", (q) =>
          q.eq("accompanimentId", id).gt("startsAt", now),
        )
        .take(MAX_APPOINTMENTS_IN_RANGE + 1);
      return await collectFutureActionable(ctx, rows, now);
    },
  };
}
