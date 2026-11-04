import { AGENDA_TIME_ZONE, MODALITY_VALUES } from "../../../../../convex/domain/index.ts";
import {
  SLOT_MODALITY_FILTER_VALUES,
  type SlotModalityFilter,
} from "../../application/agenda/agenda-port.ts";

/**
 * Etiquetas de agenda del Estudiante (TI2-101).
 *
 * Derivan de los literales canónicos sin duplicarlos: modalidad desconocida
 * muestra el valor. Fecha y hora siempre como texto, nunca solo con color.
 */

const MODALITY_LABELS: Record<string, string> = {
  inPerson: "Presencial",
  online: "En línea",
};

/** Etiqueta en español de una modalidad del contrato canónico. */
export function modalityLabel(modality: string): string {
  return MODALITY_LABELS[modality] ?? modality;
}

/** Opciones del filtro de modalidad en orden de la vista. */
export function modalityFilterOptions(): ReadonlyArray<{
  value: SlotModalityFilter;
  label: string;
}> {
  return SLOT_MODALITY_FILTER_VALUES.map((value) => ({
    value,
    label: value === "all" ? "Todas" : modalityLabel(value),
  }));
}

/** Verifica que un valor sea una modalidad del contrato canónico. */
export function isKnownModality(value: string): boolean {
  return (MODALITY_VALUES as ReadonlyArray<string>).includes(value);
}

const SLOT_DATE_FORMAT = new Intl.DateTimeFormat("es-CL", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const SLOT_TIME_FORMAT = new Intl.DateTimeFormat("es-CL", {
  hour: "numeric",
  minute: "2-digit",
});

/** Fecha y hora legibles de un cupo (epoch en ms). */
export function formatSlotDateTime(startAt: number, endAt: number): string {
  return `${SLOT_DATE_FORMAT.format(startAt)}, ${SLOT_TIME_FORMAT.format(startAt)} – ${SLOT_TIME_FORMAT.format(endAt)}`;
}

/**
 * Etiquetas de estado de una atención (TI2-122). Ante un literal desconocido
 * muestran el valor, nunca un texto inventado.
 */
const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  scheduled: "Programada",
  completed: "Realizada",
  cancelled_by_student: "Cancelada por el Estudiante",
  cancelled_by_cereti: "Cancelada por CERETI",
  rescheduled: "Reagendada",
  no_show: "Inasistencia pendiente",
  no_show_justified: "Inasistencia justificada",
  no_show_unjustified: "Inasistencia no justificada",
};

export function appointmentStatusLabel(status: string): string {
  return APPOINTMENT_STATUS_LABELS[status] ?? status;
}

/**
 * Fecha y hora de una atención en la zona oficial de la agenda, sin depender
 * de la zona del navegador. Se muestra como texto, nunca solo con color.
 */
const APPOINTMENT_DATE_FORMAT = new Intl.DateTimeFormat("es-CL", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: AGENDA_TIME_ZONE,
});

const APPOINTMENT_TIME_FORMAT = new Intl.DateTimeFormat("es-CL", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: AGENDA_TIME_ZONE,
});

export function formatAppointmentDateTime(startAt: number, endAt: number): string {
  return `${APPOINTMENT_DATE_FORMAT.format(startAt)}, ${APPOINTMENT_TIME_FORMAT.format(startAt)} – ${APPOINTMENT_TIME_FORMAT.format(endAt)} (${AGENDA_TIME_ZONE})`;
}

/**
 * Instante único en la misma zona de la agenda (TI2-114): sirve para la
 * fecha original conservada de una atención reagendada, cuyo cierre actual
 * vive en la segunda fecha del rango.
 */
export function formatAppointmentInstant(startAt: number): string {
  return `${APPOINTMENT_DATE_FORMAT.format(startAt)}, ${APPOINTMENT_TIME_FORMAT.format(startAt)} (${AGENDA_TIME_ZONE})`;
}
