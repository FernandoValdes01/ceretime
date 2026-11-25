/**
 * Evento de notificación, datos autenticados y política de emisión (TI2-100, TI2-105, TI2-150).
 *
 * Dominio puro: no importa Convex, React ni Expo, para que Web y Mobile
 * consuman la misma forma sin levantar el backend. Fija el evento interno
 * con referencias mínimas (un recurso y su destinatario), la variante externa
 * genérica que puede salir de una sesión autenticada sin revelar CERETI,
 * profesional, tipo de acompañamiento, necesidades ni motivo, y la política
 * que traduce el ciclo de la atención, de su justificación y de la solicitud
 * a eventos y destinatarios.
 *
 * La política decide a quién avisa cada cambio, para que la capa que persiste
 * la transición (TI2-110) y la que envía (TI2-122) no elijan destinatarios por
 * su cuenta. Una sola fuente: no existe un evento por canal ni un segundo
 * contrato. TI2-105 completa v1 antes de que exista consumidor; no hay v2.
 */

import {
  findAppointmentTransition,
  type AppointmentStateChange,
  type AppointmentStatus,
} from "../appointments/appointment";
import type { RequestState } from "../requests/state";
import { findRequestTransition } from "../requests/transition_policy";
import type { RequestStateChange } from "../requests/transitions";

/** Versión del contrato público del evento de notificación. */
export const NOTIFICATION_CONTRACT_VERSION = "v1" as const;

export type NotificationContractVersion = typeof NOTIFICATION_CONTRACT_VERSION;

/**
 * Clases de evento de una atención: reserva, cambio de horario, cancelación,
 * inasistencia, recordatorio, acceso en línea y, desde TI2-150, la entrega y
 * la revisión de la justificación. La justificación no tiene fila propia:
 * vive en su atención, que es el recurso que referencia el aviso.
 */
export const APPOINTMENT_NOTIFICATION_EVENT_KIND_VALUES = [
  "appointment_scheduled",
  "appointment_rescheduled",
  "appointment_cancelled",
  "appointment_no_show",
  "appointment_reminder",
  "appointment_online_access_ready",
  "appointment_justification_submitted",
  "appointment_justification_reviewed",
  "appointment_availability_changed",
  "appointment_space_changed",
  "appointment_needs_updated",
] as const;

export type AppointmentNotificationEventKind =
  (typeof APPOINTMENT_NOTIFICATION_EVENT_KIND_VALUES)[number];

/** Verdadero cuando la clase pertenece a una atención. */
export function isAppointmentNotificationEventKind(
  value: string,
): value is AppointmentNotificationEventKind {
  return (APPOINTMENT_NOTIFICATION_EVENT_KIND_VALUES as readonly string[]).includes(value);
}

/**
 * Clases de evento de una solicitud (TI2-145, TI2-150): una por paso de su
 * ciclo. `request_information_provided` es la respuesta del Estudiante, que
 * devuelve la solicitud a revisión; `request_under_review` es la toma.
 */
export const REQUEST_NOTIFICATION_EVENT_KIND_VALUES = [
  "request_received",
  "request_under_review",
  "request_information_requested",
  "request_information_provided",
  "request_accepted",
  "request_referred",
  "request_closed",
  "request_cancelled",
] as const;

export type RequestNotificationEventKind = (typeof REQUEST_NOTIFICATION_EVENT_KIND_VALUES)[number];

/** Verdadero cuando la clase pertenece a una solicitud. */
export function isRequestNotificationEventKind(
  value: string,
): value is RequestNotificationEventKind {
  return (REQUEST_NOTIFICATION_EVENT_KIND_VALUES as readonly string[]).includes(value);
}

/** Todas las clases conocidas, sin perder el recurso al que pertenecen. */
export const NOTIFICATION_EVENT_KIND_VALUES = [
  ...APPOINTMENT_NOTIFICATION_EVENT_KIND_VALUES,
  ...REQUEST_NOTIFICATION_EVENT_KIND_VALUES,
] as const;

export type NotificationEventKind = (typeof NOTIFICATION_EVENT_KIND_VALUES)[number];

/** Verdadero cuando el valor es una clase de evento conocida. */
export function isNotificationEventKind(value: string): value is NotificationEventKind {
  return (NOTIFICATION_EVENT_KIND_VALUES as readonly string[]).includes(value);
}

/**
 * Estado de lectura del aviso para su destinatario. Cada evento tiene un solo
 * destinatario, así que el estado vive en la fila: `pending` mientras no se
 * marcó y `read` desde que existe su instante de lectura.
 */
export const NOTIFICATION_READ_STATUS_VALUES = ["pending", "read"] as const;

export type NotificationReadStatus = (typeof NOTIFICATION_READ_STATUS_VALUES)[number];

/** Verdadero cuando el valor es un estado de lectura conocido. */
export function isNotificationReadStatus(value: string): value is NotificationReadStatus {
  return (NOTIFICATION_READ_STATUS_VALUES as readonly string[]).includes(value);
}

/**
 * Evento interno de notificación: datos mínimos autenticados, sin textos.
 *
 * El evento referencia exactamente un recurso: una atención (`appointmentId`)
 * o una solicitud (`requestId`). Una justificación no tiene fila propia:
 * referencia su atención, donde vive la explicación. Las referencias y
 * `recipientId` son opacas: la notificación autenticada las usa para componer
 * el aviso, pero nunca viajan al texto externo. `recipientId` no trae nombre,
 * correo, rol ni vínculo con el acompañamiento. `occurredAt` es el instante
 * persistido del cambio, no el del reintento, y sostiene la clave de
 * idempotencia.
 */
export interface AppointmentNotificationEvent {
  readonly kind: AppointmentNotificationEventKind;
  readonly appointmentId: string;
  readonly recipientId: string;
  readonly occurredAt: number;
  readonly version: NotificationContractVersion;
}

export interface RequestNotificationEvent {
  readonly kind: RequestNotificationEventKind;
  readonly requestId: string;
  readonly recipientId: string;
  readonly occurredAt: number;
  readonly version: NotificationContractVersion;
}

export type NotificationEvent = AppointmentNotificationEvent | RequestNotificationEvent;

/** Referencia mínima a la atención y a su destinatario, ambos opacos. */
export interface NotificationReference {
  readonly appointmentId: string;
  readonly recipientId: string;
}

/** Referencia mínima a la solicitud y a su destinatario, ambos opacos. */
export interface RequestNotificationReference {
  readonly requestId: string;
  readonly recipientId: string;
}

/** Entrada del constructor: la clase y el recurso se validan en tiempo de ejecución. */
export type NotificationEventInput =
  | (NotificationReference & {
      readonly kind: AppointmentNotificationEventKind;
      readonly occurredAt: number;
    })
  | (RequestNotificationReference & {
      readonly kind: RequestNotificationEventKind;
      readonly occurredAt: number;
    });

/**
 * Participantes de la atención que la política puede avisar.
 *
 * La aplicación los obtiene de la atención y su acompañamiento; acá son
 * referencias opacas, sin nombres ni correos. `additionalProfessionalIds`
 * son los profesionales que acompañan al responsable (TI2-142), ya sin el
 * responsable; ausente cuando no hay.
 */
export interface NotificationSubject {
  readonly appointmentId: string;
  readonly studentId: string;
  readonly professionalId: string;
  readonly additionalProfessionalIds?: readonly string[];
}

/**
 * Destinatario posible de un evento de atención, identificado por su vínculo.
 * `professional` son todos los profesionales de la atención: el responsable
 * y los adicionales.
 */
export type NotificationAudience = "student" | "professional";

/**
 * Participantes de la solicitud que la política puede avisar (TI2-150).
 * `reviewerId` es el Profesional que la tomó; ausente mientras nadie la tomó.
 */
export interface RequestNotificationSubject {
  readonly requestId: string;
  readonly studentId: string;
  readonly reviewerId?: string;
}

/** Destinatario posible de un evento de solicitud: su Estudiante o quien la revisa. */
export type RequestNotificationAudience = "student" | "reviewer";

/** Verdadero cuando el instante es un epoch válido. */
function isValidInstant(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Construye el evento autenticado con exactamente cinco campos y un recurso.
 *
 * Un adaptador que reciba datos de otra capa no puede colar campos extra: el
 * retorno se arma campo por campo. Debe venir una atención o una solicitud,
 * nunca ambas ni ninguna; las referencias vacías y el instante inválido son
 * error, no evento vacío.
 */
export function toNotificationEvent(input: NotificationEventInput): NotificationEvent {
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

  const hasAppointment = "appointmentId" in input;
  const hasRequest = "requestId" in input;
  if (hasAppointment === hasRequest) {
    throw new Error("El evento de notificación requiere exactamente un recurso.");
  }
  if (hasAppointment) {
    if (!isAppointmentNotificationEventKind(input.kind)) {
      throw new Error("La clase del evento de notificación no corresponde a una atención.");
    }
    const appointmentId = (input as NotificationReference).appointmentId.trim();
    if (appointmentId === "") {
      throw new Error("El evento de notificación requiere una atención.");
    }
    return {
      kind: input.kind,
      appointmentId,
      recipientId,
      occurredAt: input.occurredAt,
      version: NOTIFICATION_CONTRACT_VERSION,
    };
  }
  if (!isRequestNotificationEventKind(input.kind)) {
    throw new Error("La clase del evento de notificación no corresponde a una solicitud.");
  }
  const requestId = (input as RequestNotificationReference).requestId.trim();
  if (requestId === "") {
    throw new Error("El evento de notificación requiere una solicitud.");
  }
  return {
    kind: input.kind,
    requestId,
    recipientId,
    occurredAt: input.occurredAt,
    version: NOTIFICATION_CONTRACT_VERSION,
  };
}

/** Política de un estado resultante: clase a emitir y destinatarios. */
interface NotificationPolicyEntry {
  readonly kind: AppointmentNotificationEventKind | null;
  readonly audiences: readonly NotificationAudience[];
}

/** Todos los participantes de la atención. */
const ALL_PARTICIPANTS: readonly NotificationAudience[] = ["student", "professional"];

/**
 * Política por estado resultante de la atención (TI2-105, TI2-150).
 *
 * `Record<AppointmentStatus, …>` obliga a decidir para cada estado declarado:
 * uno nuevo no puede quedar en silencio por omisión. Un cambio de horario o
 * una cancelación avisa a todos los participantes salvo a quien lo hizo
 * (`recipientsFor`), así un profesional adicional también se entera. La
 * inasistencia y la resolución de su justificación avisan al Estudiante.
 * `completed` no emite aviso externo y el recordatorio no nace de una
 * transición (TI2-122).
 */
const NOTIFICATION_POLICY_BY_STATUS: Record<AppointmentStatus, NotificationPolicyEntry> = {
  scheduled: { kind: "appointment_scheduled", audiences: ALL_PARTICIPANTS },
  completed: { kind: null, audiences: [] },
  cancelled_by_student: { kind: "appointment_cancelled", audiences: ALL_PARTICIPANTS },
  cancelled_by_cereti: { kind: "appointment_cancelled", audiences: ALL_PARTICIPANTS },
  rescheduled: { kind: "appointment_rescheduled", audiences: ALL_PARTICIPANTS },
  no_show: { kind: "appointment_no_show", audiences: ["student"] },
  no_show_justified: { kind: "appointment_justification_reviewed", audiences: ["student"] },
  no_show_unjustified: { kind: "appointment_justification_reviewed", audiences: ["student"] },
};

/** Referencias de los destinatarios según su vínculo con la atención. */
function recipientIdsFor(
  subject: NotificationSubject,
  audience: NotificationAudience,
): readonly string[] {
  return audience === "student"
    ? [subject.studentId]
    : [subject.professionalId, ...(subject.additionalProfessionalIds ?? [])];
}

/**
 * Destinatarios de las audiencias, una vez cada uno y sin quien hizo el
 * cambio: el actor ya lo sabe. Un actor que no participa (por ejemplo, una
 * coordinación) no excluye a nadie.
 */
function recipientsFor(
  subject: NotificationSubject,
  audiences: readonly NotificationAudience[],
  actorId: string,
): readonly string[] {
  const actor = actorId.trim();
  const recipients: string[] = [];
  for (const audience of audiences) {
    for (const recipientId of recipientIdsFor(subject, audience)) {
      const trimmed = recipientId.trim();
      if (trimmed !== actor && !recipients.includes(trimmed)) recipients.push(trimmed);
    }
  }
  return recipients;
}

/** Arma un evento por destinatario, sin duplicar la clase ni los textos. */
function eventsFor(
  kind: AppointmentNotificationEventKind,
  subject: NotificationSubject,
  recipientIds: readonly string[],
  occurredAt: number,
): readonly NotificationEvent[] {
  return recipientIds.map((recipientId) =>
    toNotificationEvent({ kind, appointmentId: subject.appointmentId, recipientId, occurredAt }),
  );
}

/**
 * Eventos de una atención recién creada (TI2-105, TI2-150).
 *
 * `occurredAt` es el instante persistido de la reserva y `actorId` quien la
 * hizo. El Estudiante siempre recibe la confirmación, aunque haya reservado
 * él; los profesionales de la atención reciben el aviso salvo quien reservó
 * en nombre del Estudiante (TI2-142).
 */
export function notificationEventsForCreation(
  subject: NotificationSubject,
  occurredAt: number,
  actorId: string,
): readonly NotificationEvent[] {
  const professionals = recipientsFor(subject, ["professional"], actorId);
  return eventsFor(
    "appointment_scheduled",
    subject,
    [subject.studentId, ...professionals],
    occurredAt,
  );
}

/**
 * Evento de una atención en línea cuyo enlace privado se agregó o reemplazó
 * (TI2-142).
 *
 * Avisa solo al Estudiante: el profesional que lo agregó ya lo sabe. La clase
 * no distingue agregar de reemplazar; el texto externo no lleva el enlace y
 * el Estudiante lo lee en su sesión. `occurredAt` es el instante persistido
 * del cambio, así un reintento repite la clave y un reemplazo posterior
 * produce otra. Un enlace sin cambios no llega acá (`unchanged`).
 */
export function notificationEventsForOnlineAccess(
  subject: NotificationSubject,
  occurredAt: number,
): readonly NotificationEvent[] {
  return eventsFor("appointment_online_access_ready", subject, [subject.studentId], occurredAt);
}

/**
 * Evento de la justificación que el Estudiante entregó (TI2-150).
 *
 * La entrega no cambia el estado de la atención, así que no pasa por la
 * política de transiciones: avisa a los profesionales de la atención, que la
 * revisan. El evento referencia la atención y nunca la explicación.
 */
export function notificationEventsForJustificationSubmitted(
  subject: NotificationSubject,
  occurredAt: number,
): readonly NotificationEvent[] {
  return eventsFor(
    "appointment_justification_submitted",
    subject,
    recipientsFor(subject, ["professional"], subject.studentId),
    occurredAt,
  );
}

/**
 * Aviso de cambio de disponibilidad que puede afectar la atención (TI2-156).
 *
 * No cambia el estado de la atención: la conserva y avisa para coordinar una
 * solución con los flujos existentes (reagendar o cancelar). Avisa a todos los
 * participantes salvo a quien hizo el cambio, igual que una transición.
 */
export function notificationEventsForAvailabilityChange(
  subject: NotificationSubject,
  occurredAt: number,
  actorId: string,
): readonly NotificationEvent[] {
  return eventsFor(
    "appointment_availability_changed",
    subject,
    recipientsFor(subject, ALL_PARTICIPANTS, actorId),
    occurredAt,
  );
}

/**
 * Aviso de cambio de sala o condiciones que puede afectar la atención (TI2-156).
 *
 * El actor es la administración del catálogo, que no participa de la atención,
 * así que avisa a todos sus participantes. No borra ni cancela la atención.
 */
export function notificationEventsForSpaceChange(
  subject: NotificationSubject,
  occurredAt: number,
  actorId: string,
): readonly NotificationEvent[] {
  return eventsFor(
    "appointment_space_changed",
    subject,
    recipientsFor(subject, ALL_PARTICIPANTS, actorId),
    occurredAt,
  );
}

/**
 * Aviso de actualización de necesidades de acceso (TI2-156).
 *
 * El estudiante actualiza sus necesidades para atenciones futuras sin alterar
 * lo registrado antes. Avisa solo a los profesionales de la atención, que
 * coordinan la solución; el estudiante ya conoce su propio cambio.
 */
export function notificationEventsForNeedsUpdated(
  subject: NotificationSubject,
  occurredAt: number,
): readonly NotificationEvent[] {
  return eventsFor(
    "appointment_needs_updated",
    subject,
    recipientsFor(subject, ["professional"], subject.studentId),
    occurredAt,
  );
}

/**
 * Eventos de una transición de la atención, vacío si esa transición no avisa.
 *
 * Solo acepta pares declarados en `APPOINTMENT_TRANSITIONS`: un par ausente
 * es un error de programación, no una notificación silenciosa. El instante
 * sale del cambio persistido para que un reintento produzca la misma clave.
 */
export function notificationEventsForTransition(
  subject: NotificationSubject,
  change: AppointmentStateChange,
): readonly NotificationEvent[] {
  if (findAppointmentTransition(change.from, change.to) === undefined) {
    throw new Error("La transición de la atención no está declarada y no puede notificarse.");
  }
  const policy = NOTIFICATION_POLICY_BY_STATUS[change.to];
  if (policy.kind === null) return [];
  return eventsFor(
    policy.kind,
    subject,
    recipientsFor(subject, policy.audiences, change.actorId),
    change.occurredAt,
  );
}

/** Política de un paso de la solicitud: clase y destinatario. */
interface RequestNotificationPolicyEntry {
  readonly kind: RequestNotificationEventKind;
  readonly audience: RequestNotificationAudience;
}

/**
 * Política por estado resultante de la solicitud (TI2-150).
 *
 * `Record<RequestState, …>` obliga a decidir para cada estado. Los pasos del
 * Profesional avisan al Estudiante; la cancelación del Estudiante avisa a
 * quien la revisa. `received` solo nace con el registro y `under_review`
 * desde la espera es la respuesta del Estudiante, que decide
 * `requestPolicyFor`.
 */
const REQUEST_NOTIFICATION_POLICY_BY_STATE: Record<RequestState, RequestNotificationPolicyEntry> = {
  received: { kind: "request_received", audience: "student" },
  under_review: { kind: "request_under_review", audience: "student" },
  awaiting_information_or_acceptance: {
    kind: "request_information_requested",
    audience: "student",
  },
  accepted: { kind: "request_accepted", audience: "student" },
  referred: { kind: "request_referred", audience: "student" },
  closed_without_accompaniment: { kind: "request_closed", audience: "student" },
  cancelled: { kind: "request_cancelled", audience: "reviewer" },
};

/** La respuesta del Estudiante devuelve la solicitud a revisión y avisa a quien la revisa. */
const INFORMATION_PROVIDED_POLICY: RequestNotificationPolicyEntry = {
  kind: "request_information_provided",
  audience: "reviewer",
};

function requestPolicyFor(change: RequestStateChange): RequestNotificationPolicyEntry {
  if (change.from === "awaiting_information_or_acceptance" && change.to === "under_review") {
    return INFORMATION_PROVIDED_POLICY;
  }
  return REQUEST_NOTIFICATION_POLICY_BY_STATE[change.to];
}

/** Arma el evento de la solicitud, o ninguno si su destinatario no existe o hizo el cambio. */
function requestEventsFor(
  subject: RequestNotificationSubject,
  policy: RequestNotificationPolicyEntry,
  occurredAt: number,
  actorId?: string,
): readonly NotificationEvent[] {
  const recipientId = (
    policy.audience === "student" ? subject.studentId : (subject.reviewerId ?? "")
  ).trim();
  if (recipientId === "" || recipientId === actorId?.trim()) return [];
  return [
    toNotificationEvent({
      kind: policy.kind,
      requestId: subject.requestId,
      recipientId,
      occurredAt,
    }),
  ];
}

/**
 * Aviso de recepción de una solicitud (TI2-145, TI2-150).
 *
 * Confirma al Estudiante que la solicitud quedó registrada, la haya enviado
 * él o la haya registrado el personal por canal oficial. `occurredAt` es el
 * instante persistido de la fila, así el reintento con la misma clave de
 * envío repite la clave del aviso y no deja otro.
 */
export function notificationEventsForRequestReceived(
  subject: RequestNotificationSubject,
  occurredAt: number,
): readonly NotificationEvent[] {
  return requestEventsFor(subject, REQUEST_NOTIFICATION_POLICY_BY_STATE.received, occurredAt);
}

/**
 * Eventos de un cambio de estado de la solicitud (TI2-150).
 *
 * Solo acepta pares declarados en `REQUEST_TRANSITIONS`. Quien hizo el
 * cambio no se avisa a sí mismo, y una cancelación de una solicitud que nadie
 * tomó no tiene a quién avisar. El evento lleva la solicitud y el
 * destinatario, nunca el motivo, la respuesta ni las necesidades.
 */
export function notificationEventsForRequestTransition(
  subject: RequestNotificationSubject,
  change: RequestStateChange,
): readonly NotificationEvent[] {
  if (findRequestTransition(change.from, change.to) === undefined) {
    throw new Error("La transición de la solicitud no está declarada y no puede notificarse.");
  }
  return requestEventsFor(subject, requestPolicyFor(change), change.occurredAt, change.actorId);
}

/**
 * Clave de idempotencia estable para reintentos de la misma emisión.
 *
 * Se compone de versión, clase, recurso, destinatario e instante persistido.
 * Dos reintentos del mismo cambio reutilizan la clave; un cambio distinto
 * (otra clase, otro recurso, otro destinatario u otro instante) produce otra.
 * La tupla se representa como lista para que ningún identificador pueda
 * colisionar con un separador. Las claves de atención conservan la forma
 * anterior a TI2-145 para que un reintento de un aviso ya guardado siga
 * encontrando su fila; las de solicitud llevan la marca `request`. La
 * comparación para evitar duplicados y el registro los hace el repositorio
 * de notificaciones (TI2-118).
 */
export function notificationIdempotencyKey(event: NotificationEvent): string {
  if ("appointmentId" in event) {
    return JSON.stringify([
      event.version,
      event.kind,
      event.appointmentId,
      event.recipientId,
      event.occurredAt,
    ]);
  }
  return JSON.stringify([
    event.version,
    event.kind,
    "request",
    event.requestId,
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

/**
 * Texto de las clases que no deben decir qué cambió fuera de sesión: la
 * inasistencia, la justificación y los pasos de la solicitud revelarían que
 * hay un acompañamiento en curso.
 */
const PENDING_UPDATE_TEXT: ExternalNotification = {
  title: "Tienes una actualización pendiente",
  body: "Revisa las novedades en la aplicación.",
};

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
  appointment_no_show: PENDING_UPDATE_TEXT,
  appointment_reminder: {
    title: "Tienes una atención programada",
    body: "Revisa la hora en la aplicación.",
  },
  appointment_online_access_ready: {
    title: "Tu atención tiene su acceso disponible",
    body: "Revisa cómo ingresar en la aplicación.",
  },
  appointment_justification_submitted: PENDING_UPDATE_TEXT,
  appointment_justification_reviewed: PENDING_UPDATE_TEXT,
  appointment_availability_changed: PENDING_UPDATE_TEXT,
  appointment_space_changed: PENDING_UPDATE_TEXT,
  appointment_needs_updated: PENDING_UPDATE_TEXT,
  request_received: PENDING_UPDATE_TEXT,
  request_under_review: PENDING_UPDATE_TEXT,
  request_information_requested: PENDING_UPDATE_TEXT,
  request_information_provided: PENDING_UPDATE_TEXT,
  request_accepted: PENDING_UPDATE_TEXT,
  request_referred: PENDING_UPDATE_TEXT,
  request_closed: PENDING_UPDATE_TEXT,
  request_cancelled: PENDING_UPDATE_TEXT,
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
