/**
 * Reserva de atención: contratos públicos versionados (TI2-87).
 *
 * Dominio puro: no importa Convex ni `convex/_generated`. Fija los estados
 * de reserva, cambio, cancelación e inasistencia con versión explícita `v1`,
 * sin duplicar la API Convex: la superficie sigue siendo
 * `api.presentation.*` y este módulo solo fija la forma que esas entradas
 * devolverán cuando otros módulos implementen la escritura.
 *
 * No implementa reglas de negocio: las transiciones, la coordinación
 * multiprofesional y la justificación pertenecen a los casos de uso de otros
 * módulos. Acá solo hay literales, etiquetas en español y forma versionada.
 */

import type { ApiResult } from "../errors/api_error";
import type { AvailabilityModality } from "../agenda/availability";

/** Versión del contrato de reserva que devuelve cada proyección. */
export const RESERVATION_CONTRACT_VERSION = "v1" as const;

export type ReservationContractVersion = typeof RESERVATION_CONTRACT_VERSION;

/** Estados de reserva habilitados en el contrato v1, en orden de lectura. */
export const RESERVATION_STATUS_VALUES = [
  "reserved",
  "rescheduled",
  "completed",
  "cancelled_by_student",
  "cancelled_by_cereti",
  "no_show_pending",
  "no_show_justified",
  "no_show_unjustified",
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUS_VALUES)[number];

/** Etiqueta en español de cada estado de reserva, para Web y Mobile. */
export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  reserved: "Reservada",
  rescheduled: "Reagendada",
  completed: "Realizada",
  cancelled_by_student: "Cancelada por el estudiante",
  cancelled_by_cereti: "Cancelada por CERETI",
  no_show_pending: "Inasistencia pendiente de justificación",
  no_show_justified: "Inasistencia justificada",
  no_show_unjustified: "Inasistencia sin justificar",
};

/** Plazo de justificación en días hábiles, como constante de contrato. */
export const JUSTIFICATION_WINDOW_BUSINESS_DAYS = 5;

/** Reserva de atención vinculada a un acompañamiento activo. */
export interface Reservation {
  readonly _id: string;
  readonly accompanimentId: string;
  readonly modality: AvailabilityModality;
  readonly startAt: number;
  readonly endAt: number;
  readonly status: ReservationStatus;
  readonly spaceId?: string;
  readonly slotId?: string;
  readonly version: ReservationContractVersion;
}

/** Verdadero cuando el valor es un estado de reserva del contrato v1. */
export function isReservationStatus(value: string): value is ReservationStatus {
  return (RESERVATION_STATUS_VALUES as readonly string[]).includes(value);
}

/** Verdadero cuando el rango temporal avanza (`startAt` anterior a `endAt`). */
export function isReservationRangeOrdered(startAt: number, endAt: number): boolean {
  return Number.isFinite(startAt) && Number.isFinite(endAt) && startAt < endAt;
}

/**
 * Valida una fila de reserva y devuelve la entidad pública versionada.
 * Rechaza un `status` desconocido en vez de propagarlo: una fila con estado
 * inválido es corrupción, no una reserva. No decide transiciones.
 */
export function toReservation(row: {
  readonly _id: string;
  readonly accompanimentId: string;
  readonly modality: string;
  readonly startAt: number;
  readonly endAt: number;
  readonly status: string;
  readonly spaceId?: string;
  readonly slotId?: string;
}): ApiResult<Reservation> {
  if (!isReservationStatus(row.status)) {
    return {
      status: "error",
      error: {
        code: "reservation_unknown_status",
        message: "El estado de la reserva no pertenece al contrato vigente.",
      },
    };
  }
  if (row.modality !== "inPerson" && row.modality !== "online") {
    return {
      status: "error",
      error: {
        code: "reservation_invalid_modality",
        message: "La modalidad debe ser presencial o en línea.",
      },
    };
  }
  if (!isReservationRangeOrdered(row.startAt, row.endAt)) {
    return {
      status: "error",
      error: {
        code: "reservation_invalid_time_range",
        message: "El rango de la reserva debe avanzar en el tiempo.",
      },
    };
  }
  return {
    status: "ok",
    data: {
      _id: row._id,
      accompanimentId: row.accompanimentId,
      modality: row.modality,
      startAt: row.startAt,
      endAt: row.endAt,
      status: row.status,
      spaceId: row.spaceId,
      slotId: row.slotId,
      version: RESERVATION_CONTRACT_VERSION,
    },
  };
}
