/**
 * Disponibilidad recurrente y excepciones (TI2-83).
 *
 * Dominio puro: no importa Convex ni `convex/_generated`. La
 * especificación vigente define la disponibilidad como bloques recurrentes
 * (con duración, modalidad y lugar) más excepciones puntuales; este módulo
 * fija su representación persistida propia sin importar modelos que otro
 * responsable publique durante S1.
 */

/** Primer día admitido en `weekday` (domingo, convención de `Date.getDay`). */
export const WEEKDAY_MIN = 0;

/** Último día admitido en `weekday` (sábado). */
export const WEEKDAY_MAX = 6;

/** Minuto inicial del día admitido en `startMinute`/`endMinute`. */
export const DAY_START_MINUTE = 0;

/** Minuto siguiente al último minuto del día (las 24:00 como cierre). */
export const DAY_END_MINUTE = 1440;

/** Clases de excepción sobre la recurrencia de un profesional. */
export const AVAILABILITY_EXCEPTION_KIND_VALUES = ["cancelled", "added"] as const;

export type AvailabilityExceptionKind = (typeof AVAILABILITY_EXCEPTION_KIND_VALUES)[number];

/** Verdadero cuando el día cae en la semana 0 (domingo) a 6 (sábado). */
export function isValidWeekday(weekday: number): boolean {
  return Number.isInteger(weekday) && weekday >= WEEKDAY_MIN && weekday <= WEEKDAY_MAX;
}

/**
 * Verdadero cuando la ventana cabe en el día y el inicio precede al fin.
 * Solo persistencia: la prevención de cruces entre bloques la aplica la
 * operación de ocupación (TI2-84), no este predicado.
 */
export function isValidMinuteRange(startMinute: number, endMinute: number): boolean {
  return (
    Number.isInteger(startMinute) &&
    Number.isInteger(endMinute) &&
    startMinute >= DAY_START_MINUTE &&
    endMinute <= DAY_END_MINUTE &&
    startMinute < endMinute
  );
}

/** Verdadero cuando el valor es una clase de excepción conocida. */
export function isAvailabilityExceptionKind(value: string): value is AvailabilityExceptionKind {
  return (AVAILABILITY_EXCEPTION_KIND_VALUES as readonly string[]).includes(value);
}
