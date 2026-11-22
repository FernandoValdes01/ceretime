import type { PaginationOptions } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  isNotificationDeliveryChannel,
  isNotificationDeliveryError,
  type NotificationDeliveryChannel,
  type NotificationDeliveryError,
  type NotificationDeliveryStatus,
} from "../../domain/notifications/delivery";
import {
  isAppointmentNotificationEventKind,
  isRequestNotificationEventKind,
  notificationIdempotencyKey,
  toNotificationEvent,
  type NotificationEvent,
  type NotificationReadStatus,
} from "../../domain/notifications/notification";

/**
 * Repositorio de avisos, entregas y suscripciones push (TI2-118, TI2-145).
 *
 * Capa de Infraestructura: único lugar que toca `ctx.db` para
 * `notificationEvents`, `notificationDeliveries` y `pushSubscriptions`.
 * Persiste la forma mínima de TI2-105 tal como la producen las funciones de
 * Dominio: referencias al recurso y al destinatario, clase, instante y
 * versión. No acepta textos: el evento se reconstruye con
 * `toNotificationEvent`, así un campo extra (motivo, nota, nombre) no puede
 * llegar a la base. No decide a quién avisar (política de TI2-105/TI2-150), no
 * autoriza lecturas (TI2-127) ni envía (TI2-159/TI2-160).
 *
 * Un aviso referencia exactamente una atención o una solicitud. Las entregas
 * viven en una fila por evento y canal, y los reintentos actualizan esa fila:
 * nunca crean otro aviso. Las suscripciones push y sus claves solo se leen
 * desde este repositorio; ninguna función pública las devuelve.
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
 * Verdadero cuando el usuario participa de la atención: es su estudiante, su
 * profesional responsable o uno de los profesionales adicionales de TI2-138.
 */
async function isAppointmentRecipient(
  ctx: DbReader,
  appointment: Doc<"appointments">,
  recipientId: Id<"users">,
): Promise<boolean> {
  if (appointment.studentId === recipientId || appointment.professionalId === recipientId) {
    return true;
  }
  const additional = await ctx.db
    .query("appointmentProfessionals")
    .withIndex("by_appointmentId_and_professionalId", (q) =>
      q.eq("appointmentId", appointment._id).eq("professionalId", recipientId),
    )
    .unique();
  return additional !== null;
}

/**
 * Verdadero cuando el usuario puede recibir un aviso de la solicitud: es su
 * estudiante, el profesional que la tomó o uno con asignación activa. La
 * política de destinatarios sigue siendo de TI2-150.
 */
async function isRequestRecipient(
  ctx: DbReader,
  requestId: Id<"requests">,
  recipientId: Id<"users">,
): Promise<boolean> {
  const request = await ctx.db.get(requestId);
  if (request === null) return false;
  if (request.studentId === recipientId || request.takenBy === recipientId) return true;
  const assignment = await ctx.db
    .query("requestAssignments")
    .withIndex("by_request_and_user_and_status", (q) =>
      q.eq("requestId", requestId).eq("userId", recipientId).eq("status", "active"),
    )
    .unique();
  return assignment !== null;
}

/**
 * Registra un evento sin duplicar reintentos.
 *
 * El recurso debe existir y el destinatario debe participar de él: una
 * referencia de otra tabla, inexistente o ajena responde `invalid_reference`
 * sin escribir. La clave de `notificationIdempotencyKey` se comprueba y se
 * escribe en la misma transacción, así dos reintentos del mismo cambio dejan
 * una sola fila.
 */
export async function recordNotificationEvent(
  ctx: MutationCtx,
  input: NotificationEvent,
): Promise<NotificationEventRecordResult> {
  const event = toNotificationEvent(input);
  const recipientId = ctx.db.normalizeId("users", event.recipientId);
  if (recipientId === null || (await ctx.db.get(recipientId)) === null) {
    return { status: "invalid_reference" };
  }

  let appointmentId: Id<"appointments"> | undefined;
  let requestId: Id<"requests"> | undefined;
  if ("appointmentId" in event) {
    const normalized = ctx.db.normalizeId("appointments", event.appointmentId);
    if (normalized === null) return { status: "invalid_reference" };
    const appointment = await ctx.db.get(normalized);
    if (appointment === null || !(await isAppointmentRecipient(ctx, appointment, recipientId))) {
      return { status: "invalid_reference" };
    }
    appointmentId = normalized;
  } else {
    const normalized = ctx.db.normalizeId("requests", event.requestId);
    if (normalized === null) return { status: "invalid_reference" };
    if (!(await isRequestRecipient(ctx, normalized, recipientId))) {
      return { status: "invalid_reference" };
    }
    requestId = normalized;
  }

  const idempotencyKey = notificationIdempotencyKey(event);
  const existing = await findByIdempotencyKey(ctx, idempotencyKey);
  if (existing !== null) return { status: "duplicate", eventId: existing._id };

  const eventId = await ctx.db.insert("notificationEvents", {
    kind: event.kind,
    ...(appointmentId === undefined ? {} : { appointmentId }),
    ...(requestId === undefined ? {} : { requestId }),
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

/** Evento guardado con su identificador, su recurso y su estado de lectura. */
export type StoredNotificationEvent = NotificationEvent & {
  readonly id: Id<"notificationEvents">;
  readonly readStatus: NotificationReadStatus;
  readonly readAt?: number;
};

/** Traduce la fila al contrato; la clave de idempotencia no sale del repositorio. */
function toStoredNotificationEvent(row: Doc<"notificationEvents">): StoredNotificationEvent {
  const base = {
    id: row._id,
    recipientId: row.recipientId,
    occurredAt: row.occurredAt,
    version: row.version,
    readStatus: row.readAt === undefined ? ("pending" as const) : ("read" as const),
    ...(row.readAt === undefined ? {} : { readAt: row.readAt }),
  };
  if (row.appointmentId !== undefined) {
    if (!isAppointmentNotificationEventKind(row.kind)) {
      throw new Error("El aviso guardado tiene una clase que no corresponde a su atención.");
    }
    return { ...base, kind: row.kind, appointmentId: row.appointmentId };
  }
  if (row.requestId === undefined) {
    throw new Error("El evento de notificación guardado no tiene recurso.");
  }
  if (!isRequestNotificationEventKind(row.kind)) {
    throw new Error("El aviso guardado tiene una clase que no corresponde a su solicitud.");
  }
  return { ...base, kind: row.kind, requestId: row.requestId };
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

/**
 * Página de avisos propios filtrada por estado de lectura.
 *
 * Los pendientes usan `by_recipientId_and_readAt_and_occurredAt`: `readAt`
 * ausente se consulta como rango nulo y la página no recorre los avisos ya
 * leídos. Los leídos conservan el índice del destinatario y filtran la
 * desigualdad, que el constructor de rangos del índice no expresa: solo admite
 * igualdades y cotas inferior y superior. Las filas anteriores a TI2-145 no
 * tienen `readAt` y cuentan como pendientes, igual que las nuevas todavía no
 * leídas: no hace falta una migración para distinguirlas.
 */
export async function paginateNotificationEventsForRecipientByReadStatus(
  ctx: DbReader,
  recipientId: Id<"users">,
  readStatus: NotificationReadStatus,
  paginationOpts: PaginationOptions,
) {
  const result =
    readStatus === "pending"
      ? await ctx.db
          .query("notificationEvents")
          .withIndex("by_recipientId_and_readAt_and_occurredAt", (q) =>
            q.eq("recipientId", recipientId).eq("readAt", undefined),
          )
          .order("desc")
          .paginate(paginationOpts)
      : await ctx.db
          .query("notificationEvents")
          .withIndex("by_recipientId_and_occurredAt", (q) => q.eq("recipientId", recipientId))
          .filter((q) => q.neq(q.field("readAt"), undefined))
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

/** Página de eventos de la solicitud, en orden de ocurrencia. */
export async function paginateNotificationEventsForRequest(
  ctx: DbReader,
  requestId: Id<"requests">,
  paginationOpts: PaginationOptions,
) {
  const result = await ctx.db
    .query("notificationEvents")
    .withIndex("by_requestId_and_occurredAt", (q) => q.eq("requestId", requestId))
    .order("asc")
    .paginate(paginationOpts);
  return { ...result, page: result.page.map(toStoredNotificationEvent) };
}

/**
 * Resultado de marcar un aviso como leído. Solo el destinatario de la fila
 * puede marcarla: un evento ajeno responde `not_found` sin escribir.
 */
export type MarkNotificationReadResult =
  | {
      readonly status: "marked";
      readonly eventId: Id<"notificationEvents">;
      readonly readAt: number;
    }
  | {
      readonly status: "already_read";
      readonly eventId: Id<"notificationEvents">;
      readonly readAt: number;
    }
  | { readonly status: "not_found" };

/** Marca como leído un aviso propio; un reintento no cambia el instante original. */
export async function markNotificationEventRead(
  ctx: MutationCtx,
  recipientId: Id<"users">,
  eventId: Id<"notificationEvents">,
  readAt: number,
): Promise<MarkNotificationReadResult> {
  if (!Number.isFinite(readAt) || readAt <= 0) {
    throw new Error("La lectura del aviso requiere un instante epoch válido.");
  }
  const normalized = ctx.db.normalizeId("notificationEvents", eventId);
  if (normalized === null) return { status: "not_found" };
  const row = await ctx.db.get(normalized);
  if (row === null || row.recipientId !== recipientId) return { status: "not_found" };
  if (row.readAt !== undefined) {
    return { status: "already_read", eventId: normalized, readAt: row.readAt };
  }
  await ctx.db.patch(normalized, { readAt });
  return { status: "marked", eventId: normalized, readAt };
}

/** Entrega visible: sin cuerpos, encabezados ni credenciales del proveedor. */
export interface StoredNotificationDelivery {
  readonly id: Id<"notificationDeliveries">;
  readonly eventId: Id<"notificationEvents">;
  readonly channel: NotificationDeliveryChannel;
  readonly status: NotificationDeliveryStatus;
  readonly attempts: number;
  readonly lastAttemptAt?: number;
  readonly sentAt?: number;
  readonly errorCode?: NotificationDeliveryError;
}

function toStoredNotificationDelivery(
  row: Doc<"notificationDeliveries">,
): StoredNotificationDelivery {
  return {
    id: row._id,
    eventId: row.eventId,
    channel: row.channel,
    status: row.status,
    attempts: row.attempts,
    ...(row.lastAttemptAt === undefined ? {} : { lastAttemptAt: row.lastAttemptAt }),
    ...(row.sentAt === undefined ? {} : { sentAt: row.sentAt }),
    ...(row.errorCode === undefined ? {} : { errorCode: row.errorCode }),
  };
}

async function findDeliveryRow(
  ctx: DbReader,
  eventId: Id<"notificationEvents">,
  channel: NotificationDeliveryChannel,
): Promise<Doc<"notificationDeliveries"> | null> {
  return await ctx.db
    .query("notificationDeliveries")
    .withIndex("by_eventId_and_channel", (q) => q.eq("eventId", eventId).eq("channel", channel))
    .unique();
}

/** Entrega guardada del evento y canal, o `null` si todavía no se encoló. */
export async function findNotificationDelivery(
  ctx: DbReader,
  eventId: Id<"notificationEvents">,
  channel: NotificationDeliveryChannel,
): Promise<StoredNotificationDelivery | null> {
  const normalized = ctx.db.normalizeId("notificationEvents", eventId);
  if (normalized === null) return null;
  const row = await findDeliveryRow(ctx, normalized, channel);
  return row === null ? null : toStoredNotificationDelivery(row);
}

/**
 * Resultado de encolar una entrega. `queued` crea la fila pendiente;
 * `exists` conserva la que ya estaba, sin duplicarla.
 */
export type NotificationDeliveryQueueResult =
  | {
      readonly status: "queued";
      readonly deliveryId: Id<"notificationDeliveries">;
      readonly attempts: number;
    }
  | {
      readonly status: "exists";
      readonly deliveryId: Id<"notificationDeliveries">;
      readonly attempts: number;
      readonly deliveryStatus: NotificationDeliveryStatus;
    }
  | { readonly status: "invalid_reference" };

/**
 * Encola la entrega de un aviso por canal. Es idempotente: un aviso puede
 * tener una sola fila por canal y un reintento reutiliza la existente.
 */
export async function ensureNotificationDelivery(
  ctx: MutationCtx,
  eventId: Id<"notificationEvents">,
  channel: NotificationDeliveryChannel,
): Promise<NotificationDeliveryQueueResult> {
  if (!isNotificationDeliveryChannel(channel)) {
    throw new Error("El canal de entrega es desconocido.");
  }
  const normalizedEventId = ctx.db.normalizeId("notificationEvents", eventId);
  if (normalizedEventId === null || (await ctx.db.get(normalizedEventId)) === null) {
    return { status: "invalid_reference" };
  }
  const existing = await findDeliveryRow(ctx, normalizedEventId, channel);
  if (existing !== null) {
    return {
      status: "exists",
      deliveryId: existing._id,
      attempts: existing.attempts,
      deliveryStatus: existing.status,
    };
  }
  const deliveryId = await ctx.db.insert("notificationDeliveries", {
    eventId: normalizedEventId,
    channel,
    status: "pending",
    attempts: 0,
  });
  return { status: "queued", deliveryId, attempts: 0 };
}

/** Entrada de un intento de entrega, con código obligatorio solo al fallar. */
export interface NotificationDeliveryAttemptInput {
  readonly channel: NotificationDeliveryChannel;
  readonly status: "sent" | "failed";
  readonly attemptedAt: number;
  readonly errorCode?: NotificationDeliveryError;
}

/** Resultado de registrar un intento: el aviso y su entrega nunca se duplican. */
export type NotificationDeliveryAttemptResult =
  | {
      readonly status: "recorded";
      readonly deliveryId: Id<"notificationDeliveries">;
      readonly attempts: number;
    }
  | { readonly status: "invalid_reference" };

/**
 * Registra el resultado de un intento sobre la fila del evento y canal.
 *
 * Si la entrega no estaba encolada, la crea con ese primer intento. Si ya
 * existía, incrementa `attempts` y reemplaza el resultado: un fallo conserva
 * su código estable y un envío exitoso deja `sentAt` y limpia el error. No
 * inserta eventos ni otra entrega.
 */
export async function recordNotificationDeliveryAttempt(
  ctx: MutationCtx,
  eventId: Id<"notificationEvents">,
  input: NotificationDeliveryAttemptInput,
): Promise<NotificationDeliveryAttemptResult> {
  if (!isNotificationDeliveryChannel(input.channel)) {
    throw new Error("El canal de entrega es desconocido.");
  }
  if (input.status !== "sent" && input.status !== "failed") {
    throw new Error("El estado del intento de entrega es desconocido.");
  }
  if (!Number.isFinite(input.attemptedAt) || input.attemptedAt <= 0) {
    throw new Error("El intento de entrega requiere un instante epoch válido.");
  }
  if (input.status === "failed") {
    if (input.errorCode === undefined || !isNotificationDeliveryError(input.errorCode)) {
      throw new Error("El fallo de entrega requiere un código de error conocido.");
    }
  } else if (input.errorCode !== undefined) {
    throw new Error("Un envío exitoso no lleva código de error.");
  }
  const normalizedEventId = ctx.db.normalizeId("notificationEvents", eventId);
  if (normalizedEventId === null || (await ctx.db.get(normalizedEventId)) === null) {
    return { status: "invalid_reference" };
  }

  const existing = await findDeliveryRow(ctx, normalizedEventId, input.channel);
  if (existing !== null) {
    const attempts = existing.attempts + 1;
    await ctx.db.patch(existing._id, {
      status: input.status,
      attempts,
      lastAttemptAt: input.attemptedAt,
      ...(input.status === "sent"
        ? { sentAt: input.attemptedAt, errorCode: undefined }
        : { errorCode: input.errorCode }),
    });
    return { status: "recorded", deliveryId: existing._id, attempts };
  }

  const deliveryId = await ctx.db.insert("notificationDeliveries", {
    eventId: normalizedEventId,
    channel: input.channel,
    status: input.status,
    attempts: 1,
    lastAttemptAt: input.attemptedAt,
    ...(input.status === "sent" ? { sentAt: input.attemptedAt } : { errorCode: input.errorCode }),
  });
  return { status: "recorded", deliveryId, attempts: 1 };
}

/** Página de entregas pendientes de un canal, para el despacho posterior. */
export async function paginatePendingNotificationDeliveries(
  ctx: DbReader,
  channel: NotificationDeliveryChannel,
  paginationOpts: PaginationOptions,
) {
  const result = await ctx.db
    .query("notificationDeliveries")
    .withIndex("by_channel_and_status", (q) => q.eq("channel", channel).eq("status", "pending"))
    .order("asc")
    .paginate(paginationOpts);
  return { ...result, page: result.page.map(toStoredNotificationDelivery) };
}

/** Suscripción push tal como la necesita el adaptador de envío. */
export interface PushSubscriptionInput {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly expirationTime?: number;
}

/** Resultado de guardar una suscripción propia. */
export type PushSubscriptionSaveResult =
  | {
      readonly status: "saved";
      readonly subscriptionId: Id<"pushSubscriptions">;
      readonly created: boolean;
    }
  | { readonly status: "invalid_reference" }
  | { readonly status: "invalid_subscription" };

function normalizePushSubscription(input: PushSubscriptionInput): PushSubscriptionInput | null {
  const endpoint = input.endpoint.trim();
  const p256dh = input.p256dh.trim();
  const auth = input.auth.trim();
  if (endpoint === "" || p256dh === "" || auth === "") return null;
  if (
    input.expirationTime !== undefined &&
    (!Number.isFinite(input.expirationTime) || input.expirationTime <= 0)
  ) {
    return null;
  }
  return {
    endpoint,
    p256dh,
    auth,
    ...(input.expirationTime === undefined ? {} : { expirationTime: input.expirationTime }),
  };
}

/**
 * Guarda o reemplaza la suscripción de un endpoint para el usuario vigente.
 *
 * El endpoint identifica un navegador, no a una persona: si otra sesión del
 * mismo navegador vuelve a suscribirse, la fila se reasigna al usuario actual
 * en vez de duplicarse. Las claves son las públicas del navegador y solo las
 * lee este repositorio.
 */
export async function savePushSubscription(
  ctx: MutationCtx,
  userId: Id<"users">,
  input: PushSubscriptionInput,
  savedAt: number,
): Promise<PushSubscriptionSaveResult> {
  if (!Number.isFinite(savedAt) || savedAt <= 0) {
    throw new Error("La suscripción push requiere un instante epoch válido.");
  }
  if ((await ctx.db.get(userId)) === null) return { status: "invalid_reference" };
  const normalized = normalizePushSubscription(input);
  if (normalized === null) return { status: "invalid_subscription" };

  const existing = await ctx.db
    .query("pushSubscriptions")
    .withIndex("by_endpoint", (q) => q.eq("endpoint", normalized.endpoint))
    .unique();
  if (existing !== null) {
    await ctx.db.patch(existing._id, {
      userId,
      p256dh: normalized.p256dh,
      auth: normalized.auth,
      expirationTime: normalized.expirationTime,
      updatedAt: savedAt,
    });
    return { status: "saved", subscriptionId: existing._id, created: false };
  }

  const subscriptionId = await ctx.db.insert("pushSubscriptions", {
    userId,
    endpoint: normalized.endpoint,
    p256dh: normalized.p256dh,
    auth: normalized.auth,
    ...(normalized.expirationTime === undefined
      ? {}
      : { expirationTime: normalized.expirationTime }),
    createdAt: savedAt,
    updatedAt: savedAt,
  });
  return { status: "saved", subscriptionId, created: true };
}

/**
 * Desactiva una suscripción propia por su endpoint. Un endpoint de otra
 * persona no se borra: responde `false`, igual que uno inexistente.
 */
export async function deletePushSubscription(
  ctx: MutationCtx,
  userId: Id<"users">,
  endpoint: string,
): Promise<boolean> {
  const normalized = endpoint.trim();
  if (normalized === "") return false;
  const existing = await ctx.db
    .query("pushSubscriptions")
    .withIndex("by_endpoint", (q) => q.eq("endpoint", normalized))
    .unique();
  if (existing === null || existing.userId !== userId) return false;
  await ctx.db.delete(existing._id);
  return true;
}

/**
 * Suscripciones de una persona para el adaptador de envío. Es una lectura
 * interna: incluye las claves públicas del navegador y nunca debe publicarse
 * desde una función pública.
 */
export async function findPushSubscriptionsForUser(
  ctx: DbReader,
  userId: Id<"users">,
): Promise<readonly Doc<"pushSubscriptions">[]> {
  return await ctx.db
    .query("pushSubscriptions")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(20);
}
