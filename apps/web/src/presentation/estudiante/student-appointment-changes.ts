import {
  NO_SHOW_PENDING_STATE,
  findAppointmentTransition,
  justificationDeadlineFor,
  type AppointmentStatus,
} from "../../../../../convex/domain/index.ts";
import type { AgendaAppointment } from "../../application/agenda/agenda-port.ts";

/**
 * Qué cambios ofrece la vista del Estudiante sobre su atención (TI2-163).
 *
 * No es una regla nueva: lee la tabla única de transiciones del dominio
 * (`APPOINTMENT_TRANSITIONS`) y el plazo único de justificación (TI2-147). El
 * Backend vuelve a decidir todo al recibir el cambio; esto solo evita ofrecer
 * una acción que el contrato ya declara imposible.
 */

/** Cancelación disponible y si el dominio exige motivo para el Estudiante. */
export type StudentCancellation = { readonly reasonRequired: boolean };

export type StudentAppointmentChanges = {
  readonly canReschedule: boolean;
  /** `null` cuando el Estudiante no puede cancelar esta atención. */
  readonly cancellation: StudentCancellation | null;
};

/**
 * Verdadero mientras la atención todavía puede realizarse: programada o
 * reagendada, según las transiciones del dominio.
 */
export function isAppointmentUpcoming(status: AppointmentStatus): boolean {
  return findAppointmentTransition(status, "completed") !== undefined;
}

/** Cancelación del Estudiante desde un estado, con el motivo que pide el dominio. */
export function studentCancellationFrom(status: AppointmentStatus): StudentCancellation | null {
  const transition = findAppointmentTransition(status, "cancelled_by_student");
  return transition === undefined ? null : { reasonRequired: transition.requiresReason };
}

/**
 * Cambios que se ofrecen en el detalle. Desde el inicio de la atención el
 * Backend rechaza cancelar y reagendar (TI2-155), así que la vista tampoco los
 * ofrece; el reloj del navegador solo decide qué se muestra.
 */
export function studentAppointmentChanges(
  appointment: Pick<AgendaAppointment, "status" | "startAt">,
  nowMs: number,
): StudentAppointmentChanges {
  if (nowMs >= appointment.startAt) {
    return { canReschedule: false, cancellation: null };
  }
  return {
    canReschedule: findAppointmentTransition(appointment.status, "rescheduled") !== undefined,
    cancellation: studentCancellationFrom(appointment.status),
  };
}

/** Estados de una inasistencia: pendiente de justificar o ya resuelta. */
const NO_SHOW_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  NO_SHOW_PENDING_STATE,
  "no_show_justified",
  "no_show_unjustified",
]);

/**
 * Situación de la justificación de una inasistencia, para presentarla.
 *
 * - `none`: la atención no es una inasistencia.
 * - `open`: inasistencia pendiente, sin entrega y dentro del plazo.
 * - `expired`: inasistencia pendiente, sin entrega y con el plazo vencido; el
 *   Backend la cierra como no justificada.
 * - `submitted`: hay entrega, con su recepción y su revisión.
 * - `closed`: inasistencia resuelta sin entrega.
 */
export type JustificationSituation =
  | { readonly kind: "none" }
  | { readonly kind: "open"; readonly deadlineDate: string }
  | { readonly kind: "expired"; readonly deadlineDate: string }
  | {
      readonly kind: "submitted";
      readonly deadlineDate: string;
      readonly submittedAt: number;
      readonly supportingDocumentReceived: boolean;
      readonly review: NonNullable<AgendaAppointment["justificationReview"]>;
      readonly reviewExplanation?: string;
    }
  | { readonly kind: "closed" };

export function justificationSituationOf(
  appointment: AgendaAppointment,
  nowMs: number,
): JustificationSituation {
  if (!NO_SHOW_STATUSES.has(appointment.status)) {
    return { kind: "none" };
  }
  // La inasistencia ocurre al inicio de la atención: el mismo instante que
  // usan entregar, revisar y vencer en el Backend.
  const deadline = justificationDeadlineFor(appointment.startAt);
  if (appointment.justificationSubmittedAt !== undefined) {
    return {
      kind: "submitted",
      deadlineDate: deadline.deadlineDate,
      submittedAt: appointment.justificationSubmittedAt,
      supportingDocumentReceived: appointment.supportingDocumentReceived ?? false,
      review: appointment.justificationReview ?? "pending",
      ...(appointment.justificationReviewExplanation === undefined
        ? {}
        : { reviewExplanation: appointment.justificationReviewExplanation }),
    };
  }
  if (appointment.status !== NO_SHOW_PENDING_STATE) {
    return { kind: "closed" };
  }
  return nowMs < deadline.deadlineAt
    ? { kind: "open", deadlineDate: deadline.deadlineDate }
    : { kind: "expired", deadlineDate: deadline.deadlineDate };
}
