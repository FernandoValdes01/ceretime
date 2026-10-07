import type { ApiResult } from "../../domain/errors/api_error";
import type { ModalityPreference } from "../../domain/requests/request";

/**
 * Puerto mínimo de ocupación de cupo (TI2-84).
 *
 * Capa de Aplicación: fija la firma que consumen TI2-96/TI2-98, sin
 * implementación Convex (no importa `convex/server`, `_generated` ni
 * `ctx.db`). La única implementación vive en
 * `convex/infrastructure/appointments/repository.ts` (`occupySlotAtomically`),
 * que lee la ocupación y escribe la atención en la misma transacción.
 *
 * Reserva y atención son una sola entidad (`appointments`, sin tabla
 * `reservations` paralela); los identificadores son genéricos (`string`
 * plano) para que Web y Mobile compartan la forma sin levantar el backend.
 * La versión del contrato la fija TI2-87 (`AppointmentContractVersion`); acá
 * no hay otra versión paralela. El rechazo por contienda usa `conflict`
 * (TI2-88); `no_availability` queda para la ausencia de cupo en búsqueda
 * (TI2-98), no para la carrera. Los cruces completos de
 * estudiante/profesional/sala los agrega TI2-96 sobre este mismo puerto y
 * los estados los completa TI2-107. Opera con datos ficticios.
 */

/** Entrada mínima para ocupar un cupo con identificadores genéricos. */
export interface OccupySlotInput {
  readonly accompanimentId: string;
  readonly studentId: string;
  readonly professionalId: string;
  readonly modality: ModalityPreference;
  /** Referencia opaca al espacio; ausente en modalidad en línea. */
  readonly spaceId?: string;
  /** Inicio del cupo como milisegundos epoch. */
  readonly startsAt: number;
  /** Fin del cupo como milisegundos epoch. */
  readonly endsAt: number;
}

/** Éxito de la ocupación: la atención creada, con identificador genérico. */
export interface OccupySlotSuccess {
  readonly appointmentId: string;
}

/** Resultado estable de la ocupación según TI2-88. */
export type OccupySlotResult = ApiResult<OccupySlotSuccess>;
