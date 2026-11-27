import type { PaginationOptions, PaginationResult } from "convex/server";
import { isProfileActive } from "../../domain/authorization/permissions";
import {
  conflictError,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import type { NotificationReadStatus } from "../../domain/notifications/notification";
import { findReadableAppointment, type AppointmentReadDeps } from "../appointments/queries";
import type { AuthorizationReader } from "../authorization/authorize";
import { findReadableRequest, type RequestReadDeps } from "../requests/queries";
import type { NotificationInboxReader, NotificationReadMarker, StoredNotification } from "./ports";

/**
 * Bandeja de avisos (TI2-154): listar los propios, marcarlos como leídos y
 * abrir el recurso de un aviso.
 *
 * Capa de Aplicación: el destinatario siempre es el perfil vigente de la
 * sesión, nunca un identificador del cliente, y un aviso de otra persona se
 * deniega igual que uno inexistente. El aviso solo trae la clase y la
 * referencia al recurso; abrirlo vuelve a comprobar el permiso vigente con la
 * misma regla que el detalle del recurso (`findReadableAppointment`, que usa
 * `authorizeAppointmentRead`, para una atención y `findReadableRequest` para
 * una solicitud). Quien perdió el permiso recibe `unauthorized` sin saber si
 * el recurso existe. Opera con datos ficticios.
 */

/** Tope de avisos por página, el mismo que la agenda (`LIST_APPOINTMENTS_PAGE_LIMIT_MAX`). */
export const NOTIFICATION_PAGE_LIMIT_MAX = 50;

/** Dependencias del listado. */
export interface ListOwnNotificationsDeps<
  NotificationId extends string,
  UserId extends string,
  RequestId extends string,
> {
  readonly auth: AuthorizationReader;
  readonly notifications: NotificationInboxReader<NotificationId, UserId, RequestId>;
}

/** Dependencias de la marca de lectura. */
export interface MarkNotificationReadDeps {
  readonly auth: AuthorizationReader;
  readonly notifications: NotificationReadMarker;
  /** Reloj del servidor para el instante de lectura; las pruebas lo fijan. */
  readonly now: () => number;
}

/** Dependencias de abrir un aviso: su lectura y las reglas de cada recurso. */
export interface OpenNotificationDeps<
  NotificationId extends string,
  UserId extends string,
  RequestId extends string,
> {
  readonly auth: AuthorizationReader;
  readonly notifications: NotificationInboxReader<NotificationId, UserId, RequestId>;
  readonly appointments: AppointmentReadDeps["appointments"];
  readonly requests: RequestReadDeps<string, string>;
}

/** Aviso y sesión de quien lo marca o lo abre. */
export interface NotificationRequest {
  readonly tokenIdentifier: string | null;
  readonly notificationId: string;
}

function denied<T>(): ApiResult<T> {
  return errResult(unauthorizedError());
}

/** Perfil vigente de la sesión, de cualquier rol, o `null`. */
async function findRecipientId(
  auth: AuthorizationReader,
  tokenIdentifier: string | null,
): Promise<string | null> {
  if (tokenIdentifier === null) return null;
  const profile = await auth.findProfileByTokenIdentifier(tokenIdentifier);
  return profile === null || !isProfileActive(profile) ? null : profile._id;
}

/**
 * Lista los avisos propios, del más reciente al más antiguo, todos o solo los
 * leídos o los pendientes. Sin perfil vigente responde `unauthorized`; un
 * tamaño de página no finito, `conflict`. El tamaño se acota a
 * `NOTIFICATION_PAGE_LIMIT_MAX`.
 */
export async function listOwnNotifications<
  NotificationId extends string,
  UserId extends string,
  RequestId extends string,
>(
  deps: ListOwnNotificationsDeps<NotificationId, UserId, RequestId>,
  input: {
    readonly tokenIdentifier: string | null;
    readonly readStatus?: NotificationReadStatus;
    readonly paginationOpts: PaginationOptions;
  },
): Promise<ApiResult<PaginationResult<StoredNotification<NotificationId, UserId, RequestId>>>> {
  const recipientId = await findRecipientId(deps.auth, input.tokenIdentifier);
  if (recipientId === null) return denied();
  if (!Number.isFinite(input.paginationOpts.numItems)) return errResult(conflictError());
  const numItems = Math.min(
    Math.max(Math.floor(input.paginationOpts.numItems), 1),
    NOTIFICATION_PAGE_LIMIT_MAX,
  );
  return okResult(
    await deps.notifications.listOwn(recipientId, input.readStatus, {
      ...input.paginationOpts,
      numItems,
    }),
  );
}

/**
 * Marca como leído un aviso propio. Repetirlo responde el instante de la
 * primera lectura. Un aviso ajeno o inexistente responde `unauthorized` sin
 * escribir.
 */
export async function markNotificationRead(
  deps: MarkNotificationReadDeps,
  input: NotificationRequest,
): Promise<
  ApiResult<{ readonly id: string; readonly readStatus: "read"; readonly readAt: number }>
> {
  const recipientId = await findRecipientId(deps.auth, input.tokenIdentifier);
  if (recipientId === null) return denied();
  const marked = await deps.notifications.markRead(recipientId, input.notificationId, deps.now());
  if (marked === null) return denied();
  return okResult({ id: input.notificationId, readStatus: "read", readAt: marked.readAt });
}

/**
 * Abre un aviso propio: lo entrega con su recurso solo si quien llama todavía
 * puede leer ese recurso. Un aviso ajeno o inexistente, o uno cuyo recurso ya
 * no puede leer (asignación revocada, toma retirada, cuenta no vigente),
 * responde el mismo `unauthorized`. No marca el aviso como leído: eso es
 * `markNotificationRead`, porque una consulta no escribe.
 */
export async function openNotification<
  NotificationId extends string,
  UserId extends string,
  RequestId extends string,
>(
  deps: OpenNotificationDeps<NotificationId, UserId, RequestId>,
  input: NotificationRequest,
): Promise<ApiResult<StoredNotification<NotificationId, UserId, RequestId>>> {
  const recipientId = await findRecipientId(deps.auth, input.tokenIdentifier);
  if (recipientId === null) return denied();
  const notification = await deps.notifications.getOwn(recipientId, input.notificationId);
  if (notification === null) return denied();
  const readable = await canReadResource(deps, input.tokenIdentifier, notification);
  return readable ? okResult(notification) : denied();
}

/** La misma regla que el detalle de cada recurso, evaluada en este momento. */
async function canReadResource(
  deps: OpenNotificationDeps<string, string, string>,
  tokenIdentifier: string | null,
  notification: StoredNotification,
): Promise<boolean> {
  if ("appointmentId" in notification) {
    const appointment = await findReadableAppointment(
      {
        auth: deps.auth,
        appointments: deps.appointments,
        privacyCategory: "notifications",
      },
      { tokenIdentifier, appointmentId: notification.appointmentId },
    );
    return appointment !== null;
  }
  const request = await findReadableRequest(deps.requests, {
    tokenIdentifier,
    requestId: notification.requestId,
  });
  return request !== null;
}
