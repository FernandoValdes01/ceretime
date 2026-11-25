import type { PaginationOptions, PaginationResult } from "convex/server";
import type { NotificationDeliveryError } from "../../domain/notifications/delivery";
import type {
  AppointmentNotificationEvent,
  NotificationEvent,
  NotificationReadStatus,
  RequestNotificationEvent,
} from "../../domain/notifications/notification";

/**
 * Registro de los eventos de aviso que produjo la política de Dominio
 * (TI2-105, TI2-118, TI2-150).
 *
 * Capa de Aplicación: lo usan las solicitudes, la agenda y la justificación
 * después de persistir su cambio, dentro de la misma mutation que arma
 * Presentación. Si el cambio se rechaza, Presentación lanza el error y la
 * mutation descarta también el aviso. Infraestructura lo cumple con
 * `notificationEventRecorder`, que no duplica una clave ya registrada.
 */
export interface NotificationEventRecorder {
  record(events: readonly NotificationEvent[]): Promise<void>;
}

/** Correo ya compuesto con el texto genérico del aviso, sin datos sensibles. */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** Resultado de un envío por canal, con un código estable y genérico si falló. */
export type DeliverySendResult =
  | { readonly status: "sent" }
  | { readonly status: "failed"; readonly errorCode: NotificationDeliveryError };

/**
 * Remitente de correo (TI2-159). Infraestructura lo cumple con el proveedor
 * configurado; cambiar de remitente o de proveedor no toca el despacho. Nunca
 * lanza por un fallo del proveedor: lo traduce a `failed`.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<DeliverySendResult>;
}

/**
 * Entrega reservada para un intento: el aviso persistido y el correo de su
 * destinatario. `skipped` cubre una entrega ya enviada, reservada por otro
 * despacho, sin intento pendiente o inexistente; `no_destination`, un
 * destinatario sin correo.
 */
export type EmailDeliveryClaim =
  | {
      readonly status: "claimed";
      readonly eventId: string;
      readonly event: NotificationEvent;
      readonly recipientEmail: string;
    }
  | { readonly status: "no_destination"; readonly eventId: string }
  | { readonly status: "skipped" };

/**
 * Persistencia de las entregas por correo (TI2-145, TI2-159). Cada llamada es
 * una transacción propia: el envío ocurre entre la reserva y el registro, y
 * nunca dentro de la mutation que originó el aviso.
 */
export interface EmailDeliveryStore {
  claim(deliveryId: string, now: number): Promise<EmailDeliveryClaim>;
  recordAttempt(eventId: string, result: DeliverySendResult, attemptedAt: number): Promise<void>;
}

/**
 * Aviso guardado con su identificador y su estado de lectura (TI2-145). Es la
 * forma que entrega el repositorio, sin la clave de idempotencia.
 */
export type StoredNotification<
  NotificationId extends string = string,
  UserId extends string = string,
  RequestId extends string = string,
> =
  | (Omit<AppointmentNotificationEvent, "recipientId"> &
      StoredNotificationFields<NotificationId, UserId>)
  | (Omit<RequestNotificationEvent, "recipientId" | "requestId"> &
      StoredNotificationFields<NotificationId, UserId> & { readonly requestId: RequestId });

/**
 * Lo que suma el aviso guardado. Los identificadores son genéricos (TI2-154):
 * Infraestructura entrega los de Convex y Presentación los publica sin
 * convertirlos, como en las solicitudes.
 */
type StoredNotificationFields<NotificationId extends string, UserId extends string> = {
  readonly id: NotificationId;
  readonly recipientId: UserId;
  readonly readStatus: NotificationReadStatus;
  readonly readAt?: number;
};

/**
 * Lectura de la bandeja de una persona (TI2-154). Toda lectura recibe el
 * destinatario resuelto en el servidor: un aviso de otra persona responde
 * igual que uno inexistente (`null`). Sin filtro de lectura, la página trae
 * leídos y pendientes, del más reciente al más antiguo.
 */
export interface NotificationInboxReader<
  NotificationId extends string = string,
  UserId extends string = string,
  RequestId extends string = string,
> {
  listOwn(
    recipientId: string,
    readStatus: NotificationReadStatus | undefined,
    paginationOpts: PaginationOptions,
  ): Promise<PaginationResult<StoredNotification<NotificationId, UserId, RequestId>>>;
  getOwn(
    recipientId: string,
    notificationId: string,
  ): Promise<StoredNotification<NotificationId, UserId, RequestId> | null>;
}

/**
 * Marca de lectura de un aviso propio (TI2-154). `null` cuando el aviso no
 * existe o es de otra persona; un reintento conserva el instante original.
 */
export interface NotificationReadMarker {
  markRead(
    recipientId: string,
    notificationId: string,
    readAt: number,
  ): Promise<{ readonly readAt: number } | null>;
}

/** Suscripción del navegador lista para el adaptador push (TI2-160). */
export interface PushSubscriptionTarget {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

/** Mensaje genérico enviado por Web Push, sin datos del acompañamiento. */
export interface PushMessage {
  readonly title: string;
  readonly body: string;
}

/** Resultado por suscripción: `expired` indica que el navegador la revocó (404/410). */
export type PushSendResult =
  | { readonly status: "sent" }
  | { readonly status: "expired" }
  | { readonly status: "failed"; readonly errorCode: NotificationDeliveryError };

/**
 * Remitente Web Push (TI2-160). Infraestructura lo cumple con VAPID; cambiar
 * de proveedor no toca el despacho. Nunca lanza por un fallo del servicio.
 */
export interface PushSender {
  send(target: PushSubscriptionTarget, message: PushMessage): Promise<PushSendResult>;
}

/**
 * Entrega push reservada para un intento, con las suscripciones vigentes del
 * destinatario. `no_subscriptions` ocurre cuando la persona desactivó push
 * antes del intento; `skipped`, si ya se envió o otro despacho la tomó.
 */
export type PushDeliveryClaim =
  | {
      readonly status: "claimed";
      readonly eventId: string;
      readonly event: NotificationEvent;
      readonly subscriptions: readonly PushSubscriptionTarget[];
    }
  | { readonly status: "no_subscriptions"; readonly eventId: string }
  | { readonly status: "skipped" };

/**
 * Persistencia de entregas push y limpieza de suscripciones vencidas (TI2-160).
 */
export interface PushDeliveryStore {
  claim(deliveryId: string, now: number): Promise<PushDeliveryClaim>;
  removeExpiredSubscription(endpoint: string): Promise<void>;
  recordAttempt(eventId: string, result: DeliverySendResult, attemptedAt: number): Promise<void>;
}

/** Datos que el navegador entrega al activar una suscripción push propia. */
export interface PushSubscriptionActivationInput {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly expirationTime?: number;
}

/**
 * Lectura de suscripciones propias para consultar si el usuario tiene push
 * activo (TI2-160). Nunca devuelve claves ni endpoints.
 */
export interface PushSubscriptionReader {
  countForUser(userId: string): Promise<number>;
}

/**
 * Persistencia de suscripciones propias para activar, desactivar y consultar
 * si el usuario tiene push activo (TI2-160). Nunca devuelve claves ni endpoints.
 */
export interface PushSubscriptionStore extends PushSubscriptionReader {
  saveForUser(
    userId: string,
    input: PushSubscriptionActivationInput,
    savedAt: number,
  ): Promise<
    { readonly status: "saved"; readonly created: boolean } | { readonly status: "invalid" }
  >;
  deleteForUser(userId: string, endpoint: string): Promise<boolean>;
}
