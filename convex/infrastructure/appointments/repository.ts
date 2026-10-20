import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
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
 * ocupado deja el origen intacto. Los estados los completa TI2-107. El rechazo devuelve `conflict` (TI2-88) sin decir
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
 * incluidas, porque el índice no distingue estados. Con más filas la
 * ocupación responde `conflict` en vez de decidir con una lista cortada, que
 * podría esconder una atención activa. Límite técnico provisional, no un
 * requisito de CERETI.
 */
export const MAX_APPOINTMENTS_IN_WINDOW = 200;

/**
 * Estados que ocupan el cupo: todo salvo las cancelaciones, que lo liberan.
 * La lista exacta de estados la completa TI2-107; acá basta distinguir
 * cancelado de no cancelado para que un cupo liberado se pueda volver a ocupar.
 */
const CANCELLED_APPOINTMENT_STATUSES: ReadonlySet<Doc<"appointments">["status"]> = new Set([
  "cancelled_by_student",
  "cancelled_by_cereti",
]);

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

/** Entrada de la ocupación con identificadores Convex. */
export interface OccupySlotRow {
  readonly accompanimentId: Id<"accompaniments">;
  readonly studentId: Id<"users">;
  readonly professionalId: Id<"users">;
  readonly modality: Doc<"appointments">["modality"];
  readonly spaceId?: Id<"spaces">;
  readonly startsAt: number;
  readonly endsAt: number;
  /**
   * Atención que se cambia de horario o de recursos. Tiene que seguir
   * ocupando su cupo y ser del mismo estudiante y acompañamiento; sin ella
   * se crea una atención nueva.
   */
  readonly movedAppointmentId?: Id<"appointments">;
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
 * identificador, estado, fecha original y fecha de creación: qué estado
 * admite el cambio y cómo queda lo decide la política de TI2-93 en el caso
 * de uso de TI2-109. Una atención inexistente, cancelada o de otro
 * estudiante o acompañamiento responde `conflict` sin escribir.
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
  const resources: OccupiedResource[] = [
    { kind: "professional", id: input.professionalId },
    { kind: "student", id: input.studentId },
  ];
  if (input.spaceId !== undefined) {
    resources.push({ kind: "space", id: input.spaceId });
  }
  const moved = await findMovedAppointment(ctx, input);
  if (moved === "invalid") {
    return errResult(conflictError());
  }
  for (const resource of resources) {
    if (await isResourceTaken(ctx, resource, input, moved === null ? null : moved._id)) {
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
      // Conservar la fecha original del primer agendamiento; si es el primer
      // reagendamiento, usar la fecha actual como referencia original.
      originalStartsAt: moved.originalStartsAt ?? moved.startsAt,
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
    createdAt: Date.now(),
  });
  return okResult({ appointmentId });
}
