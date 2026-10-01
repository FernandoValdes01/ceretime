/**
 * Disponibilidad de agenda: contratos públicos versionados (TI2-87).
 *
 * Dominio puro: no importa Convex ni `convex/_generated`, para que Web y
 * Mobile consuman la forma sin levantar el backend. Define bloques
 * recurrentes, excepciones y franjas disponibles con versión explícita
 * `v1`, sin duplicar la API Convex: la superficie sigue siendo
 * `api.presentation.*` y los tipos generados; este módulo solo fija la
 * forma que esas entradas devolverán cuando otros módulos implementen la
 * lectura y la escritura.
 *
 * No implementa reglas de negocio: el cruce entre estudiantes,
 * profesionales y salas, la recurrencia efectiva y la resolución de
 * excepciones pertenecen a los casos de uso de otros módulos. Acá solo hay
 * comprobaciones de forma (día, hora, duración y topes de lectura).
 */

import type { ApiResult } from "../errors/api_error";

/** Versión del contrato de agenda que devuelve cada proyección. */
export const AGENDA_CONTRACT_VERSION = "v1" as const;

export type AgendaContractVersion = typeof AGENDA_CONTRACT_VERSION;

/** Modalidad de una franja disponible, compatible con la solicitud. */
export const AVAILABILITY_MODALITY_VALUES = ["inPerson", "online"] as const;

export type AvailabilityModality = (typeof AVAILABILITY_MODALITY_VALUES)[number];

/** Duración mínima y máxima de un bloque en minutos, como tope de forma. */
export const AVAILABILITY_SLOT_MINUTES_MIN = 15;

export const AVAILABILITY_SLOT_MINUTES_MAX = 480;

/** Tope de lectura propia para no devolver listados ilimitados. */
export const AVAILABILITY_MAX_ITEMS_PER_READ = 50;

/** Bloque recurrente semanal de disponibilidad de un profesional. */
export interface RecurringAvailabilityBlock {
  readonly id: string;
  readonly professionalId: string;
  /** Día de la semana, 0 (domingo) a 6 (sábado). */
  readonly weekday: number;
  /** Hora de inicio en formato `HH:MM` de 24 horas. */
  readonly from: string;
  /** Hora de término en formato `HH:MM` de 24 horas. */
  readonly to: string;
  readonly durationMinutes: number;
  readonly modality: AvailabilityModality;
  readonly spaceId?: string;
  readonly version: AgendaContractVersion;
}

/** Excepción puntual sobre la recurrencia (feriado, cierre u hora extra). */
export interface AvailabilityException {
  readonly id: string;
  readonly professionalId: string;
  /** Fecha puntual en formato `YYYY-MM-DD`. */
  readonly date: string;
  readonly kind: "unavailable" | "extra";
  readonly from?: string;
  readonly to?: string;
  /** Motivo operativo breve, sin datos sensibles. */
  readonly reason?: string;
  readonly version: AgendaContractVersion;
}

/** Franja disponible ya resuelta, lista para reservar. */
export interface AvailabilitySlot {
  readonly id: string;
  readonly professionalId: string;
  readonly startAt: number;
  readonly endAt: number;
  readonly modality: AvailabilityModality;
  readonly spaceId?: string;
  readonly version: AgendaContractVersion;
}

/** Verdadero cuando el valor es una modalidad de disponibilidad válida. */
export function isAvailabilityModality(value: string): value is AvailabilityModality {
  return (AVAILABILITY_MODALITY_VALUES as readonly string[]).includes(value);
}

/** Verdadero cuando el día cae entre domingo (0) y sábado (6). */
export function isValidWeekday(weekday: number): boolean {
  return Number.isInteger(weekday) && weekday >= 0 && weekday <= 6;
}

const TIME_LABEL_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Verdadero cuando la etiqueta es una hora `HH:MM` válida de 24 horas. */
export function isValidTimeLabel(label: string): boolean {
  return TIME_LABEL_PATTERN.test(label);
}

const DATE_LABEL_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Verdadero cuando la etiqueta es una fecha `YYYY-MM-DD` con forma válida. */
export function isValidDateLabel(label: string): boolean {
  return DATE_LABEL_PATTERN.test(label);
}

/** Verdadero cuando la duración cabe en el tope de forma del contrato. */
export function isDurationWithinLimit(minutes: number): boolean {
  return (
    Number.isInteger(minutes) &&
    minutes >= AVAILABILITY_SLOT_MINUTES_MIN &&
    minutes <= AVAILABILITY_SLOT_MINUTES_MAX
  );
}

/** Verdadero cuando el rango horario avanza (`from` anterior a `to`). */
export function isTimeRangeOrdered(from: string, to: string): boolean {
  if (!isValidTimeLabel(from) || !isValidTimeLabel(to)) return false;
  return from < to;
}

/**
 * Valida la forma de un bloque recurrente sin decidir cruces ni recurrencia.
 * Devuelve la misma forma versionada o un error público estable con código.
 */
export function toVersionedAvailabilityBlock(
  block: Omit<RecurringAvailabilityBlock, "version">,
): ApiResult<RecurringAvailabilityBlock> {
  if (!isValidWeekday(block.weekday)) {
    return {
      status: "error",
      error: {
        code: "availability_invalid_weekday",
        message: "El día de la semana debe estar entre 0 y 6.",
      },
    };
  }
  if (!isTimeRangeOrdered(block.from, block.to)) {
    return {
      status: "error",
      error: {
        code: "availability_invalid_time_range",
        message: "El rango horario debe avanzar en formato HH:MM.",
      },
    };
  }
  if (!isAvailabilityModality(block.modality)) {
    return {
      status: "error",
      error: {
        code: "availability_invalid_modality",
        message: "La modalidad debe ser presencial o en línea.",
      },
    };
  }
  if (!isDurationWithinLimit(block.durationMinutes)) {
    return {
      status: "error",
      error: {
        code: "availability_invalid_duration",
        message: "La duración debe estar entre 15 y 480 minutos.",
      },
    };
  }
  return { status: "ok", data: { ...block, version: AGENDA_CONTRACT_VERSION } };
}
