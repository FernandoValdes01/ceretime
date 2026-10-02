/**
 * Atención reservada: contratos públicos compartidos v1 (TI2-87).
 *
 * Dominio puro: no importa Convex, React ni Expo, para que Web y Mobile
 * consuman la misma forma sin levantar el backend. Reserva y atención son
 * una sola entidad (`appointments` es la única representación: no existe un
 * `domain/reservations` paralelo); la inasistencia es un estado de la
 * atención y su justificación vive en una extensión futura.
 *
 * Reutiliza los literales de TI2-83 y `ModalityPreference` de la solicitud
 * para no duplicar su representación; las transiciones son de TI2-93 y la
 * conciliación con la persistencia se prepara en los repositorios de S2.
 * Acá solo hay forma versionada con identificadores genéricos (`string`
 * plano, sin `Id`/`Doc` de Convex), sin políticas propias.
 */

import type { ModalityPreference } from "../request/request";

/** Versión del contrato público de la atención reservada. */
export const APPOINTMENT_CONTRACT_VERSION = "v1" as const;

export type AppointmentContractVersion = typeof APPOINTMENT_CONTRACT_VERSION;

/** Estados del ciclo de reserva de una atención, en orden de flujo (TI2-83). */
export const APPOINTMENT_STATUS_VALUES = [
  "scheduled",
  "completed",
  "cancelled_by_student",
  "cancelled_by_cereti",
  "rescheduled",
  "no_show",
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUS_VALUES)[number];

/** Estado inicial de una reserva recién creada. */
export const INITIAL_APPOINTMENT_STATUS: AppointmentStatus = "scheduled";

/** Atención reservada vinculada a un acompañamiento, con identificadores genéricos. */
export interface Appointment {
  readonly id: string;
  readonly accompanimentId: string;
  readonly professionalId: string;
  readonly modality: ModalityPreference;
  /** Referencia opaca al espacio; ausente en modalidad en línea. */
  readonly spaceId?: string;
  /** Referencia opaca al cupo de disponibilidad que la originó. */
  readonly slotId?: string;
  /** Inicio de la atención como milisegundos epoch. */
  readonly startAt: number;
  /** Fin de la atención como milisegundos epoch. */
  readonly endAt: number;
  readonly status: AppointmentStatus;
  readonly version: AppointmentContractVersion;
}

/** Entrada mínima para listar atenciones: filtros opcionales y paginación. */
export interface ListAppointmentsInput {
  readonly accompanimentId?: string;
  readonly professionalId?: string;
  readonly limit: number;
  readonly cursor?: string;
  readonly version: AppointmentContractVersion;
}

/** Página de atenciones con paginación keyset sobre el identificador. */
export interface AppointmentPage {
  readonly items: readonly Appointment[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  readonly version: AppointmentContractVersion;
}
