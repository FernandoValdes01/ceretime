import { MODALITY_VALUES } from "../../../../../convex/domain/index.ts";
import {
  SLOT_MODALITY_FILTER_VALUES,
  type AgendaSlot,
  type SlotModalityFilter,
} from "../../application/agenda/agenda-port.ts";
import {
  civilDateToUtc,
  formatAgendaDateTime,
  formatAgendaInstant,
  formatAgendaTimeRange,
  formatCivilDateRange,
  formatCivilDay,
} from "../shared/date-format.ts";

/**
 * Etiquetas de agenda del Estudiante (TI2-101, TI2-134).
 *
 * Derivan de los literales canónicos sin duplicarlos: modalidad desconocida
 * muestra el valor. El formato de fechas y horas vive en
 * `presentation/shared/date-format.ts`; acá solo se conserva el nombre que ya
 * usan las pantallas del Estudiante.
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

/** Horario legible de un cupo en la zona de la agenda (epoch en ms). */
export function formatSlotTimeRange(startAt: number, endAt: number): string {
  return formatAgendaTimeRange(startAt, endAt);
}

/** Fecha y hora legibles de un cupo, con la zona de la agenda (epoch en ms). */
export function formatSlotDateTime(startAt: number, endAt: number): string {
  return formatAgendaDateTime(startAt, endAt);
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

function weekStartOf(date: string): string {
  const utc = civilDateToUtc(date);
  const daysSinceWeekStart = (new Date(utc).getUTCDay() + 6) % 7;
  return new Date(utc - daysSinceWeekStart * DAY_MS).toISOString().slice(0, 10);
}

function weekLabel(weekStart: string): string {
  const end = new Date(civilDateToUtc(weekStart) + 6 * DAY_MS).toISOString().slice(0, 10);
  return formatCivilDateRange(weekStart, end);
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
      label: formatCivilDay(date),
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
 * Fecha y hora de una atención en la zona oficial de la agenda, con la zona
 * indicada. Se muestra como texto, nunca solo con color.
 */
export function formatAppointmentDateTime(startAt: number, endAt: number): string {
  return formatAgendaDateTime(startAt, endAt);
}

/**
 * Instante único en la misma zona de la agenda (TI2-114): sirve para la
 * fecha original conservada de una atención reagendada, cuyo cierre actual
 * vive en la segunda fecha del rango.
 */
export function formatAppointmentInstant(startAt: number): string {
  return formatAgendaInstant(startAt);
}
