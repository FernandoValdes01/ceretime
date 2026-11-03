import type { PaginationOptions } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { AppointmentAuditRecorder } from "../../application/appointments/audit";
import {
  toAppointmentAuditEvent,
  type AppointmentAuditEvent,
} from "../../domain/appointments/audit";

/**
 * Repositorio de auditoría de cambios de agenda (TI2-128).
 *
 * Capa de Infraestructura: único lugar que toca `ctx.db` para
 * `appointmentAuditEvents`. Es append-only: solo inserta y pagina; no
 * exporta funciones para modificar ni borrar filas, y ninguna entrada
 * pública de `api.presentation.*` lo usa para leer. El evento se reconstruye
 * con `toAppointmentAuditEvent`, así un campo extra (motivo, nota, nombre) no
 * llega a la base.
 *
 * Opera con datos ficticios.
 */

/** Contexto con lectura de base de datos (consultas y mutaciones). */
type DbReader = QueryCtx | MutationCtx;

/**
 * Inserta el evento en la transacción del cambio.
 *
 * La atención y el actor deben existir: una referencia inválida lanza error
 * para abortar la mutation completa, así el cambio no queda sin su evento.
 */
export async function recordAppointmentAuditEvent(
  ctx: MutationCtx,
  input: AppointmentAuditEvent,
): Promise<Id<"appointmentAuditEvents">> {
  const event = toAppointmentAuditEvent(input);
  const appointmentId = ctx.db.normalizeId("appointments", event.appointmentId);
  const actorId = ctx.db.normalizeId("users", event.actorId);
  if (
    appointmentId === null ||
    actorId === null ||
    (await ctx.db.get(appointmentId)) === null ||
    (await ctx.db.get(actorId)) === null
  ) {
    throw new Error("El evento de auditoría tiene una referencia inválida.");
  }
  return await ctx.db.insert("appointmentAuditEvents", {
    action: event.action,
    actorId,
    appointmentId,
    result: event.result,
    occurredAt: event.occurredAt,
  });
}

/** Adaptador del puerto de Aplicación sobre la transacción de la mutation. */
export function appointmentAuditRecorder(ctx: MutationCtx): AppointmentAuditRecorder {
  return {
    recordAppointmentAudit: async (event) => {
      await recordAppointmentAuditEvent(ctx, event);
    },
  };
}

/** Evento guardado con su identificador, en la forma del dominio. */
export type StoredAppointmentAuditEvent = AppointmentAuditEvent & {
  readonly id: Id<"appointmentAuditEvents">;
};

function toStoredAppointmentAuditEvent(
  row: Doc<"appointmentAuditEvents">,
): StoredAppointmentAuditEvent {
  return {
    id: row._id,
    action: row.action,
    actorId: row.actorId,
    appointmentId: row.appointmentId,
    result: row.result,
    occurredAt: row.occurredAt,
  };
}

/** Página del historial de la atención, en orden de ocurrencia. */
export async function paginateAppointmentAuditEvents(
  ctx: DbReader,
  appointmentId: Id<"appointments">,
  paginationOpts: PaginationOptions,
) {
  const result = await ctx.db
    .query("appointmentAuditEvents")
    .withIndex("by_appointmentId_and_occurredAt", (q) => q.eq("appointmentId", appointmentId))
    .order("asc")
    .paginate(paginationOpts);
  return { ...result, page: result.page.map(toStoredAppointmentAuditEvent) };
}

/** Página de cambios hechos por un actor, del más reciente al más antiguo. */
export async function paginateAppointmentAuditEventsByActor(
  ctx: DbReader,
  actorId: Id<"users">,
  paginationOpts: PaginationOptions,
) {
  const result = await ctx.db
    .query("appointmentAuditEvents")
    .withIndex("by_actorId_and_occurredAt", (q) => q.eq("actorId", actorId))
    .order("desc")
    .paginate(paginationOpts);
  return { ...result, page: result.page.map(toStoredAppointmentAuditEvent) };
}
