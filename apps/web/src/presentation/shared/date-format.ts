import { AGENDA_TIME_ZONE } from "../../../../../convex/domain/index.ts";

/**
 * Formato único de fechas y horas de la Web (TI2-134).
 *
 * Todas las fechas de la agenda se leen en la zona oficial del dominio y no
 * en la del navegador: un cupo publicado para las 10:00 en Santiago se ve a
 * las 10:00 aunque la persona abra la Web desde otra zona. Los textos
 * incluyen la zona cuando muestran una hora para que el dato no dependa de
 * una convención oculta.
 *
 * Las fechas civiles (`YYYY-MM-DD`) ya vienen resueltas por el Backend y no
 * representan un instante: se leen en UTC para que la zona del navegador no
 * las mueva de día.
 */

/** Identificador de la zona de la agenda, visible junto a las horas. */
export const AGENDA_TIME_ZONE_LABEL = AGENDA_TIME_ZONE;

const DATE_WITH_YEAR = new Intl.DateTimeFormat("es-CL", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: AGENDA_TIME_ZONE,
});

const TIME = new Intl.DateTimeFormat("es-CL", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: AGENDA_TIME_ZONE,
});

const CIVIL_DAY_TEXT = new Intl.DateTimeFormat("es-CL", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

const CIVIL_DATE_TEXT = new Intl.DateTimeFormat("es-CL", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

const CIVIL_DATE_WITH_YEAR_TEXT = new Intl.DateTimeFormat("es-CL", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** Fecha con día de la semana y año de un instante de la agenda. */
export function formatAgendaDate(instantAt: number): string {
  return DATE_WITH_YEAR.format(instantAt);
}

/** Hora de un instante de la agenda. */
export function formatAgendaTime(instantAt: number): string {
  return TIME.format(instantAt);
}

/** Horario de inicio a término de un instante de la agenda. */
export function formatAgendaTimeRange(startAt: number, endAt: number): string {
  return `${formatAgendaTime(startAt)} – ${formatAgendaTime(endAt)}`;
}

/** Fecha y horario completos, con la zona de la agenda indicada. */
export function formatAgendaDateTime(startAt: number, endAt: number): string {
  return `${formatAgendaDate(startAt)}, ${formatAgendaTimeRange(startAt, endAt)} (${AGENDA_TIME_ZONE_LABEL})`;
}

/** Fecha y hora de un único instante, con la zona de la agenda indicada. */
export function formatAgendaInstant(instantAt: number): string {
  return `${formatAgendaDate(instantAt)}, ${formatAgendaTime(instantAt)} (${AGENDA_TIME_ZONE_LABEL})`;
}

/** Convierte una fecha civil `YYYY-MM-DD` al instante UTC de esa medianoche. */
export function civilDateToUtc(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** Día de la semana y fecha de una fecha civil, con mayúscula inicial. */
export function formatCivilDay(date: string): string {
  const label = CIVIL_DAY_TEXT.format(civilDateToUtc(date)).replace(",", "");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Día y mes de una fecha civil. */
export function formatCivilDate(date: string): string {
  return CIVIL_DATE_TEXT.format(civilDateToUtc(date));
}

/** Día, mes y año de una fecha civil. */
export function formatCivilDateWithYear(date: string): string {
  return CIVIL_DATE_WITH_YEAR_TEXT.format(civilDateToUtc(date));
}

/**
 * Rango entre dos fechas civiles: omite el mes inicial cuando ambas caen en el
 * mismo mes y año, como en «2 al 8 de noviembre».
 */
export function formatCivilDateRange(startDate: string, endDate: string): string {
  const start = new Date(civilDateToUtc(startDate));
  const end = new Date(civilDateToUtc(endDate));
  const sameMonth =
    start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth();
  const from = sameMonth ? `${start.getUTCDate()}` : formatCivilDate(startDate);
  return `${from} al ${formatCivilDate(endDate)}`;
}

/** Problema de una fecha civil escrita por la persona. */
export type CivilDateIssue = "format" | "impossible";

/**
 * Revisa una fecha civil `YYYY-MM-DD` escrita a mano.
 *
 * Distingue el formato inválido de una fecha con forma correcta que no existe
 * en el calendario (29 de febrero de un año común, 31 de abril): así el
 * formulario puede decir qué corregir y nunca acepta una fecha inventada.
 */
export function civilDateIssue(value: string): CivilDateIssue | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match === null) {
    return "format";
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    return "impossible";
  }
  return null;
}

/** Verdadero ante una fecha civil `YYYY-MM-DD` real del calendario. */
export function isValidCivilDate(value: string): boolean {
  return civilDateIssue(value) === null;
}
