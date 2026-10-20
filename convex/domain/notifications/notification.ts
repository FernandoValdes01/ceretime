/**
 * Evento de notificación de la atención, datos autenticados y política de emisión (TI2-100, TI2-105).
 *
 * Dominio puro: no importa Convex, React ni Expo, para que Web y Mobile
 * consuman la misma forma sin levantar el backend. Fija el evento interno
 * con referencias mínimas (atención y destinatario), la variante externa
 * genérica que puede salir de una sesión autenticada sin revelar CERETI,
 * profesional, tipo de acompañamiento, necesidades ni motivo, y la política
 * que traduce el ciclo de la atención a eventos.
 *
 * Una sola fuente: no existe un evento por canal ni un segundo contrato.
 * TI2-105 completa v1 con la referencia al destinatario y la emisión antes
 * de que exista consumidor; no hay v2. Sin envío (TI2-122) y sin registro
 * persistente (TI2-110): la entrega y el registro sin duplicados son de esas
 * issues.
 */

import {
  findAppointmentTransition,
  type AppointmentStateChange,
  type AppointmentStatus,
} from "../appointments/appointment";

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

/**
 * Evento interno de notificación: datos mínimos autenticados, sin textos.
 *
 * `appointmentId` y `recipientId` son referencias opacas: la notificación
 * autenticada las usa para componer el aviso, pero nunca viajan al texto
 * externo. `recipientId` es la referencia mínima al destinatario; no trae
 * nombre, correo, rol ni vínculo con el acompañamiento. `occurredAt` es el
 * instante persistido del cambio, no el del reintento, y sostiene la clave
 * de idempotencia.
 */
export interface NotificationEvent {
  readonly kind: NotificationEventKind;
  readonly appointmentId: string;
  readonly recipientId: string;
  readonly occurredAt: number;
  readonly version: NotificationContractVersion;
}

/** Referencia mínima a la atención y a su destinatario, ambos opacos. */
export interface NotificationReference {
  readonly appointmentId: string;
  readonly recipientId: string;
}

/** Entrada del constructor: la clase se valida también en tiempo de ejecución. */
export interface NotificationEventInput extends NotificationReference {
  readonly kind: NotificationEventKind;
  readonly occurredAt: number;
}

/** Verdadero cuando el instante es un epoch válido. */
function isValidInstant(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Construye el evento autenticado con exactamente cinco campos.
 *
 * Un adaptador que reciba datos de otra capa no puede colar campos extra:
 * el retorno se arma campo por campo. Las referencias vacías y el instante
 * inválido son error, no evento vacío.
 */
export function toNotificationEvent(input: NotificationEventInput): NotificationEvent {
  const appointmentId = input.appointmentId.trim();
  if (appointmentId === "") {
    throw new Error("El evento de notificación requiere una atención.");
  }
  const recipientId = input.recipientId.trim();
  if (recipientId === "") {
    throw new Error("El evento de notificación requiere un destinatario.");
  }
  if (!isValidInstant(input.occurredAt)) {
    throw new Error("El evento de notificación requiere un instante epoch válido.");
  }
  if (!isNotificationEventKind(input.kind)) {
    throw new Error("La clase del evento de notificación es desconocida.");
  }
  return {
    kind: input.kind,
    appointmentId,
    recipientId,
    occurredAt: input.occurredAt,
    version: NOTIFICATION_CONTRACT_VERSION,
  };
}

/**
 * Destinos que emiten evento, por estado resultante de la atención.
 *
 * La confirmación sale de la creación, que deja la atención en `scheduled`;
 * los demás destinos salen de una transición declarada. `completed` y la
 * resolución de la justificación no emiten aviso externo: el estudiante ve
 * la atención realizada en la aplicación y la revisión de la inasistencia es
 * TI2-119. El recordatorio no nace de una transición (TI2-122).
 */
export const NOTIFICATION_EMITTING_KIND_BY_STATUS: Readonly<
  Partial<Record<AppointmentStatus, NotificationEventKind>>
> = {
  scheduled: "appointment_scheduled",
  rescheduled: "appointment_rescheduled",
  cancelled_by_student: "appointment_cancelled",
  cancelled_by_cereti: "appointment_cancelled",
  no_show: "appointment_no_show",
};

/**
 * Evento de confirmación de una atención recién creada.
 *
 * `occurredAt` es el instante persistido de la reserva. La creación siempre
 * deja la atención en `scheduled`, así que no recibe un estado como entrada.
 */
export function notificationEventForCreation(
  reference: NotificationReference,
  occurredAt: number,
): NotificationEvent {
  return toNotificationEvent({
    kind: "appointment_scheduled",
    appointmentId: reference.appointmentId,
    recipientId: reference.recipientId,
    occurredAt,
  });
}

/**
 * Evento de una transición de la atención, o `null` si esa transición no avisa.
 *
 * Solo acepta pares declarados en `APPOINTMENT_TRANSITIONS`: un par ausente
 * es un error de programación, no una notificación silenciosa. El instante
 * sale del cambio persistido para que un reintento produzca la misma clave.
 */
export function notificationEventForTransition(
  reference: NotificationReference,
  change: AppointmentStateChange,
): NotificationEvent | null {
  if (findAppointmentTransition(change.from, change.to) === undefined) {
    throw new Error("La transición de la atención no está declarada y no puede notificarse.");
  }
  const kind = NOTIFICATION_EMITTING_KIND_BY_STATUS[change.to];
  if (kind === undefined) {
    return null;
  }
  return toNotificationEvent({
    kind,
    appointmentId: reference.appointmentId,
    recipientId: reference.recipientId,
    occurredAt: change.occurredAt,
  });
}

/**
 * Clave de idempotencia estable para reintentos de la misma emisión.
 *
 * Se compone de versión, clase, atención, destinatario e instante persistido.
 * Dos reintentos del mismo cambio reutilizan la clave; un cambio distinto
 * (otra clase, otra atención, otro destinatario u otro instante) produce otra.
 * La tupla se representa como lista para que ningún identificador pueda
 * colisionar con un separador. La comparación para evitar duplicados y el
 * registro son de TI2-110.
 */
export function notificationIdempotencyKey(event: NotificationEvent): string {
  return JSON.stringify([
    event.version,
    event.kind,
    event.appointmentId,
    event.recipientId,
    event.occurredAt,
  ]);
}

/**
 * Variante externa genérica: título y cuerpo sin datos sensibles.
 *
 * Es lo único que puede aparecer fuera de una sesión autenticada. Nunca
 * incluye identificadores, CERETI, profesional, tipo de acompañamiento,
 * necesidades, motivos ni notas. Depende solo de la clase del evento: dos
 * atenciones o destinatarios distintos con la misma clase reciben el mismo
 * texto.
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
