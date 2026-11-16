/**
 * Calendario civil puro para los plazos del dominio (TI2-136).
 *
 * Concentra la conversión entre instantes epoch y fechas civiles en una zona
 * horaria IANA, el conteo de días corridos y hábiles y la validación de los
 * datos de entrada. No importa Convex, React ni Expo y no lee el reloj: el
 * instante, la zona y los feriados siempre llegan desde quien calcula.
 *
 * Los plazos de justificación de inasistencia (TI2-94) y de privacidad
 * (TI2-136) comparten esta implementación para no mantener dos cómputos del
 * mismo calendario.
 */

import { isValidCivilDate } from "../availability/availability";

const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = FORMATTER_CACHE.get(timeZone);
  if (cached !== undefined) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  FORMATTER_CACHE.set(timeZone, created);
  return created;
}

function civilParts(epochMs: number, timeZone: string): Record<string, string> {
  return formatterFor(timeZone)
    .formatToParts(new Date(epochMs))
    .reduce<Record<string, string>>((accumulator, part) => {
      accumulator[part.type] = part.value;
      return accumulator;
    }, {});
}

/** Fecha civil `YYYY-MM-DD` del instante en la zona horaria dada. */
export function civilDateOfInstant(epochMs: number, timeZone: string): string {
  const parts = civilParts(epochMs, timeZone);
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
}

/** Día de la semana civil: domingo 0 y sábado 6. */
export function civilWeekday(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const days = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  return (((days + 4) % 7) + 7) % 7;
}

/** Suma días corridos a una fecha civil, sin depender de la zona horaria. */
export function addCivilDays(date: string, days: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const result = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  const resultYear = result.getUTCFullYear();
  const resultMonth = String(result.getUTCMonth() + 1).padStart(2, "0");
  const resultDay = String(result.getUTCDate()).padStart(2, "0");
  return `${resultYear}-${resultMonth}-${resultDay}`;
}

/**
 * Primer instante del día civil `date` en la zona horaria dada.
 *
 * Busca el menor instante cuya fecha civil ya sea `date`, con una búsqueda
 * binaria de 24 horas a cada lado. En el cambio de horario de primavera la
 * medianoche local puede no existir (en Chile el reloj salta de 00:00 a
 * 01:00): en ese caso devuelve el propio salto, que es cuando empieza el día.
 */
export function midnightToEpochMs(date: string, timeZone: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const anchor = Date.UTC(year, month - 1, day, 0, 0, 0);
  // ±24 h cubren cualquier zona IANA real (-12..+14).
  let low = anchor - 86_400_000;
  let high = anchor + 86_400_000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (civilDateOfInstant(middle, timeZone) < date) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return high;
}

/** Verdadero cuando el instante es un epoch finito, positivo y representable. */
export function isUsableInstant(value: number): boolean {
  return Number.isFinite(value) && value > 0 && !Number.isNaN(new Date(value).getTime());
}

/** Lanza el mensaje propio de cada plazo si el instante no es usable. */
export function assertUsableInstant(value: number, message: string): void {
  if (!isUsableInstant(value)) {
    throw new Error(message);
  }
}

/** Lanza un error propio si la zona horaria falta o es desconocida. */
export function assertTimeZone(timeZone: string): void {
  if (typeof timeZone !== "string" || timeZone.trim() === "") {
    throw new Error("El plazo requiere una zona horaria IANA explícita.");
  }
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
  } catch {
    throw new Error("La zona horaria del plazo es desconocida.");
  }
}

/** Valida, quita duplicados y ordena los feriados explícitos `YYYY-MM-DD`. */
export function normalizeHolidays(holidays: readonly string[] | undefined): readonly string[] {
  if (holidays === undefined) return [];
  const seen = new Set<string>();
  for (const holiday of holidays) {
    if (typeof holiday !== "string" || !isValidCivilDate(holiday)) {
      throw new Error(`El feriado ${String(holiday)} no es una fecha civil válida YYYY-MM-DD.`);
    }
    seen.add(holiday);
  }
  return [...seen].sort();
}

/**
 * Avanza desde el día siguiente a `startDate` hasta contar `businessDays` hábiles.
 *
 * Sábados, domingos y los feriados del conjunto no cuentan. La fecha de inicio
 * es el día 0 y no se cuenta aunque sea hábil.
 */
export function addBusinessDays(
  startDate: string,
  businessDays: number,
  holidaySet: ReadonlySet<string>,
): string {
  let counted = 0;
  let current = startDate;
  for (let step = 0; step < 370; step += 1) {
    current = addCivilDays(current, 1);
    const weekday = civilWeekday(current);
    if (weekday === 0 || weekday === 6 || holidaySet.has(current)) continue;
    counted += 1;
    if (counted === businessDays) return current;
  }
  throw new Error("El plazo no encontró suficientes días hábiles en el horizonte de búsqueda.");
}
