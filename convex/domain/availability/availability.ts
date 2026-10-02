/**
 * Vocabulario persistido de disponibilidad (TI2-83).
 *
 * Dominio puro: no importa Convex ni `convex/_generated`. Solo literales y
 * tipos para derivar los validadores del borde en `convex/validators.ts`; no
 * implementa reglas. La duración, la recurrencia efectiva y los cruces son
 * de TI2-81 y la compatibilidad de modalidad y espacio es de TI2-82: este
 * módulo solo fija los campos acordados desde la especificación vigente
 * (día de semana, ventana en minutos, modalidad, lugar y referencias),
 * sin esperar entregas de la misma semana.
 */

/** Modalidades admitidas por la especificación vigente (sin híbrida). */
export const MODALITY_VALUES = ["inPerson", "online"] as const;

export type Modality = (typeof MODALITY_VALUES)[number];

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
