import type { PaginationOptions } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  notificationIdempotencyKey,
  toNotificationEvent,
  type NotificationEvent,
} from "../../domain/notifications/notification";

/**
 * Repositorio de eventos de notificación (TI2-118).
 *
 * Capa de Infraestructura: único lugar que toca `ctx.db` para
 * `notificationEvents`. Persiste la forma mínima de TI2-105 tal como la
 * producen `notificationEventsForCreation` y `notificationEventsForTransition`:
 * referencias a la atención y al destinatario, clase, instante y versión. No
 * acepta textos: el evento se reconstruye con `toNotificationEvent`, así un
 * campo extra (motivo, nota, nombre) no puede llegar a la base. No decide a
 * quién avisar (política de TI2-105), no autoriza lecturas (TI2-127) ni envía
 * (TI2-122).
 *
 * Opera con datos ficticios.
 */

/** Contexto con lectura de base de datos (consultas y mutaciones). */
type DbReader = QueryCtx | MutationCtx;

/**
 * Resultado de registrar un evento. `duplicate` devuelve la fila que ya
 * guardó un intento anterior del mismo cambio; `invalid_reference` no escribe.
 */
export type NotificationEventRecordResult =
  | { readonly status: "recorded"; readonly eventId: Id<"notificationEvents"> }
  | { readonly status: "duplicate"; readonly eventId: Id<"notificationEvents"> }
  | { readonly status: "invalid_reference" };

/** Fila con esa clave de idempotencia, o `null` si el cambio aún no se registró. */
async function findByIdempotencyKey(
  ctx: DbReader,
  idempotencyKey: string,
): Promise<Doc<"notificationEvents"> | null> {
  return await ctx.db
    .query("notificationEvents")
    .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idempotencyKey))
    .unique();
}

/**
 * Registra un evento sin duplicar reintentos.
 *
 * La atención debe existir y el destinatario debe ser su estudiante o su
 * profesional: una referencia de otra tabla, inexistente o ajena a la atención
 * responde `invalid_reference` sin escribir. La clave de
 * `notificationIdempotencyKey` se comprueba y se escribe en la misma
 * transacción, así dos reintentos del mismo cambio dejan una sola fila.
 */
export async function recordNotificationEvent(
  ctx: MutationCtx,
  input: NotificationEvent,
): Promise<NotificationEventRecordResult> {
  const event = toNotificationEvent(input);
  const appointmentId = ctx.db.normalizeId("appointments", event.appointmentId);
  const recipientId = ctx.db.normalizeId("users", event.recipientId);
  if (appointmentId === null || recipientId === null) return { status: "invalid_reference" };

  const appointment = await ctx.db.get(appointmentId);
  if (
    appointment === null ||
    (appointment.studentId !== recipientId && appointment.professionalId !== recipientId) ||
    (await ctx.db.get(recipientId)) === null
  ) {
    return { status: "invalid_reference" };
  }

  const idempotencyKey = notificationIdempotencyKey(event);
  const existing = await findByIdempotencyKey(ctx, idempotencyKey);
  if (existing !== null) return { status: "duplicate", eventId: existing._id };

  const eventId = await ctx.db.insert("notificationEvents", {
    kind: event.kind,
    appointmentId,
    recipientId,
    occurredAt: event.occurredAt,
    version: event.version,
    idempotencyKey,
  });
  return { status: "recorded", eventId };
}

/** Registra en orden los eventos que la política produjo para un mismo cambio. */
export async function recordNotificationEvents(
  ctx: MutationCtx,
  events: readonly NotificationEvent[],
): Promise<NotificationEventRecordResult[]> {
  const results: NotificationEventRecordResult[] = [];
  for (const event of events) {
    results.push(await recordNotificationEvent(ctx, event));
  }
  return results;
}

/**
 * Puerto de registro para los casos de uso (TI2-142): cumple por forma
 * `NotificationEventRecorder` de Aplicación sin importarla. Un evento con
 * referencia inválida no se escribe; el caso de uso ya leyó la atención y el
 * destinatario sale de ella, así que no se espera ese resultado.
 */
export function notificationEventRecorder(ctx: MutationCtx) {
  return {
    record: async (events: readonly NotificationEvent[]): Promise<void> => {
      await recordNotificationEvents(ctx, events);
    },
  };
}

/** Evento guardado con su identificador, en la forma del contrato de TI2-105. */
export type StoredNotificationEvent = NotificationEvent & {
  readonly id: Id<"notificationEvents">;
};

/** Traduce la fila al contrato; la clave de idempotencia no sale del repositorio. */
function toStoredNotificationEvent(row: Doc<"notificationEvents">): StoredNotificationEvent {
  return {
    id: row._id,
    kind: row.kind,
    appointmentId: row.appointmentId,
    recipientId: row.recipientId,
    occurredAt: row.occurredAt,
    version: row.version,
  };
}

/** Página de eventos del destinatario, del más reciente al más antiguo. */
export async function paginateNotificationEventsForRecipient(
  ctx: DbReader,
  recipientId: Id<"users">,
  paginationOpts: PaginationOptions,
) {
  const result = await ctx.db
    .query("notificationEvents")
    .withIndex("by_recipientId_and_occurredAt", (q) => q.eq("recipientId", recipientId))
    .order("desc")
    .paginate(paginationOpts);
  return { ...result, page: result.page.map(toStoredNotificationEvent) };
}

/** Página de eventos de la atención, en orden de ocurrencia. */
export async function paginateNotificationEventsForAppointment(
  ctx: DbReader,
  appointmentId: Id<"appointments">,
  paginationOpts: PaginationOptions,
) {
  const result = await ctx.db
    .query("notificationEvents")
    .withIndex("by_appointmentId_and_occurredAt", (q) => q.eq("appointmentId", appointmentId))
    .order("asc")
    .paginate(paginationOpts);
  return { ...result, page: result.page.map(toStoredNotificationEvent) };
}
