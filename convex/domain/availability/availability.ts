/**
 * Disponibilidad recurrente de un profesional: bloques, excepciones y cupos (TI2-81).
 *
 * Dominio puro: no importa Convex, React ni Expo, para que Web y Mobile
 * puedan consumirlo sin levantar el backend. Modela la disponibilidad como
 * bloques semanales (día, ventana, duración, modalidad y lugar) más
 * excepciones puntuales que tienen prioridad sobre la recurrencia, y expande
 * ese modelo a cupos concretos dentro de un rango explícito y acotado.
 *
 * Disponibilidad no equivale a ocupación: los cupos expandidos son
 * candidatos y reservar, cruzar recursos o impedir solapes entre personas
 * pertenece a TI2-84/TI2-96, no a este módulo. La persistencia (tablas e
 * índices), los validadores del borde y la exportación por el barrel
 * pertenecen a TI2-83/TI2-87: este archivo no toca `convex/schema.ts`,
 * `convex/validators.ts` ni `convex/domain/index.ts`.
 *
 * La modalidad reutiliza `ModalityPreference` de la solicitud para no
 * duplicar su representación; las necesidades de acceso del acompañamiento
 * no se modelan aquí.
 */

import type { ModalityPreference } from "../request/request";

/** Primer día admitido en `weekday` (domingo, convención de `Date.getDay`). */
export const WEEKDAY_MIN = 0;

/** Último día admitido en `weekday` (sábado). */
export const WEEKDAY_MAX = 6;

/** Minuto inicial del día admitido como inicio de ventana. */
export const DAY_START_MINUTE = 0;

/** Minuto siguiente al último minuto del día (las 24:00 como cierre). */
export const DAY_END_MINUTE = 1440;

/**
 * Días civiles máximos que cubre una expansión.
 *
 * La expansión exige un rango explícito y además lo acota: sin este tope un
 * rango abierto podría publicar el calendario completo del profesional.
 */
export const MAX_EXPANSION_DAYS = 92;

/** Ventana dentro de un día civil: inicio, fin, duración del cupo y dónde se atiende. */
export interface DayWindow {
  /** Minuto del día del inicio, entero entre 0 y 1439. */
  readonly startMinute: number;
  /** Minuto del día del fin, entero entre 1 y 1440 y posterior al inicio. */
  readonly endMinute: number;
  /** Duración de cada cupo en minutos: entero positivo que cabe en la ventana. */
  readonly slotMinutes: number;
  /** Modalidad efectiva de la atención, no preferencia del estudiante. */
  readonly modality: ModalityPreference;
  /**
   * Referencia opaca al espacio de atención (p. ej. su identificador).
   * Obligatoria en modalidad presencial y ausente en línea: verificar el
   * espacio contra el catálogo pertenece a la capa de aplicación.
   */
  readonly spaceId?: string;
}

/** Bloque semanal de disponibilidad: una ventana que se repite cada semana el mismo día. */
export interface RecurringBlock extends DayWindow {
  /** Día de la semana, 0 (domingo) a 6 (sábado). */
  readonly weekday: number;
}

/** Prioridad de la excepción: cancela el día o agrega ventanas puntuales. */
export const AVAILABILITY_EXCEPTION_KIND_VALUES = ["cancelled", "added"] as const;

export type AvailabilityExceptionKind = (typeof AVAILABILITY_EXCEPTION_KIND_VALUES)[number];

/** Excepción puntual sobre la recurrencia en una fecha civil concreta. */
export interface AvailabilityException {
  /** Fecha civil en formato `YYYY-MM-DD`, interpretada en la zona horaria de la expansión. */
  readonly date: string;
  readonly kind: AvailabilityExceptionKind;
  /**
   * Ventanas del día cuando `kind` es `added`. Ausente cuando `kind` es
   * `cancelled`: una cancelación no trae ventanas.
   */
  readonly windows?: readonly DayWindow[];
}

/** Entrada de la expansión: modelo completo más rango civil y zona horaria explícitos. */
export interface ExpandAvailabilityInput {
  readonly blocks: readonly RecurringBlock[];
  readonly exceptions?: readonly AvailabilityException[];
  /** Primera fecha civil incluida, en formato `YYYY-MM-DD`. */
  readonly from: string;
  /** Última fecha civil incluida, en formato `YYYY-MM-DD`. */
  readonly to: string;
  /** Zona horaria IANA del profesional (p. ej. `America/Santiago`). */
  readonly timeZone: string;
}

/** Cupo disponible ya resuelto: candidato a reserva, sin estado de ocupación. */
export interface AvailabilitySlot {
  /** Fecha civil del cupo en formato `YYYY-MM-DD`, en la zona horaria pedida. */
  readonly date: string;
  /** Inicio del cupo como milisegundos epoch. */
  readonly startAt: number;
  /** Fin del cupo como milisegundos epoch. */
  readonly endAt: number;
  readonly modality: ModalityPreference;
  readonly spaceId?: string;
}

/** Verdadero cuando el día cae entre domingo (0) y sábado (6). */
export function isValidWeekday(weekday: number): boolean {
  return Number.isInteger(weekday) && weekday >= WEEKDAY_MIN && weekday <= WEEKDAY_MAX;
}

/** Verdadero cuando la ventana cabe en el día y el inicio precede al fin. */
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

/** Verdadero cuando el texto es una fecha civil `YYYY-MM-DD` real del calendario. */
export function isValidCivilDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  );
}

function assertDayWindow(window: DayWindow, where: string): void {
  if (!isValidMinuteRange(window.startMinute, window.endMinute)) {
    throw new Error(
      `${where}: el inicio y el fin deben ser minutos enteros dentro del día con el fin posterior al inicio.`,
    );
  }
  if (!Number.isInteger(window.slotMinutes) || window.slotMinutes <= 0) {
    throw new Error(`${where}: la duración del cupo debe ser un entero positivo en minutos.`);
  }
  if (window.slotMinutes > window.endMinute - window.startMinute) {
    throw new Error(`${where}: la duración del cupo no cabe en la ventana del bloque.`);
  }
  if (window.modality !== "inPerson" && window.modality !== "online") {
    throw new Error(`${where}: la modalidad debe ser presencial o en línea.`);
  }
  const spaceId = window.spaceId?.trim() ?? "";
  if (window.modality === "inPerson" && spaceId === "") {
    throw new Error(`${where}: la atención presencial requiere referencia al espacio.`);
  }
  if (window.modality === "online" && spaceId !== "") {
    throw new Error(`${where}: la atención en línea no lleva referencia a espacio.`);
  }
}

function assertBlock(block: RecurringBlock, index: number): void {
  const where = `Bloque ${index}`;
  if (!isValidWeekday(block.weekday)) {
    throw new Error(`${where}: el día de la semana debe ser un entero entre 0 y 6.`);
  }
  assertDayWindow(block, where);
}

function assertException(exception: AvailabilityException, index: number): void {
  const where = `Excepción ${index}`;
  if (!isValidCivilDate(exception.date)) {
    throw new Error(`${where}: la fecha debe ser una fecha civil válida YYYY-MM-DD.`);
  }
  if (!isAvailabilityExceptionKind(exception.kind)) {
    throw new Error(`${where}: la clase de excepción debe ser cancelación o agregado.`);
  }
  if (exception.kind === "cancelled" && exception.windows !== undefined) {
    throw new Error(`${where}: la cancelación de un día no trae ventanas.`);
  }
  if (exception.kind === "added") {
    if (exception.windows === undefined || exception.windows.length === 0) {
      throw new Error(`${where}: el agregado de un día requiere al menos una ventana.`);
    }
    exception.windows.forEach((window, windowIndex) =>
      assertDayWindow(window, `${where}, ventana ${windowIndex}`),
    );
  }
}

/**
 * Diferencia `local - utc` en milisegundos para la zona horaria en un instante dado.
 *
 * Implementación propia sobre `Intl.DateTimeFormat` para no depender de
 * bibliotecas externas: el dominio sigue siendo puro y la aritmética de
 * instantes queda probada con fechas fijas de invierno y verano.
 */
function getTimeZoneOffsetMs(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(new Date(utcMs))
    .reduce<Record<string, string>>((accumulator, part) => {
      accumulator[part.type] = part.value;
      return accumulator;
    }, {});
  const asUtc = Date.UTC(
    Number(parts["year"]),
    Number(parts["month"]) - 1,
    Number(parts["day"]),
    Number(parts["hour"]) % 24,
    Number(parts["minute"]),
    Number(parts["second"]),
  );
  return asUtc - utcMs;
}

/** Convierte una fecha civil más un minuto del día a milisegundos epoch en la zona horaria dada. */
function civilToEpochMs(date: string, minuteOfDay: number, timeZone: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const targetLocal = Date.UTC(year, month - 1, day, 0, 0, 0) + minuteOfDay * 60_000;
  const firstPass = targetLocal - getTimeZoneOffsetMs(timeZone, targetLocal);
  return targetLocal - getTimeZoneOffsetMs(timeZone, firstPass);
}

/** Día de la semana (0 a 6) de una fecha civil en la zona horaria dada. */
function civilWeekday(date: string, timeZone: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const utcNoon = Date.UTC(year, month - 1, day, 12, 0, 0);
  return new Date(utcNoon + getTimeZoneOffsetMs(timeZone, utcNoon)).getUTCDay();
}

/** Fechas civiles del rango inclusivo, en orden, como textos `YYYY-MM-DD`. */
function eachCivilDate(from: string, to: string): string[] {
  const dates: string[] = [];
  const start = new Date(
    Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10))),
  );
  const end = new Date(
    Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10))),
  );
  for (let current = start; current <= end; current = new Date(current.getTime() + 86_400_000)) {
    const year = current.getUTCFullYear();
    const month = String(current.getUTCMonth() + 1).padStart(2, "0");
    const day = String(current.getUTCDate()).padStart(2, "0");
    dates.push(`${year}-${month}-${day}`);
  }
  return dates;
}

function expandWindow(date: string, window: DayWindow, timeZone: string): AvailabilitySlot[] {
  const slots: AvailabilitySlot[] = [];
  const length = window.endMinute - window.startMinute;
  const count = Math.floor(length / window.slotMinutes);
  for (let index = 0; index < count; index += 1) {
    const startMinute = window.startMinute + index * window.slotMinutes;
    slots.push({
      date,
      startAt: civilToEpochMs(date, startMinute, timeZone),
      endAt: civilToEpochMs(date, startMinute + window.slotMinutes, timeZone),
      modality: window.modality,
      ...(window.spaceId === undefined ? {} : { spaceId: window.spaceId }),
    });
  }
  return slots;
}

/**
 * Expande bloques y excepciones a cupos concretos dentro del rango pedido.
 *
 * Reglas: la recurrencia aporta las ventanas de cada fecha según su día de
 * semana; una excepción `cancelled` elimina el día completo y una `added`
 * suma sus ventanas a las del día. Los cupos salen alineados al inicio de
 * cada ventana y ordenados por inicio; el resto menor a la duración se
 * descarta sin alterar la ventana. Los solapes entre bloques se preservan
 * tal cual: resolverlos es ocupación (TI2-84/TI2-96), no disponibilidad.
 *
 * Rechaza datos no finitos, fin anterior al inicio, ventanas fuera del día,
 * duraciones no positivas o que no caben, modalidades o espacios
 * inconsistentes, fechas inválidas, rango invertido o mayor a
 * `MAX_EXPANSION_DAYS`, zonas horarias desconocidas y excepciones duplicadas
 * en la misma fecha.
 */
export function expandAvailabilitySlots(input: ExpandAvailabilityInput): AvailabilitySlot[] {
  input.blocks.forEach(assertBlock);
  (input.exceptions ?? []).forEach(assertException);
  if (!isValidCivilDate(input.from) || !isValidCivilDate(input.to)) {
    throw new Error("El rango de expansión requiere fechas civiles válidas YYYY-MM-DD.");
  }
  if (input.from > input.to) {
    throw new Error("El fin del rango de expansión es anterior a su inicio.");
  }
  const dates = eachCivilDate(input.from, input.to);
  if (dates.length > MAX_EXPANSION_DAYS) {
    throw new Error(`El rango de expansión supera el máximo de ${MAX_EXPANSION_DAYS} días.`);
  }
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: input.timeZone });
  } catch {
    throw new Error("La zona horaria de la expansión es desconocida.");
  }

  const exceptionsByDate = new Map<string, AvailabilityException>();
  for (const exception of input.exceptions ?? []) {
    if (exceptionsByDate.has(exception.date)) {
      throw new Error(`La fecha ${exception.date} trae más de una excepción.`);
    }
    exceptionsByDate.set(exception.date, exception);
  }

  const slots: AvailabilitySlot[] = [];
  for (const date of dates) {
    const exception = exceptionsByDate.get(date);
    if (exception?.kind === "cancelled") {
      continue;
    }
    const weekday = civilWeekday(date, input.timeZone);
    const windows: DayWindow[] = input.blocks.filter((block) => block.weekday === weekday);
    if (exception?.kind === "added") {
      windows.push(...(exception.windows ?? []));
    }
    for (const window of windows) {
      slots.push(...expandWindow(date, window, input.timeZone));
    }
  }
  slots.sort((a, b) => a.startAt - b.startAt);
  return slots;
}
