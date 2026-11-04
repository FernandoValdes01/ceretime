import {
  transitionAppointment,
  decideJustificationTimeliness,
  isJustificationDecision,
  NO_SHOW_PENDING_STATE,
  type AppointmentAttendanceOutcome,
  type AppointmentStatus,
  type JustificationDecision,
  type JustificationReview,
} from "../../domain/appointments/appointment";
import {
  conflictError,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import { AGENDA_TIME_ZONE } from "../../domain/availability/availability";
import {
  authorizeAppointmentAttendance,
  authorizeAppointmentCancel,
  authorizeAppointmentReschedule,
  authorizeAppointmentJustificationSubmit,
  authorizeAppointmentJustificationReview,
  type AuthorizableAppointment,
  type AuthorizationReader,
} from "../authorization/authorize";
import { auditAppointmentChange, type AppointmentAuditRecorder } from "./audit";
import {
  resolveBookableSlot,
  slotSelectionProblem,
  type SlotSelectionDeps,
  type SlotSelectionShape,
} from "./booking";
import type { AppointmentOccupier } from "./occupancy";

/**
 * Casos de uso de cambio de una atención: cancelación y reagendamiento
 * (TI2-109) y registro de realización o inasistencia (TI2-110).
 *
 * Capa de Aplicación: autoriza la atención concreta (TI2-86), aplica la
 * política de estados de TI2-93 y persiste solo lo que esa política produce.
 * No toca `ctx.db`, no crea otra tabla ni otro repositorio, y se prueba con
 * dobles de sus puertos. La persistencia del estado y del motivo es el puerto
 * de TI2-107 (`persistAppointmentTransition`); la ocupación del destino sigue
 * siendo el de TI2-96 (`occupySlot`). Ambos se llaman dentro de la misma
 * mutation que arma Presentación: si el destino falla, no se persiste ningún
 * cambio y la atención de origen queda completa.
 *
 * Cancelar no borra la atención: conserva la fila con su estado terminal, el
 * motivo normalizado y la fecha original si ya existía. La ocupación se
 * libera porque el repositorio de ocupación considera canceladas solo las dos
 * cancelaciones, sin una escritura adicional. Reagendar mueve la misma fila
 * con `movedAppointmentId`: la ocupación valida el destino sin contar la
 * atención que se mueve y recién entonces la actualiza; después se persiste
 * el estado `rescheduled` y la primera fecha original, que la política no
 * sobrescribe en cambios encadenados.
 *
 * Cada cambio exitoso deja un evento mínimo de auditoría (TI2-128) por el
 * puerto `audit`, después de persistir y en la misma mutation: actor de la
 * sesión, instante del servidor, acción, atención y estado resultante, sin el
 * motivo. Los rechazos no se auditan porque abortan la mutation.
 *
 * Opera con datos ficticios.
 */

/** Atención leída para un cambio: pertenencia, estado y fechas vigentes. */
export interface StoredAppointmentForChange {
  readonly id: string;
  readonly accompanimentId: string;
  readonly studentId: string;
  readonly professionalId: string;
  readonly status: AppointmentStatus;
  /** Inicio vigente como milésimas de segundo epoch (vocabulario TI2-87). */
  readonly startAt: number;
  /** Fin vigente como milésimas de segundo epoch (vocabulario TI2-87). */
  readonly endAt: number;
  /** Primera fecha conservada; ausente hasta el primer reagendamiento. */
  readonly originalStartAt?: number;
  /** Justificación entregada por el Estudiante y su revisión (TI2-119). */
  readonly justificationExplanation?: string;
  readonly justificationSubmittedAt?: number;
  readonly justificationReview?: JustificationReview;
  readonly supportingDocumentReceived?: boolean;
}

/**
 * Lectura mínima de la atención que se cambia. Infraestructura la satisface
 * con la fila real; un identificador inexistente o de otra tabla responde
 * igual que una atención ajena.
 */
export interface AppointmentChangeReader {
  getAppointment(appointmentId: string): Promise<StoredAppointmentForChange | null>;
}

/**
 * Puerto de persistencia del resultado de una transición (TI2-107).
 *
 * Recibe solo los campos que la política produjo: estado, motivo de
 * cancelación y fecha original. No decide reglas ni autorización; el caso de
 * uso ya las aplicó. Se mantiene la misma firma acordada con TI2-107 para
 * ensamblar su adaptador sin otra representación.
 */
export interface AppointmentTransitionPersister {
  persistAppointmentTransition(
    appointmentId: string,
    fields: {
      readonly status: AppointmentStatus;
      readonly cancelReason?: string;
      readonly originalStartsAt?: number;
      readonly justificationExplanation?: string;
      readonly justificationSubmittedAt?: number;
      readonly justificationReview?: JustificationReview;
      readonly supportingDocumentReceived?: boolean;
    },
  ): Promise<void>;
}

/**
 * Reloj de los cambios de atención, inyectable solo desde el servidor.
 *
 * Producción lo omite y usa `Date.now`; las pruebas pasan un instante fijo
 * para no depender del reloj de la máquina. El cliente no controla este
 * valor: no viaja en la entrada pública.
 */
export type AppointmentChangeClock = () => number;

/** Dependencias de la cancelación, todas por puerto. */
export interface CancelAppointmentDeps {
  readonly auth: AuthorizationReader;
  readonly appointments: AppointmentChangeReader;
  readonly persister: AppointmentTransitionPersister;
  readonly audit: AppointmentAuditRecorder;
  readonly now?: AppointmentChangeClock;
}

/** Entrada de cancelación: identidad de sesión, atención y motivo opcional. */
export interface CancelAppointmentInput {
  readonly tokenIdentifier: string | null;
  readonly appointmentId: string;
  /** Motivo operativo: obligatorio para CERETI y opcional para el Estudiante. */
  readonly reason?: string;
}

/** Dependencias del reagendamiento: revalidación de cupo más escritura. */
export interface RescheduleAppointmentDeps extends SlotSelectionDeps {
  readonly appointments: AppointmentChangeReader;
  readonly persister: AppointmentTransitionPersister;
  readonly occupier: AppointmentOccupier;
  readonly audit: AppointmentAuditRecorder;
  readonly now?: AppointmentChangeClock;
}

/** Entrada de reagendamiento: la atención y el destino elegido. */
export interface RescheduleAppointmentInput extends SlotSelectionShape {
  readonly tokenIdentifier: string | null;
  readonly appointmentId: string;
}

/**
 * Resultado registrable de la atención: realizada (`completed`) o
 * inasistencia pendiente (`no_show`). La justificación posterior es TI2-119,
 * así que este caso de uso no acepta `no_show_justified` ni
 * `no_show_unjustified`; y `no_show` no es una realización.
 */
export type { AppointmentAttendanceOutcome };

/** Dependencias del registro de atención, todas por puerto. */
export interface RecordAppointmentAttendanceDeps {
  readonly auth: AuthorizationReader;
  readonly appointments: AppointmentChangeReader;
  readonly persister: AppointmentTransitionPersister;
  readonly audit: AppointmentAuditRecorder;
  readonly now?: AppointmentChangeClock;
}

/** Entrada del registro: identidad de sesión, atención y resultado declarado. */
export interface RecordAppointmentAttendanceInput {
  readonly tokenIdentifier: string | null;
  readonly appointmentId: string;
  readonly outcome: AppointmentAttendanceOutcome;
}

/** Éxito de un cambio: la misma atención, con identificador genérico. */
export interface AppointmentChangeSuccess {
  readonly appointmentId: string;
}

function denied<T>(): ApiResult<T> {
  return errResult(unauthorizedError());
}

function conflict<T>(): ApiResult<T> {
  return errResult(conflictError());
}

/** Instante del registro: `Date.now` en producción, fijo en pruebas. */
function occurredNow(deps: { readonly now?: AppointmentChangeClock }): number {
  return deps.now === undefined ? Date.now() : deps.now();
}

function toAuthorizableAppointment(row: StoredAppointmentForChange): AuthorizableAppointment {
  return {
    _id: row.id,
    accompanimentId: row.accompanimentId,
    studentId: row.studentId,
    professionalId: row.professionalId,
  };
}

/**
 * Cancela una atención existente.
 *
 * La identidad del actor sale de la sesión; el destino
 * (`cancelled_by_student` o `cancelled_by_cereti`) lo decide el rol. Un
 * motivo en blanco no cuenta como motivo, así la cancelación de CERETI sin
 * texto se rechaza antes de escribir. Cualquier rechazo de la política
 * responde el código estable `conflict` y no llama al persister.
 */
export async function cancelAppointment(
  deps: CancelAppointmentDeps,
  input: CancelAppointmentInput,
): Promise<ApiResult<AppointmentChangeSuccess>> {
  if (input.appointmentId.trim() === "") return conflict();

  const stored = await deps.appointments.getAppointment(input.appointmentId);
  if (stored === null) return denied();

  const grant = await authorizeAppointmentCancel(deps.auth, {
    tokenIdentifier: input.tokenIdentifier,
    appointment: toAuthorizableAppointment(stored),
  });
  if (grant.status === "error") return denied();

  const occurredAt = occurredNow(deps);
  const outcome = transitionAppointment({
    from: stored.status,
    to: grant.data.target,
    actorId: grant.data.callerId,
    occurredAt,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    currentStartAt: stored.startAt,
    ...(stored.originalStartAt === undefined
      ? {}
      : { currentOriginalStartAt: stored.originalStartAt }),
  });
  if (outcome.status === "rejected") return conflict();

  await deps.persister.persistAppointmentTransition(stored.id, {
    status: outcome.change.to,
    ...(outcome.cancelReason === undefined ? {} : { cancelReason: outcome.cancelReason }),
    ...(outcome.originalStartAt === undefined ? {} : { originalStartsAt: outcome.originalStartAt }),
  });
  await auditAppointmentChange(deps.audit, {
    action: "cancelled",
    actorId: grant.data.callerId,
    appointmentId: stored.id,
    result: outcome.change.to,
    occurredAt,
  });
  return okResult({ appointmentId: stored.id });
}

/**
 * Reagendar una atención existente a un cupo vigente y compatible.
 *
 * El Estudiante dueño puede elegir cualquier Profesional reservable del
 * acompañamiento; el Profesional solo puede mover su propia atención a su
 * propia agenda. El destino se revalida con la misma función que la reserva y
 * se ocupa con `movedAppointmentId`, que descuenta la atención que se mueve y
 * solo escribe si el estudiante, el profesional y la sala están libres. Si la
 * ocupación falla, el persister no se llama y el origen sigue intacto.
 */
export async function rescheduleAppointment(
  deps: RescheduleAppointmentDeps,
  input: RescheduleAppointmentInput,
): Promise<ApiResult<AppointmentChangeSuccess>> {
  if (input.appointmentId.trim() === "" || slotSelectionProblem(input)) {
    return conflict();
  }

  const stored = await deps.appointments.getAppointment(input.appointmentId);
  if (stored === null) return denied();

  const grant = await authorizeAppointmentReschedule(deps.auth, {
    tokenIdentifier: input.tokenIdentifier,
    appointment: toAuthorizableAppointment(stored),
  });
  if (grant.status === "error") return denied();

  // Un Profesional no puede mover su atención a la agenda de otro: la
  // coordinación entre profesionales (RF-16) queda fuera de este alcance.
  if (grant.data.actor === "professional" && input.professionalId !== grant.data.callerId) {
    return denied();
  }

  // La política se aplica antes de releer disponibilidad: una atención ya
  // cancelada o un destino inválido se rechazan sin depender de qué cupos
  // existan, y el origen no se toca.
  const occurredAt = occurredNow(deps);
  const outcome = transitionAppointment({
    from: stored.status,
    to: "rescheduled",
    actorId: grant.data.callerId,
    occurredAt,
    currentStartAt: stored.startAt,
    ...(stored.originalStartAt === undefined
      ? {}
      : { currentOriginalStartAt: stored.originalStartAt }),
    newStartAt: input.startAt,
    newEndAt: input.endAt,
  });
  if (outcome.status === "rejected") return conflict();

  const slot = await resolveBookableSlot(deps, {
    accompanimentId: stored.accompanimentId,
    professionalId: input.professionalId,
    modality: input.modality,
    ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
    startAt: input.startAt,
    endAt: input.endAt,
    timeZone: input.timeZone,
  });
  if (slot.status === "error") return slot;

  const occupied = await deps.occupier.occupySlot({
    accompanimentId: stored.accompanimentId,
    studentId: stored.studentId,
    professionalId: slot.data.professionalId,
    modality: slot.data.modality,
    ...(slot.data.spaceId === undefined ? {} : { spaceId: slot.data.spaceId }),
    startAt: slot.data.startAt,
    endAt: slot.data.endAt,
    movedAppointmentId: stored.id,
  });
  if (occupied.status === "error") return occupied;

  await deps.persister.persistAppointmentTransition(stored.id, {
    status: outcome.change.to,
    ...(outcome.originalStartAt === undefined ? {} : { originalStartsAt: outcome.originalStartAt }),
  });
  await auditAppointmentChange(deps.audit, {
    action: "rescheduled",
    actorId: grant.data.callerId,
    appointmentId: occupied.data.appointmentId,
    result: outcome.change.to,
    occurredAt,
  });
  return okResult({ appointmentId: occupied.data.appointmentId });
}

/** Verdadero solo para los dos resultados que registra TI2-110. */
function isAttendanceOutcome(value: string): value is AppointmentAttendanceOutcome {
  return value === "completed" || value === "no_show";
}

/**
 * Registra que la atención se realizó o que el Estudiante no asistió.
 *
 * Solo el Profesional asignado que tiene la atención a su cargo puede
 * declararlo: la autorización la decide TI2-86 y la identidad del actor sale
 * de la sesión, nunca de un parámetro. Sobre la misma fila se aplica la
 * política de TI2-93 con el instante del servidor (`occurredAt`) y un actor
 * no vacío; un salto de estado, una repetición, una atención ya terminal o un
 * registro anterior al inicio se rechazan con `conflict` antes de escribir.
 * El resultado se guarda por el puerto de TI2-107, junto con la fecha original
 * ya conservada si existía; no se crea acompañamiento, atención ni historial
 * paralelo. La justificación de la inasistencia queda para TI2-119.
 */
export async function recordAppointmentAttendance(
  deps: RecordAppointmentAttendanceDeps,
  input: RecordAppointmentAttendanceInput,
): Promise<ApiResult<AppointmentChangeSuccess>> {
  if (input.appointmentId.trim() === "" || !isAttendanceOutcome(input.outcome)) {
    return conflict();
  }

  const stored = await deps.appointments.getAppointment(input.appointmentId);
  if (stored === null) return denied();

  const grant = await authorizeAppointmentAttendance(deps.auth, {
    tokenIdentifier: input.tokenIdentifier,
    appointment: toAuthorizableAppointment(stored),
  });
  if (grant.status === "error") return denied();

  const occurredAt = occurredNow(deps);
  const outcome = transitionAppointment({
    from: stored.status,
    to: input.outcome,
    actorId: grant.data.callerId,
    occurredAt,
    currentStartAt: stored.startAt,
    ...(stored.originalStartAt === undefined
      ? {}
      : { currentOriginalStartAt: stored.originalStartAt }),
  });
  if (outcome.status === "rejected") return conflict();

  await deps.persister.persistAppointmentTransition(stored.id, {
    status: outcome.change.to,
    ...(outcome.originalStartAt === undefined ? {} : { originalStartsAt: outcome.originalStartAt }),
  });
  await auditAppointmentChange(deps.audit, {
    action: "attendance_recorded",
    actorId: grant.data.callerId,
    appointmentId: stored.id,
    result: outcome.change.to,
    occurredAt,
  });
  return okResult({ appointmentId: stored.id });
}

export interface SubmitAppointmentJustificationDeps {
  readonly auth: AuthorizationReader;
  readonly appointments: AppointmentChangeReader;
  readonly persister: AppointmentTransitionPersister;
  readonly now?: AppointmentChangeClock;
}

export interface SubmitAppointmentJustificationInput {
  readonly tokenIdentifier: string | null;
  readonly appointmentId: string;
  /** Explicación operativa del Estudiante; sin certificados ni diagnósticos. */
  readonly explanation: string;
  /** Solo constancia de recepción por canal institucional: no se guarda archivo. */
  readonly supportingDocumentReceived: boolean;
}

/**
 * Entrega de la explicación de una inasistencia pendiente (TI2-119).
 *
 * Solo el Estudiante dueño de la atención puede entregarla, una única vez y
 * mientras el plazo de cinco días hábiles de TI2-94 siga abierto. El plazo se
 * decide con el reloj del servidor y el calendario de la agenda: el cliente no
 * envía ni la zona ni el instante. La entrega deja la atención en `no_show`
 * con la revisión `pending`; no la resuelve ni borra nada.
 */
export async function submitAppointmentJustification(
  deps: SubmitAppointmentJustificationDeps,
  input: SubmitAppointmentJustificationInput,
): Promise<ApiResult<AppointmentChangeSuccess>> {
  const explanation = input.explanation.trim();
  if (input.appointmentId.trim() === "" || explanation === "") {
    return conflict();
  }

  const stored = await deps.appointments.getAppointment(input.appointmentId);
  if (stored === null) return denied();

  const grant = await authorizeAppointmentJustificationSubmit(deps.auth, {
    tokenIdentifier: input.tokenIdentifier,
    appointment: toAuthorizableAppointment(stored),
  });
  if (grant.status === "error") return denied();

  if (stored.status !== NO_SHOW_PENDING_STATE || stored.justificationSubmittedAt !== undefined) {
    return conflict();
  }

  const submittedAt = occurredNow(deps);
  const timeliness = decideJustificationTimeliness({
    missedAt: stored.startAt,
    submittedAt,
    timeZone: AGENDA_TIME_ZONE,
  });
  if (!timeliness.withinDeadline) return conflict();

  await deps.persister.persistAppointmentTransition(stored.id, {
    status: stored.status,
    justificationExplanation: explanation,
    justificationSubmittedAt: submittedAt,
    justificationReview: "pending",
    supportingDocumentReceived: input.supportingDocumentReceived,
  });
  return okResult({ appointmentId: stored.id });
}

export interface ReviewAppointmentJustificationDeps {
  readonly auth: AuthorizationReader;
  readonly appointments: AppointmentChangeReader;
  readonly persister: AppointmentTransitionPersister;
  readonly now?: AppointmentChangeClock;
}

export interface ReviewAppointmentJustificationInput {
  readonly tokenIdentifier: string | null;
  readonly appointmentId: string;
  readonly review: JustificationDecision;
}

/**
 * Revisión de la justificación por el Profesional asignado (TI2-119).
 *
 * Aceptar exige una entrega `pending` del Estudiante y deja `no_show_justified`.
 * Rechazar una entrega `pending` deja `no_show_unjustified`. Sin entrega, la
 * misma operación con `rejected` cierra una inasistencia cuyo plazo de TI2-94
 * ya venció: es el mecanismo verificable de vencimiento, evaluado con el reloj
 * del servidor y sin cron ni sanción automática. Nunca se acepta una
 * justificación inexistente ni se rechaza dentro del plazo abierto.
 */
export async function reviewAppointmentJustification(
  deps: ReviewAppointmentJustificationDeps,
  input: ReviewAppointmentJustificationInput,
): Promise<ApiResult<AppointmentChangeSuccess>> {
  if (input.appointmentId.trim() === "" || !isJustificationDecision(input.review)) {
    return conflict();
  }

  const stored = await deps.appointments.getAppointment(input.appointmentId);
  if (stored === null) return denied();

  const grant = await authorizeAppointmentJustificationReview(deps.auth, {
    tokenIdentifier: input.tokenIdentifier,
    appointment: toAuthorizableAppointment(stored),
  });
  if (grant.status === "error") return denied();

  if (stored.status !== NO_SHOW_PENDING_STATE) return conflict();

  const reviewedAt = occurredNow(deps);
  const hasSubmission = stored.justificationSubmittedAt !== undefined;
  if (hasSubmission) {
    if (stored.justificationReview !== "pending") return conflict();
  } else {
    const timeliness = decideJustificationTimeliness({
      missedAt: stored.startAt,
      submittedAt: reviewedAt,
      timeZone: AGENDA_TIME_ZONE,
    });
    if (input.review === "accepted" || timeliness.withinDeadline) return conflict();
  }

  const targetStatus = input.review === "accepted" ? "no_show_justified" : "no_show_unjustified";
  const outcome = transitionAppointment({
    from: stored.status,
    to: targetStatus,
    actorId: grant.data.callerId,
    occurredAt: reviewedAt,
    currentStartAt: stored.startAt,
    ...(stored.originalStartAt === undefined
      ? {}
      : { currentOriginalStartAt: stored.originalStartAt }),
  });
  if (outcome.status === "rejected") return conflict();

  await deps.persister.persistAppointmentTransition(stored.id, {
    status: outcome.change.to,
    ...(hasSubmission ? { justificationReview: input.review } : {}),
    ...(outcome.originalStartAt === undefined ? {} : { originalStartsAt: outcome.originalStartAt }),
  });
  return okResult({ appointmentId: stored.id });
}
