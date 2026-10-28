import { REQUEST_STATE_LABELS } from "../../../../../convex/domain/index.ts";
import type { AppointmentRejectionCause } from "../../../../../convex/domain/index.ts";

/**
 * Etiquetas de gestión del Profesional (TI2-91, extendido TI2-115).
 *
 * Derivan del contrato canónico del dominio, sin duplicar literales: si el
 * Backend agrega un estado, la etiqueta llega sola. Ante un literal
 * desconocido se muestra el valor, igual que el panel del Estudiante. El
 * estado siempre se comunica con texto, nunca solo con color.
 */
export function requestStatusLabel(status: string): string {
  return (REQUEST_STATE_LABELS as Record<string, string>)[status] ?? status;
}

/**
 * Etiquetas de los estados de la atención (TI2-115).
 *
 * Lenguaje de CONTEXT.md: realizada, cancelada, reagendada, inasistencia
 * pendiente de justificación, justificada o sin justificar. La lista deriva
 * de los literales canónicos; un estado nuevo sin etiqueta muestra su valor.
 */
const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  scheduled: "Programada",
  completed: "Realizada",
  cancelled_by_student: "Cancelada por el estudiante",
  cancelled_by_cereti: "Cancelada por CERETI",
  rescheduled: "Reagendada",
  no_show: "Inasistencia pendiente de justificación",
  no_show_justified: "Inasistencia justificada",
  no_show_unjustified: "Inasistencia sin justificar",
};

/** Etiqueta en español de un estado de la atención del contrato canónico. */
export function appointmentStatusLabel(status: string): string {
  return APPOINTMENT_STATUS_LABELS[status] ?? status;
}

/**
 * Mensajes legibles de las causas canónicas de rechazo (TI2-115).
 *
 * La causa viene del dominio (`APPOINTMENT_REJECTION_CAUSES`) y el Backend
 * la aplicará igual; acá solo se traduce a texto sin detalles sensibles.
 * La reagendada no se ofrece en el modo simulado: el mensaje queda por si
 * un intento llegara igual.
 */
const APPOINTMENT_REJECTION_MESSAGES: Record<AppointmentRejectionCause, string> = {
  transition_not_allowed: "Cambio no permitido desde el estado actual.",
  actor_required: "No se pudo identificar quién registra el cambio.",
  occurred_at_invalid: "El registro no trae un instante válido.",
  current_start_invalid: "La atención no trae una fecha de inicio válida.",
  reason_required: "El motivo es obligatorio para este cambio.",
  occurred_before_start: "No se puede registrar este cambio antes de la hora de la atención.",
  reschedule_required: "Reagendar requiere la nueva fecha de la atención.",
  reschedule_invalid: "La nueva fecha del reagendamiento es inválida.",
};

/** Mensaje legible de una causa canónica de rechazo de cambio de estado. */
export function appointmentRejectionMessage(cause: string): string {
  return APPOINTMENT_REJECTION_MESSAGES[cause as AppointmentRejectionCause] ?? cause;
}

/**
 * Etiquetas de los cambios que el Profesional registra (TI2-115).
 *
 * Lenguaje operativo: registrar la atención realizada o la inasistencia,
 * resolver la justificación y cancelar por CERETI. El cambio de destino
 * cancelado por el estudiante pertenece a la vista del Estudiante y no se
 * ofrece acá.
 */
const APPOINTMENT_CHANGE_LABELS: Record<string, string> = {
  completed: "Registrar atención realizada",
  no_show: "Registrar inasistencia",
  no_show_justified: "Registrar inasistencia justificada",
  no_show_unjustified: "Registrar inasistencia sin justificación",
  cancelled_by_cereti: "Cancelar la atención por CERETI",
};

/** Etiqueta operativa de un cambio de estado al destino canónico dado. */
export function appointmentChangeLabel(to: string): string {
  return APPOINTMENT_CHANGE_LABELS[to] ?? appointmentStatusLabel(to);
}

const APPOINTMENT_WINDOW_FORMAT = new Intl.DateTimeFormat("es-CL", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const APPOINTMENT_TIME_FORMAT = new Intl.DateTimeFormat("es-CL", {
  hour: "numeric",
  minute: "2-digit",
});

/** Fecha y hora legible de una atención (epoch en milisegundos). */
export function formatAppointmentWindow(startAt: number, endAt: number): string {
  return `${APPOINTMENT_WINDOW_FORMAT.format(startAt)}, ${APPOINTMENT_TIME_FORMAT.format(
    startAt,
  )} – ${APPOINTMENT_TIME_FORMAT.format(endAt)}`;
}

/** Instante legible de una fecha original conservada (epoch en milisegundos). */
export function formatAppointmentInstant(instantAt: number): string {
  return `${APPOINTMENT_WINDOW_FORMAT.format(instantAt)}, ${APPOINTMENT_TIME_FORMAT.format(
    instantAt,
  )}`;
}
