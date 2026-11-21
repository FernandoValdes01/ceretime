import type { PaginationOptions } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  NOTIFICATION_CONTRACT_VERSION,
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
 * referencias a la atención y al destinatario, clase e instante. La versión es
 * la del contrato vigente y no se guarda, igual que la clave de idempotencia,
 * porque NOTIFICACIONES del MER no las tiene (TI2-165). No
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

/**
 * Eventos que se leen como máximo para reconocer un reintento: los de una
 * atención en un mismo instante. Un cambio deja a lo sumo un evento por clase
 * y destinatario, así que este tope técnico no recorta una emisión real.
 */
const MAX_EVENTS_PER_CHANGE = 100;

/**
 * Fila que ya registró el mismo cambio, o `null` si aún no se registró. Busca
 * por atención e instante con el índice y compara la clave de
 * `notificationIdempotencyKey` calculada sobre cada fila.
 */
async function findSameEvent(
  ctx: DbReader,
  appointmentId: Id<"appointments">,
  event: NotificationEvent,
): Promise<Doc<"notificationEvents"> | null> {
  const key = notificationIdempotencyKey(event);
  const rows = await ctx.db
    .query("notificationEvents")
    .withIndex("by_appointmentId_and_occurredAt", (q) =>
      q.eq("appointmentId", appointmentId).eq("occurredAt", event.occurredAt),
    )
    .take(MAX_EVENTS_PER_CHANGE);
  return (
    rows.find((row) => notificationIdempotencyKey(toStoredNotificationEvent(row)) === key) ?? null
  );
}

/**
 * Registra un evento sin duplicar reintentos.
 *
 * La atención debe existir y el destinatario debe ser su estudiante o su
 * profesional: una referencia de otra tabla, inexistente o ajena a la atención
 * responde `invalid_reference` sin escribir. El reintento se reconoce en la
 * misma transacción en que se escribe, así dos reintentos del mismo cambio
 * dejan una sola fila.
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

  const existing = await findSameEvent(ctx, appointmentId, event);
  if (existing !== null) return { status: "duplicate", eventId: existing._id };

  const eventId = await ctx.db.insert("notificationEvents", {
    kind: event.kind,
    appointmentId,
    recipientId,
    occurredAt: event.occurredAt,
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

/** Traduce la fila al contrato, con la versión vigente del contrato. */
function toStoredNotificationEvent(row: Doc<"notificationEvents">): StoredNotificationEvent {
  return {
    id: row._id,
    kind: row.kind,
    appointmentId: row.appointmentId,
    recipientId: row.recipientId,
    occurredAt: row.occurredAt,
    version: NOTIFICATION_CONTRACT_VERSION,
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
