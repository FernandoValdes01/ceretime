import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { conflictError, errResult, okResult, type ApiResult } from "../../domain/errors/api_error";

/**
 * Repositorio de ocupación de cupo (TI2-84).
 *
 * Capa de Infraestructura: único lugar que toca `ctx.db` en el flujo de
 * ocupación. No decide autorización ni resuelve identidad; solo
 * persiste/recupera con los índices declarados en `convex/schema.ts`,
 * consultando los campos en el orden del índice. La forma genérica del
 * puerto vive en `convex/application/appointments/occupancy.ts`.
 *
 * La adquisición es atómica: `occupySlotAtomically` lee la ocupación y
 * escribe la atención en la misma transacción, así dos intentos sobre el
 * mismo cupo crean como máximo una atención y el rechazo no deja ocupación
 * parcial. El cupo es discreto y se identifica por profesional e instante
 * de inicio (`by_professionalId_and_startsAt` con igualdad en ambos
 * campos); el solape de intervalos con inicios distintos y los cruces de
 * estudiante y sala los agrega TI2-96 en este mismo archivo, y los estados
 * los completa TI2-107. El rechazo por contienda devuelve `conflict`
 * (TI2-88); `no_availability` queda para la ausencia de cupo en búsqueda
 * (TI2-98). No hay API pública ni tabla `locks`/`reservations` paralela:
 * la única representación es `appointments`.
 *
 * Opera con datos ficticios.
 */

/** Contexto con lectura de base de datos (consultas y mutaciones). */
type DbReader = QueryCtx | MutationCtx;

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

/** Ventana para barrer colisiones del mismo instante sin lecturas ilimitadas. */
const SAME_INSTANT_SCAN_LIMIT = 10;

/**
 * Ocupante del cupo discreto (profesional e inicio), o `null` si está
 * libre. Las filas del mismo instante son pocas por construcción (reintentos
 * sobre el mismo cupo), así que una ventana acotada basta para decidir sin
 * lecturas ilimitadas; la vía de producción usa este mismo índice.
 */
export async function findOccupantByProfessionalAndStart(
  ctx: DbReader,
  professionalId: Id<"users">,
  startsAt: number,
): Promise<Doc<"appointments"> | null> {
  const sameInstant = await ctx.db
    .query("appointments")
    .withIndex("by_professionalId_and_startsAt", (q) =>
      q.eq("professionalId", professionalId).eq("startsAt", startsAt),
    )
    .take(SAME_INSTANT_SCAN_LIMIT);
  return sameInstant.find(isBlocking) ?? null;
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
}

/**
 * Ocupa el cupo de forma atómica: lee la ocupación y escribe la atención en
 * la misma transacción. Si el cupo ya está ocupado devuelve el error
 * estable `conflict` sin escribir nada; si está libre inserta la atención
 * en estado `scheduled` y devuelve su identificador. El intervalo se valida
 * en el servidor sin confiar en el cliente; la compatibilidad de modalidad
 * y espacio es de TI2-82 y los cruces de estudiante y sala son de TI2-96.
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
  const occupant = await findOccupantByProfessionalAndStart(
    ctx,
    input.professionalId,
    input.startsAt,
  );
  if (occupant !== null) {
    return errResult(conflictError());
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
