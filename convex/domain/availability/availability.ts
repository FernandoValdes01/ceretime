/**
 * Disponibilidad: contratos públicos compartidos v1 y reglas de expansión (TI2-87, TI2-81).
 *
 * Dominio puro: no importa Convex, React ni Expo, para que Web y Mobile consuman la misma forma sin levantar el backend. Fija las entradas y salidas mínimas con identificadores genéricos (`string` plano, sin `Id`/`Doc` de Convex): bloques con profesionales y días, excepciones puntuales, rango civil explícito y paginación.
 *
 * Reutiliza `ModalityPreference` de la solicitud para no duplicar su representación; la duración, la recurrencia efectiva y la expansión a cupos pertenecen a TI2-81, los cruces a TI2-84 y la compatibilidad de modalidad y espacio a TI2-82. La autorización contextual queda en Aplicación, la DB y los servicios externos en Infraestructura y las entradas públicas delgadas en Presentación.
 *
 * Las reglas de TI2-81 operan sobre estos mismos contratos: no existe otra representación de bloques, ventanas, excepciones ni cupos. La expansión exige el profesional dueño de los bloques, respeta la prioridad de las excepciones y devuelve cupos con identidad determinista (`profesional:fecha:inicio`, con sufijo por orden de aparición ante inicios repetidos por solape); la identidad es estable entre llamadas y la persistencia puede reemplazarla por identificadores de fila (TI2-83). Disponibilidad no equivale a ocupación: los cupos son candidatos y reservar pertenece a TI2-84/TI2-96.
 */

import type { ModalityPreference } from "../request/request";

/** Versión del contrato público de disponibilidad. */
export const AVAILABILITY_CONTRACT_VERSION = "v1" as const;

export type AvailabilityContractVersion = typeof AVAILABILITY_CONTRACT_VERSION;

/** Clases de excepción sobre la recurrencia, fuente única para contratos y reglas. */
export const AVAILABILITY_EXCEPTION_KIND_VALUES = ["cancelled", "added"] as const;

export type AvailabilityExceptionKind = (typeof AVAILABILITY_EXCEPTION_KIND_VALUES)[number];

/**
 * Modalidades admitidas por la especificación vigente (TI2-83, sin híbrida).
 *
 * Única fuente en valores para los validadores del borde
 * (`convex/validators.ts`): restringida a `ModalityPreference` para no
 * duplicar su representación. La semana (0–6, convención de `Date.getDay`)
 * y los minutos del día (0–1440) quedan documentados en el esquema y sus
 * reglas son de TI2-81.
 */
export const MODALITY_VALUES = [
  "inPerson",
  "online",
] as const satisfies readonly ModalityPreference[];

/** Ventana dentro de un día civil, en minutos desde las 00:00. */
export interface AvailabilityWindow {
  readonly startMinute: number;
  readonly endMinute: number;
  readonly slotMinutes: number;
  readonly modality: ModalityPreference;
  /** Referencia opaca al espacio; su resolución contra el catálogo es de aplicación (TI2-82). */
  readonly spaceId?: string;
}

/** Bloque semanal de disponibilidad con identificadores genéricos. */
export interface AvailabilityBlock extends AvailabilityWindow {
  readonly id: string;
  readonly professionalId: string;
  /** Día de la semana, 0 (domingo) a 6 (sábado). */
  readonly weekday: number;
  readonly version: AvailabilityContractVersion;
}

/** Excepción puntual sobre la recurrencia en una fecha civil concreta. */
export interface AvailabilityException {
  /** Fecha civil en formato `YYYY-MM-DD`. */
  readonly date: string;
  readonly kind: AvailabilityExceptionKind;
  /** Ventanas del día cuando `kind` es `added`; ausente en `cancelled`. */
  readonly windows?: readonly AvailabilityWindow[];
  readonly version: AvailabilityContractVersion;
}

/** Entrada mínima para listar disponibilidad: rango civil explícito y paginación. */
export interface ListAvailabilityInput {
  readonly professionalId: string;
  /** Primera fecha civil incluida, en formato `YYYY-MM-DD`. */
  readonly from: string;
  /** Última fecha civil incluida, en formato `YYYY-MM-DD`. */
  readonly to: string;
  /** Zona horaria IANA del profesional (p. ej. `America/Santiago`). */
  readonly timeZone: string;
  readonly limit: number;
  readonly cursor?: string;
  readonly version: AvailabilityContractVersion;
}

/** Cupo disponible ya resuelto: candidato a reserva, sin estado de ocupación. */
export interface AvailabilitySlot {
  readonly id: string;
  readonly professionalId: string;
  /** Fecha civil del cupo en formato `YYYY-MM-DD`, en la zona horaria pedida. */
  readonly date: string;
  /** Inicio del cupo como milisegundos epoch. */
  readonly startAt: number;
  /** Fin del cupo como milisegundos epoch. */
  readonly endAt: number;
  readonly modality: ModalityPreference;
  readonly spaceId?: string;
  readonly version: AvailabilityContractVersion;
}

/** Página de cupos con paginación keyset sobre el identificador. */
export interface AvailabilitySlotPage {
  readonly items: readonly AvailabilitySlot[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  readonly version: AvailabilityContractVersion;
}

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
 * La expansión exige un rango explícito y además lo acota: sin este tope un rango abierto podría publicar el calendario completo del profesional.
 */
export const MAX_EXPANSION_DAYS = 92;

/** Entrada de la expansión: bloques de un profesional más rango civil y zona horaria explícitos. */
export interface ExpandAvailabilityInput {
  /** Profesional dueño de los bloques; cada bloque debe ser del mismo profesional. */
  readonly professionalId: string;
  readonly blocks: readonly AvailabilityBlock[];
  readonly exceptions?: readonly AvailabilityException[];
  /** Primera fecha civil incluida, en formato `YYYY-MM-DD`. */
  readonly from: string;
  /** Última fecha civil incluida, en formato `YYYY-MM-DD`. */
  readonly to: string;
  /** Zona horaria IANA del profesional (p. ej. `America/Santiago`). */
  readonly timeZone: string;
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

function assertDayWindow(window: AvailabilityWindow, where: string): void {
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

function assertBlock(block: AvailabilityBlock, professionalId: string, index: number): void {
  const where = `Bloque ${index}`;
  if (block.professionalId !== professionalId) {
    throw new Error(`${where}: los bloques deben ser del mismo profesional de la expansión.`);
  }
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

/** Componentes numéricos de una fecha civil `YYYY-MM-DD` ya validada. */
function civilDateParts(date: string): { year: number; month: number; day: number } {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

/**
 * Conversión a zona horaria conservada entre llamadas.
 *
 * Se conserva una instancia por zona horaria: evita reconstruir el `Intl.DateTimeFormat` en cada instante calculado sin cambiar el resultado.
 */
const timeZoneFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = timeZoneFormatters.get(timeZone);
  if (cached !== undefined) {
    return cached;
  }
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
  timeZoneFormatters.set(timeZone, created);
  return created;
}

/**
 * Diferencia entre la hora local y UTC, en milésimas de segundo, para la zona horaria en un instante dado.
 *
 * Implementación propia sobre `Intl.DateTimeFormat` para no depender de bibliotecas externas: el dominio sigue siendo puro y la aritmética de instantes queda probada con fechas fijas de invierno y verano.
 */
function getTimeZoneOffsetMs(timeZone: string, utcMs: number): number {
  const parts = formatterFor(timeZone)
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

/** Convierte una fecha civil más un minuto del día a un instante epoch en la zona horaria dada. */
function civilToEpochMs(date: string, minuteOfDay: number, timeZone: string): number {
  const { year, month, day } = civilDateParts(date);
  const targetLocal = Date.UTC(year, month - 1, day, 0, 0, 0) + minuteOfDay * 60_000;
  const firstPass = targetLocal - getTimeZoneOffsetMs(timeZone, targetLocal);
  return targetLocal - getTimeZoneOffsetMs(timeZone, firstPass);
}

/** Día de la semana (0 a 6) de una fecha civil, idéntico en todas las zonas horarias. */
function civilWeekday(date: string): number {
  const { year, month, day } = civilDateParts(date);
  const days = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  return (((days + 4) % 7) + 7) % 7;
}

/** Fechas civiles del rango inclusivo, en orden, como textos `YYYY-MM-DD`. */
function eachCivilDate(from: string, to: string): string[] {
  const dates: string[] = [];
  const start = civilDateParts(from);
  const end = civilDateParts(to);
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  for (let currentMs = startMs; currentMs <= endMs; currentMs += 86_400_000) {
    const current = new Date(currentMs);
    const year = current.getUTCFullYear();
    const month = String(current.getUTCMonth() + 1).padStart(2, "0");
    const day = String(current.getUTCDate()).padStart(2, "0");
    dates.push(`${year}-${month}-${day}`);
  }
  return dates;
}

function expandWindow(
  professionalId: string,
  date: string,
  window: AvailabilityWindow,
  timeZone: string,
  takenIds: Map<string, number>,
): AvailabilitySlot[] {
  const slots: AvailabilitySlot[] = [];
  const length = window.endMinute - window.startMinute;
  const count = Math.floor(length / window.slotMinutes);
  for (let index = 0; index < count; index += 1) {
    const startMinute = window.startMinute + index * window.slotMinutes;
    const startAt = civilToEpochMs(date, startMinute, timeZone);
    const baseId = `${professionalId}:${date}:${startAt}`;
    const occurrence = takenIds.get(baseId) ?? 0;
    takenIds.set(baseId, occurrence + 1);
    slots.push({
      id: occurrence === 0 ? baseId : `${baseId}#${occurrence}`,
      professionalId,
      date,
      startAt,
      // El fin deriva del inicio más la duración: cada cupo dura exacto aunque la hora civil no exista o se repita en un cambio de hora.
      endAt: startAt + window.slotMinutes * 60_000,
      modality: window.modality,
      ...(window.spaceId === undefined ? {} : { spaceId: window.spaceId }),
      version: AVAILABILITY_CONTRACT_VERSION,
    });
  }
  return slots;
}

/**
 * Expande bloques y excepciones a cupos concretos dentro del rango pedido.
 *
 * Reglas: cada bloque debe ser del mismo profesional de la expansión; la recurrencia aporta las ventanas de cada fecha según su día de semana; una excepción `cancelled` elimina el día completo y una `added` suma sus ventanas a las del día. Los cupos salen alineados al inicio de cada ventana y ordenados por inicio, y el fin de cada cupo deriva del inicio más la duración para durar exacto aunque la hora civil no exista o se repita en un cambio de hora; el resto menor a la duración se descarta sin alterar la ventana. Los solapes entre bloques se preservan tal cual: resolverlos es ocupación (TI2-84/TI2-96), no disponibilidad.
 *
 * Rechaza datos no finitos, fin anterior al inicio, ventanas fuera del día, duraciones no positivas o que no caben, modalidades o espacios inconsistentes, bloques de otro profesional, fechas inválidas, rango invertido o mayor a `MAX_EXPANSION_DAYS`, zonas horarias desconocidas y excepciones duplicadas en la misma fecha.
 */
export function expandAvailabilitySlots(input: ExpandAvailabilityInput): AvailabilitySlot[] {
  if (input.professionalId.trim() === "") {
    throw new Error("La expansión requiere el profesional dueño de los bloques.");
  }
  input.blocks.forEach((block, index) => assertBlock(block, input.professionalId, index));
  (input.exceptions ?? []).forEach(assertException);
  if (!isValidCivilDate(input.from) || !isValidCivilDate(input.to)) {
    throw new Error("El rango de expansión requiere fechas civiles válidas YYYY-MM-DD.");
  }
  if (input.from > input.to) {
    throw new Error("El fin del rango de expansión es anterior a su inicio.");
  }
  const rangeStart = civilDateParts(input.from);
  const rangeEnd = civilDateParts(input.to);
  const spanDays =
    Math.round(
      (Date.UTC(rangeEnd.year, rangeEnd.month - 1, rangeEnd.day) -
        Date.UTC(rangeStart.year, rangeStart.month - 1, rangeStart.day)) /
        86_400_000,
    ) + 1;
  if (spanDays > MAX_EXPANSION_DAYS) {
    throw new Error(`El rango de expansión supera el máximo de ${MAX_EXPANSION_DAYS} días.`);
  }
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: input.timeZone });
  } catch {
    throw new Error("La zona horaria de la expansión es desconocida.");
  }
  const dates = eachCivilDate(input.from, input.to);

  const exceptionsByDate = new Map<string, AvailabilityException>();
  for (const exception of input.exceptions ?? []) {
    if (exceptionsByDate.has(exception.date)) {
      throw new Error(`La fecha ${exception.date} trae más de una excepción.`);
    }
    exceptionsByDate.set(exception.date, exception);
  }

  const slots: AvailabilitySlot[] = [];
  const takenIds = new Map<string, number>();
  for (const date of dates) {
    const exception = exceptionsByDate.get(date);
    if (exception?.kind === "cancelled") {
      continue;
    }
    const weekday = civilWeekday(date);
    const windows: AvailabilityWindow[] = input.blocks.filter((block) => block.weekday === weekday);
    if (exception?.kind === "added") {
      windows.push(...(exception.windows ?? []));
    }
    for (const window of windows) {
      slots.push(...expandWindow(input.professionalId, date, window, input.timeZone, takenIds));
    }
  }
  slots.sort((a, b) => a.startAt - b.startAt);
  return slots;
}
