/**
 * Evento de notificación de la atención: forma mínima para consumidores (TI2-100).
 *
 * Dominio puro: no importa Convex, React ni Expo, para que Web y Mobile
 * consuman la misma forma sin levantar el backend. Fija el evento interno
 * con referencias y la variante externa genérica que puede salir de una
 * sesión autenticada sin revelar CERETI, profesional, tipo de acompañamiento
 * ni otros datos sensibles.
 *
 * Sin emisión (TI2-105), sin envío (TI2-122) y sin registro (TI2-110): acá
 * solo hay forma versionada. TI2-105 extiende invariantes sobre esta misma
 * forma, sin otro contrato.
 */

/** Versión del contrato público del evento de notificación. */
export const NOTIFICATION_CONTRACT_VERSION = "v1" as const;

export type NotificationContractVersion = typeof NOTIFICATION_CONTRACT_VERSION;

/** Clases de evento sobre el ciclo de la atención. */
export const NOTIFICATION_EVENT_KIND_VALUES = [
  "appointment_scheduled",
  "appointment_rescheduled",
  "appointment_cancelled",
  "appointment_no_show",
  "appointment_reminder",
] as const;

export type NotificationEventKind = (typeof NOTIFICATION_EVENT_KIND_VALUES)[number];

/** Verdadero cuando el valor es una clase de evento conocida. */
export function isNotificationEventKind(value: string): value is NotificationEventKind {
  return (NOTIFICATION_EVENT_KIND_VALUES as readonly string[]).includes(value);
}

/** Evento interno de notificación: referencias para componer, sin textos. */
export interface NotificationEvent {
  readonly kind: NotificationEventKind;
  readonly appointmentId: string;
  readonly occurredAt: number;
  readonly version: NotificationContractVersion;
}

/**
 * Variante externa genérica: título y cuerpo sin datos sensibles.
 *
 * Es lo único que puede aparecer fuera de una sesión autenticada. Nunca
 * incluye identificadores, CERETI, profesional, tipo de acompañamiento,
 * necesidades, motivos ni notas.
 */
export interface ExternalNotification {
  readonly title: string;
  readonly body: string;
}

/** Textos genéricos por clase de evento, sin datos sensibles. */
const EXTERNAL_NOTIFICATION_TEXTS: Record<NotificationEventKind, ExternalNotification> = {
  appointment_scheduled: {
    title: "Tienes una atención programada",
    body: "Revisa el detalle en la aplicación.",
  },
  appointment_rescheduled: {
    title: "Tu atención cambió de horario",
    body: "Revisa el nuevo horario en la aplicación.",
  },
  appointment_cancelled: {
    title: "Tu atención fue cancelada",
    body: "Revisa la información en la aplicación.",
  },
  appointment_no_show: {
    title: "Tienes una actualización pendiente",
    body: "Revisa las novedades en la aplicación.",
  },
  appointment_reminder: {
    title: "Tienes una atención programada",
    body: "Revisa la hora en la aplicación.",
  },
};

/**
 * Convierte un evento interno a su variante externa genérica.
 *
 * Mapeo total sobre las clases declaradas: una clase desconocida es error,
 * no texto libre, para que ningún evento nuevo filtre datos sin revisión.
 */
export function toExternalNotification(event: NotificationEvent): ExternalNotification {
  const texts = EXTERNAL_NOTIFICATION_TEXTS[event.kind];
  if (texts === undefined) {
    throw new Error("La clase del evento de notificación es desconocida.");
  }
  return { ...texts };
}
