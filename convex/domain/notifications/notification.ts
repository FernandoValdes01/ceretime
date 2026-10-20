/**
 * Evento de notificación de la atención, datos autenticados y política de emisión (TI2-100, TI2-105).
 *
 * Dominio puro: no importa Convex, React ni Expo, para que Web y Mobile
 * consuman la misma forma sin levantar el backend. Fija el evento interno
 * con referencias mínimas (atención y destinatario), la variante externa
 * genérica que puede salir de una sesión autenticada sin revelar CERETI,
 * profesional, tipo de acompañamiento, necesidades ni motivo, y la política
 * que traduce el ciclo de la atención a eventos y destinatarios.
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

/**
 * Participantes de la atención que la política puede avisar.
 *
 * La aplicación los obtiene de la atención y su acompañamiento; acá son
 * referencias opacas, sin nombres ni correos.
 */
export interface NotificationSubject {
  readonly appointmentId: string;
  readonly studentId: string;
  readonly professionalId: string;
}

/** Destinatario posible de un evento, identificado por su vínculo. */
export type NotificationAudience = "student" | "professional";

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

/** Política de un estado resultante: clase a emitir y destinatarios. */
interface NotificationPolicyEntry {
  readonly kind: NotificationEventKind | null;
  readonly audiences: readonly NotificationAudience[];
}

/** La creación confirma la atención al estudiante que la reservó. */
const CREATION_AUDIENCES: readonly NotificationAudience[] = ["student"];

/**
 * Política por estado resultante de la atención.
 *
 * `Record<AppointmentStatus, …>` obliga a decidir para cada estado declarado:
 * uno nuevo no puede quedar en silencio por omisión. `completed` y la
 * resolución de la justificación no emiten aviso externo; el recordatorio no
 * nace de una transición (TI2-122). La audiencia de `rescheduled` depende de
 * quién hizo el cambio y se resuelve en `audiencesForTransition`.
 */
const NOTIFICATION_POLICY_BY_STATUS: Record<AppointmentStatus, NotificationPolicyEntry> = {
  scheduled: { kind: "appointment_scheduled", audiences: CREATION_AUDIENCES },
  completed: { kind: null, audiences: [] },
  cancelled_by_student: { kind: "appointment_cancelled", audiences: ["professional"] },
  cancelled_by_cereti: { kind: "appointment_cancelled", audiences: ["student"] },
  rescheduled: { kind: "appointment_rescheduled", audiences: [] },
  no_show: { kind: "appointment_no_show", audiences: ["student"] },
  no_show_justified: { kind: null, audiences: [] },
  no_show_unjustified: { kind: null, audiences: [] },
};

/** Referencia del destinatario según su vínculo con la atención. */
function recipientIdFor(subject: NotificationSubject, audience: NotificationAudience): string {
  return audience === "student" ? subject.studentId : subject.professionalId;
}

/** Arma un evento por destinatario, sin duplicar la clase ni los textos. */
function eventsFor(
  kind: NotificationEventKind,
  subject: NotificationSubject,
  audiences: readonly NotificationAudience[],
  occurredAt: number,
): readonly NotificationEvent[] {
  return audiences.map((audience) =>
    toNotificationEvent({
      kind,
      appointmentId: subject.appointmentId,
      recipientId: recipientIdFor(subject, audience),
      occurredAt,
    }),
  );
}

/**
 * Reagendar avisa a la contraparte de quien lo hizo.
 *
 * Si el actor no coincide con ninguno de los dos participantes (por ejemplo,
 * una coordinación), avisa a ambos: la política no deja el aviso a criterio
 * de la capa que persiste.
 */
function audiencesForTransition(
  subject: NotificationSubject,
  change: AppointmentStateChange,
  fallback: readonly NotificationAudience[],
): readonly NotificationAudience[] {
  if (change.to !== "rescheduled") return fallback;
  const actor = change.actorId.trim();
  if (actor === subject.studentId.trim()) return ["professional"];
  if (actor === subject.professionalId.trim()) return ["student"];
  return ["student", "professional"];
}

/**
 * Eventos de confirmación de una atención recién creada.
 *
 * `occurredAt` es el instante persistido de la reserva. La creación siempre
 * deja la atención en `scheduled`; el estudiante que reservó recibe la
 * confirmación y el profesional ve la atención en su agenda.
 */
export function notificationEventsForCreation(
  subject: NotificationSubject,
  occurredAt: number,
): readonly NotificationEvent[] {
  return eventsFor("appointment_scheduled", subject, CREATION_AUDIENCES, occurredAt);
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
  const audiences = audiencesForTransition(subject, change, policy.audiences);
  return eventsFor(policy.kind, subject, audiences, change.occurredAt);
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
