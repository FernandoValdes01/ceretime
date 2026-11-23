import {
  notificationEventsForRequestReceived,
  notificationEventsForRequestTransition,
  type RequestNotificationSubject,
} from "../../domain/notifications/notification";
import type { RequestStateChange } from "../../domain/requests/transitions";
import type { NotificationEventRecorder } from "../notifications/ports";
import type { StoredRequestRow } from "./ports";

/**
 * Avisos de las operaciones de solicitudes (TI2-150).
 *
 * Capa de Aplicación: traduce la fila leída a los participantes que considera
 * la política de Dominio y entrega sus eventos al puerto, después de que la
 * operación persistió su cambio y en la misma mutation. Quién recibe cada
 * aviso lo decide Dominio; acá no se elige destinatario.
 */

type NotifiableRequestRow = Pick<StoredRequestRow<string, string>, "_id" | "studentId" | "takenBy">;

function toRequestNotificationSubject(row: NotifiableRequestRow): RequestNotificationSubject {
  return {
    requestId: row._id,
    studentId: row.studentId,
    ...(row.takenBy === undefined ? {} : { reviewerId: row.takenBy }),
  };
}

/**
 * Avisa la recepción de una solicitud registrada. Usa el instante persistido
 * de la fila: un reintento con la misma clave de envío lee la misma fila y no
 * deja un segundo aviso.
 */
export async function notifyRequestReceived(
  notifications: NotificationEventRecorder,
  row: NotifiableRequestRow & Pick<StoredRequestRow<string, string>, "createdAt">,
): Promise<void> {
  await notifications.record(
    notificationEventsForRequestReceived(toRequestNotificationSubject(row), row.createdAt),
  );
}

/**
 * Avisa un cambio de estado ya persistido, con el instante del cambio. Quien
 * revisa es el Profesional que tomó la solicitud (`takenBy`); la toma misma
 * avisa al Estudiante, así que no necesita la fila ya tomada.
 */
export async function notifyRequestChange(
  notifications: NotificationEventRecorder,
  row: NotifiableRequestRow,
  change: RequestStateChange,
): Promise<void> {
  await notifications.record(
    notificationEventsForRequestTransition(toRequestNotificationSubject(row), change),
  );
}
