import { AGENDA_TIME_ZONE, MODALITY_VALUES } from "../../../../../convex/domain/index.ts";
import {
  SLOT_MODALITY_FILTER_VALUES,
  type AgendaSlot,
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
  timeZone: AGENDA_TIME_ZONE,
});

const SLOT_TIME_FORMAT = new Intl.DateTimeFormat("es-CL", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: AGENDA_TIME_ZONE,
});

/** Horario legible de un cupo en la zona de la agenda (epoch en ms). */
export function formatSlotTimeRange(startAt: number, endAt: number): string {
  return `${SLOT_TIME_FORMAT.format(startAt)} – ${SLOT_TIME_FORMAT.format(endAt)}`;
}

/** Fecha y hora legibles de un cupo (epoch en ms). */
export function formatSlotDateTime(startAt: number, endAt: number): string {
  return `${SLOT_DATE_FORMAT.format(startAt)}, ${formatSlotTimeRange(startAt, endAt)}`;
}

/** Día con cupos, identificado por su fecha civil en la zona de la agenda. */
export type SlotDay = {
  readonly date: string;
  readonly label: string;
  readonly slots: ReadonlyArray<AgendaSlot>;
};

/** Semana de lunes a domingo que tiene al menos un cupo. */
export type SlotWeek = {
  readonly start: string;
  readonly label: string;
  readonly days: ReadonlyArray<SlotDay>;
};

const DAY_MS = 86_400_000;

// Las fechas civiles ya vienen resueltas por el Backend (`AgendaSlot.date`): se
// leen en UTC para que la zona del navegador no las mueva de día.
const CIVIL_DAY_FORMAT = new Intl.DateTimeFormat("es-CL", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

const CIVIL_DATE_FORMAT = new Intl.DateTimeFormat("es-CL", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

function civilDateToUtc(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function civilDayLabel(date: string): string {
  const label = CIVIL_DAY_FORMAT.format(civilDateToUtc(date)).replace(",", "");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function weekStartOf(date: string): string {
  const utc = civilDateToUtc(date);
  const daysSinceWeekStart = (new Date(utc).getUTCDay() + 6) % 7;
  return new Date(utc - daysSinceWeekStart * DAY_MS).toISOString().slice(0, 10);
}

function weekLabel(weekStart: string): string {
  const start = new Date(civilDateToUtc(weekStart));
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const from = sameMonth ? `${start.getUTCDate()}` : CIVIL_DATE_FORMAT.format(start);
  return `${from} al ${CIVIL_DATE_FORMAT.format(end)}`;
}

/**
 * Agrupa los cupos por semana y día, en orden. Solo incluye semanas con cupos:
 * la navegación nunca se detiene en una semana vacía.
 */
export function groupSlotsByWeek(slots: ReadonlyArray<AgendaSlot>): ReadonlyArray<SlotWeek> {
  const weeks = new Map<string, Map<string, AgendaSlot[]>>();
  for (const slot of [...slots].sort((left, right) => left.startAt - right.startAt)) {
    const weekStart = weekStartOf(slot.date);
    const days = weeks.get(weekStart) ?? new Map<string, AgendaSlot[]>();
    days.set(slot.date, [...(days.get(slot.date) ?? []), slot]);
    weeks.set(weekStart, days);
  }
  return [...weeks.keys()].sort().map((start) => ({
    start,
    label: weekLabel(start),
    days: [...(weeks.get(start) ?? new Map<string, AgendaSlot[]>())].map(([date, daySlots]) => ({
      date,
      label: civilDayLabel(date),
      slots: daySlots,
    })),
  }));
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
