import type { NotificationDeliveryError } from "../../domain/notifications/delivery";
import type { NotificationEvent } from "../../domain/notifications/notification";

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

/** Resultado de un envío, con un código estable y genérico si falló. */
export type EmailSendResult =
  | { readonly status: "sent" }
  | { readonly status: "failed"; readonly errorCode: NotificationDeliveryError };

/**
 * Remitente de correo (TI2-159). Infraestructura lo cumple con el proveedor
 * configurado; cambiar de remitente o de proveedor no toca el despacho. Nunca
 * lanza por un fallo del proveedor: lo traduce a `failed`.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<EmailSendResult>;
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
  recordAttempt(eventId: string, result: EmailSendResult, attemptedAt: number): Promise<void>;
}
