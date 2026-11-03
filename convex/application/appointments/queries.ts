/**
 * Lectura acotada de atenciones para el detalle del acompañamiento (TI2-122).
 *
 * Capa de Aplicación: autoriza el acompañamiento con la misma regla de
 * `appointment:read` y devuelve solo el resumen que la interfaz necesita para
 * ofrecer las acciones de calendario. No expone profesional, sala, notas ni
 * necesidades: la proyección completa sigue viviendo en su contrato propio.
 */

import type { ModalityPreference } from "../../domain/requests/request";
import type { AppointmentStatus } from "../../domain/appointments/appointment";
import {
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import { authorizeAppointmentRead, type AuthorizationReader } from "../authorization/authorize";

/** Resumen mínimo de una atención propia para el portal. */
export interface AppointmentCalendarSummary {
  readonly appointmentId: string;
  readonly status: AppointmentStatus;
  readonly startAt: number;
  readonly endAt: number;
  readonly modality: ModalityPreference;
  readonly calendarAdded: boolean;
}

/** Lectura acotada por acompañamiento, ordenada de la más reciente a la más antigua. */
export interface AppointmentListReader {
  listByAccompaniment(input: {
    readonly accompanimentId: string;
    readonly limit: number;
  }): Promise<readonly AppointmentCalendarSummary[]>;
}

/** Tope del listado: el detalle no pagina ni necesita historial ilimitado. */
export const APPOINTMENT_CALENDAR_LIST_LIMIT = 50;

/**
 * Lista las atenciones del acompañamiento cuando el rol puede leerlas.
 * Estudiante, Profesional y Practicante reciben lo que su vista permite;
 * Administrador y acompañamientos ajenos reciben la denegación genérica.
 */
export async function listAccompanimentAppointmentsUseCase(
  deps: {
    readonly auth: AuthorizationReader;
    readonly appointments: AppointmentListReader;
  },
  input: {
    readonly tokenIdentifier: string | null;
    readonly accompanimentId: string;
  },
): Promise<ApiResult<AppointmentCalendarSummary[]>> {
  const grant = await authorizeAppointmentRead(deps.auth, {
    tokenIdentifier: input.tokenIdentifier,
    accompanimentId: input.accompanimentId,
  });
  if (grant.status === "error") return errResult(unauthorizedError());

  const items = await deps.appointments.listByAccompaniment({
    accompanimentId: input.accompanimentId,
    limit: APPOINTMENT_CALENDAR_LIST_LIMIT,
  });
  return okResult([...items]);
}
