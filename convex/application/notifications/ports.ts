import type { PaginationOptions, PaginationResult } from "convex/server";
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
