/**
 * Evento de calendario de una atención y alternativa `.ics` (TI2-122).
 *
 * Dominio puro: no importa Convex, React, Expo ni el SDK de Google. Define
 * una sola vez la forma del evento, la clave determinista que evita duplicados
 * en reintentos y la conversión interoperable del archivo `.ics`.
 *
 * El título es genérico: no incluye CERETI, el profesional, la modalidad, las
 * necesidades de acceso ni notas. El evento tampoco lleva descripción,
 * ubicación ni enlaces privados. La hora viaja como instante UTC y la zona de
 * la agenda se declara aparte, así el `.ics` no depende de una tabla VTIMEZONE
 * frágil y Google Calendar recibe el mismo instante con su zona de despliegue.
 */

/** Versión del contrato público del evento de calendario. */
export const CALENDAR_EVENT_CONTRACT_VERSION = "v1" as const;

export type CalendarEventContractVersion = typeof CALENDAR_EVENT_CONTRACT_VERSION;

/** Alcance OAuth mínimo para crear eventos; la app no lista ni sincroniza calendarios. */
export const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/** Título genérico: nunca revela CERETI ni el motivo de la atención. */
export const CALENDAR_EVENT_TITLE = "Atención programada";

/** Dominio neutro del UID estable; no revela la institución ni el producto. */
export const CALENDAR_EVENT_UID_DOMAIN = "calendar.local";

/** Nombre de descarga del archivo `.ics` de una atención. */
export const CALENDAR_FILE_NAME = "atencion-programada.ics";

/** Resultados públicos de la acción de agregar una atención al calendario. */
export const CALENDAR_EVENT_OUTCOME_VALUES = [
  "created",
  "updated",
  "already_created",
  "fallback",
] as const;

export type CalendarEventOutcome = (typeof CALENDAR_EVENT_OUTCOME_VALUES)[number];

/** Motivos genéricos del respaldo `.ics`, sin detalles del proveedor. */
export const CALENDAR_EVENT_FALLBACK_REASON_VALUES = ["not_connected", "unavailable"] as const;

export type CalendarEventFallbackReason = (typeof CALENDAR_EVENT_FALLBACK_REASON_VALUES)[number];

/** Evento preparado para persistencia y para el adaptador de Google Calendar. */
export interface CalendarEventDraft {
  readonly appointmentId: string;
  /** UID estable del `.ics`; se conserva entre reintentos y descargas. */
  readonly uid: string;
  /** Identificador determinista del evento en Google Calendar. */
  readonly googleEventId: string;
  readonly title: string;
  readonly startAt: number;
  readonly endAt: number;
  readonly timeZone: string;
  readonly generatedAt: number;
  readonly version: CalendarEventContractVersion;
}

/** Archivo `.ics` listo para descargar en Web o Mobile. */
export interface CalendarFile {
  readonly fileName: string;
  readonly content: string;
}

const BASE32_HEX_ALPHABET = "0123456789abcdefghijklmnopqrstuv";
const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_SECOND_BASIS = 0x84222325cbf29ce4n;
const FNV_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;
const ICS_MAX_LINE_OCTETS = 75;

/** FNV-1a de 64 bits: determinista, puro y suficiente para una clave estable. */
function fnv1a64(value: string, basis: bigint): bigint {
  let hash = basis;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * FNV_PRIME) & UINT64_MASK;
  }
  return hash;
}

function toBase32Hex(value: bigint, length: number): string {
  let remaining = value;
  let encoded = "";
  for (let index = 0; index < length; index += 1) {
    encoded = BASE32_HEX_ALPHABET[Number(remaining & 31n)] + encoded;
    remaining >>= 5n;
  }
  return encoded;
}

/**
 * Clave determinista de la atención.
 *
 * Google Calendar exige que el `id` del evento use solo `a-v` y `0-9`. Dos
 * recorridos FNV-1a con bases distintas producen 130 bits codificados en 26
 * caracteres; el mismo identificador de atención siempre produce la misma
 * clave, así un reintento o un doble clic no crea un evento nuevo.
 */
export function deriveCalendarEventKey(appointmentId: string): string {
  assertNonEmpty(appointmentId, "La atención requiere un identificador.");
  const first = fnv1a64(appointmentId, FNV_OFFSET_BASIS);
  const second = fnv1a64(`ceretime:${appointmentId}`, FNV_SECOND_BASIS);
  return toBase32Hex(first, 13) + toBase32Hex(second, 13);
}

function assertNonEmpty(value: string, message: string): void {
  if (value.length === 0) throw new Error(message);
}

function assertFiniteInstant(value: number, message: string): void {
  if (!Number.isFinite(value)) throw new Error(message);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(message);
}

/**
 * Construye el evento de una atención con el mismo título y UID estables.
 * `generatedAt` se inyecta para que las pruebas no dependan del reloj.
 */
export function buildCalendarEvent(input: {
  readonly appointmentId: string;
  readonly startAt: number;
  readonly endAt: number;
  readonly timeZone: string;
  readonly generatedAt: number;
}): CalendarEventDraft {
  assertNonEmpty(input.appointmentId, "La atención requiere un identificador.");
  assertFiniteInstant(input.startAt, "El inicio de la atención debe ser un instante válido.");
  assertFiniteInstant(input.endAt, "El fin de la atención debe ser un instante válido.");
  if (input.endAt <= input.startAt) {
    throw new Error("El fin de la atención debe ser posterior a su inicio.");
  }
  assertNonEmpty(input.timeZone, "La atención requiere una zona horaria.");
  assertFiniteInstant(input.generatedAt, "La generación requiere un instante válido.");

  const key = deriveCalendarEventKey(input.appointmentId);
  return {
    appointmentId: input.appointmentId,
    uid: `${key}@${CALENDAR_EVENT_UID_DOMAIN}`,
    googleEventId: key,
    title: CALENDAR_EVENT_TITLE,
    startAt: input.startAt,
    endAt: input.endAt,
    timeZone: input.timeZone,
    generatedAt: input.generatedAt,
    version: CALENDAR_EVENT_CONTRACT_VERSION,
  };
}

/** Escapa un valor de texto según RFC 5545 (barra, punto y coma, coma y salto). */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function utf8Octets(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

/**
 * Pliega una línea a 75 octetos como máximo, sin partir caracteres UTF-8.
 * La continuación empieza con un espacio, que también cuenta en el límite.
 */
export function foldIcsLine(line: string): string {
  const folded: string[] = [];
  let current = "";
  let currentOctets = 0;
  for (const character of line) {
    const octets = utf8Octets(character);
    if (currentOctets + octets > ICS_MAX_LINE_OCTETS) {
      folded.push(current);
      current = " ";
      currentOctets = 1;
    }
    current += character;
    currentOctets += octets;
  }
  folded.push(current);
  return folded.join("\r\n");
}

function toIcsUtcStamp(epochMs: number): string {
  const iso = new Date(epochMs).toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

/**
 * Convierte el evento a `.ics` v2.0 con fechas UTC.
 *
 * No incluye `VTIMEZONE`: los instantes `DTSTART`/`DTEND` ya son absolutos y
 * `X-WR-TIMEZONE` solo orienta la visualización. El `UID` y el `DTSTAMP` se
 * generan del evento, así dos descargas del mismo evento conservan la misma
 * identidad y no se duplican al importarlas.
 */
export function serializeCalendarEventIcs(event: CalendarEventDraft): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Atencion programada//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-TIMEZONE:${event.timeZone}`,
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(event.uid)}`,
    `DTSTAMP:${toIcsUtcStamp(event.generatedAt)}`,
    `DTSTART:${toIcsUtcStamp(event.startAt)}`,
    `DTEND:${toIcsUtcStamp(event.endAt)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "SEQUENCE:0",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

/** Archivo `.ics` listo para descargar en la atención. */
export function toCalendarFile(event: CalendarEventDraft): CalendarFile {
  return {
    fileName: CALENDAR_FILE_NAME,
    content: serializeCalendarEventIcs(event),
  };
}
