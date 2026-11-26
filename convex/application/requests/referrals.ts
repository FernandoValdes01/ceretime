import { normalizeEmail } from "../../domain/auth/institutional_domain";
import {
  errResult,
  okResult,
  requestStudentNotFoundError,
  type ApiResult,
} from "../../domain/errors/api_error";
import {
  recordReferralAcceptance as applyReferralAcceptance,
  recordReferralContact as applyReferralContact,
  toDestinationUnit,
  toOfficialReceivedAt,
  toOriginUnit,
  toReferralReason,
  type IncomingReferral,
  type ReferralStepRejectionCause,
  type ReferralStepResult,
} from "../../domain/requests/referral";
import {
  invalidRequestFields,
  toCompleteSubmission,
  toRequestSubmission,
  type RequestSubmissionDraft,
} from "../../domain/requests/request";
import { findRequestTransition, transitionRequest } from "../../domain/requests/transition_policy";
import { ACCEPTANCE_STATE } from "../../domain/requests/transitions";
import type {
  ActiveProfessionalReader,
  ActiveStudentByEmailReader,
  OfficialRequestRegistrar,
  RequestReader,
  RequestReferralWriter,
  RequestStatusWriter,
  RequestTakeReader,
  RequestTransitionRecorder,
} from "./ports";
import type { NotificationEventRecorder } from "../notifications/ports";
import { notifyRequestChange, notifyRequestReceived } from "./notifications";
import { toStatusChange } from "./status_change";
import { denied, stateConflict, toEntity, type RequestEntity } from "./results";

/**
 * Casos de uso del canal oficial y de las derivaciones (TI2-143).
 *
 * Capa de Aplicación: el personal autorizado es el Profesional con cuenta
 * vigente, el mismo que revisa solicitudes. Registrar por canal oficial solo
 * exige ese perfil; el contacto, la aceptación y la derivación de salida
 * exigen además la toma activa sobre la solicitud. Cualquier otra persona, o
 * una solicitud inexistente, recibe `unauthorized` sin motivo.
 *
 * Las reglas viven en Dominio (`referral.ts` y la política de transición);
 * acá se autoriza, se ordena y se persiste por puertos. No hay envío del
 * aviso ni comunicación con otras unidades: eso ocurre fuera de la
 * aplicación. El registro y la derivación de salida dejan su aviso en el
 * sistema (TI2-150); el contacto y la aceptación de la derivación de entrada
 * no cambian el estado y no avisan. Opera con datos ficticios.
 */

/** Capacidades del registro por canal oficial. */
export interface RegisterOfficialRequestDeps<RequestId extends string, UserId extends string> {
  readonly professionals: ActiveProfessionalReader<UserId>;
  readonly students: ActiveStudentByEmailReader<UserId>;
  readonly requests: RequestReader<RequestId, UserId> & OfficialRequestRegistrar<RequestId, UserId>;
  readonly notifications: NotificationEventRecorder;
  /** Reloj del servidor; las pruebas lo fijan. */
  readonly now: () => number;
}

/**
 * Registra una solicitud que CERETI recibió por un canal oficial, a nombre
 * del Estudiante indicado por su correo institucional. Queda `received`, con
 * su procedencia: quién la registró y cuándo se recibió. Con `originUnit`
 * es además una derivación de entrada, que no abre acompañamiento hasta que
 * conste el contacto y la aceptación del estudiante.
 *
 * El contenido sigue la forma completa de `createRequest`, con las mismas
 * reglas. Autoriza antes de validar. El correo
 * debe ser de una cuenta de Estudiante vigente; si no, responde
 * `request_fields_invalid`, lo que le dice al personal de CERETI que ese
 * correo no tiene una cuenta vigente y nada más.
 */
export async function registerOfficialRequest<RequestId extends string, UserId extends string>(
  deps: RegisterOfficialRequestDeps<RequestId, UserId>,
  input: {
    readonly tokenIdentifier: string | null;
    readonly studentEmail: string;
    readonly submission: RequestSubmissionDraft;
    readonly receivedAt?: number;
    readonly originUnit?: string;
  },
): Promise<ApiResult<RequestEntity<RequestId, UserId>>> {
  const professional = await deps.professionals.findActiveProfessional(input.tokenIdentifier);
  if (professional === null) return denied();
  const complete = toCompleteSubmission(input.submission);
  if (complete.status === "error") return complete;
  const submission = toRequestSubmission(complete.data);
  if (submission.status === "error") return submission;
  const receivedAt = toOfficialReceivedAt(input.receivedAt, deps.now());
  if (receivedAt.status === "error") return receivedAt;
  const originUnit = input.originUnit === undefined ? undefined : toOriginUnit(input.originUnit);
  if (originUnit?.status === "error") return originUnit;
  const email = normalizeEmail(input.studentEmail);
  if (email === "") return invalidRequestFields("Indica el correo institucional del estudiante.");
  const student = await deps.students.findActiveStudentByEmail(email);
  if (student === null) return errResult(requestStudentNotFoundError());
  const requestId = await deps.requests.registerOfficial({
    studentId: student._id,
    submission: submission.data,
    registeredBy: professional._id,
    receivedAt: receivedAt.data,
    ...(originUnit === undefined ? {} : { originUnit: originUnit.data }),
  });
  const row = await deps.requests.getRequest(requestId);
  if (row === null) throw new Error("La solicitud registrada no quedó guardada.");
  await notifyRequestReceived(deps.notifications, row);
  return okResult(toEntity(row));
}

/** Capacidades de los pasos de la derivación de entrada. */
export interface ReferralStepDeps<RequestId extends string, UserId extends string> {
  readonly professionals: ActiveProfessionalReader<UserId>;
  readonly requests: RequestReader<RequestId, UserId> &
    RequestTakeReader<RequestId, UserId> &
    RequestReferralWriter<RequestId, UserId>;
  /** Reloj del servidor para la fecha del paso; las pruebas lo fijan. */
  readonly now: () => number;
}

const REFERRAL_STEP_CONFLICTS: Record<ReferralStepRejectionCause, string> = {
  not_a_referral: "La solicitud no viene de una derivación.",
  already_contacted: "El contacto con el estudiante ya está registrado.",
  contact_required: "Registra primero el contacto con el estudiante.",
  already_accepted: "La aceptación del estudiante ya está registrada.",
};

/**
 * Paso común del contacto y la aceptación: Profesional vigente con toma
 * activa, sobre una solicitud que todavía puede aceptarse. Después de
 * aceptar, cerrar, cancelar o derivar, el paso ya no cambia nada que importe
 * y responde `conflict`. No cambia el estado de la solicitud.
 */
async function applyReferralStep<RequestId extends string, UserId extends string>(
  deps: ReferralStepDeps<RequestId, UserId>,
  input: { readonly tokenIdentifier: string | null; readonly requestId: RequestId },
  step: (
    referral: IncomingReferral<UserId> | undefined,
    professionalId: UserId,
    occurredAt: number,
  ) => ReferralStepResult<UserId>,
): Promise<ApiResult<RequestEntity<RequestId, UserId>>> {
  const professional = await deps.professionals.findActiveProfessional(input.tokenIdentifier);
  if (professional === null) return denied();
  const row = await deps.requests.getRequest(input.requestId);
  if (row === null) return denied();
  if (!(await deps.requests.hasActiveTake(row._id, professional._id))) return denied();
  if (findRequestTransition(row.status, ACCEPTANCE_STATE) === undefined) {
    return stateConflict("La solicitud ya no admite este registro en su estado actual.");
  }
  const result = step(row.incomingReferral, professional._id, deps.now());
  if (result.status === "rejected") return stateConflict(REFERRAL_STEP_CONFLICTS[result.cause]);
  await deps.requests.setIncomingReferral(row._id, result.referral);
  return okResult(toEntity(row));
}

/**
 * Registra que CERETI contactó al estudiante por la derivación de entrada:
 * guarda quién contactó y cuándo, una sola vez.
 */
export async function recordReferralContact<RequestId extends string, UserId extends string>(
  deps: ReferralStepDeps<RequestId, UserId>,
  input: { readonly tokenIdentifier: string | null; readonly requestId: RequestId },
): Promise<ApiResult<RequestEntity<RequestId, UserId>>> {
  return applyReferralStep(deps, input, (referral, professionalId, occurredAt) =>
    applyReferralContact(referral, { contactedBy: professionalId, contactedAt: occurredAt }),
  );
}

/**
 * Registra que el estudiante aceptó tras el contacto. Recién entonces la
 * solicitud puede aceptarse y abrir su acompañamiento.
 */
export async function recordReferralAcceptance<RequestId extends string, UserId extends string>(
  deps: ReferralStepDeps<RequestId, UserId>,
  input: { readonly tokenIdentifier: string | null; readonly requestId: RequestId },
): Promise<ApiResult<RequestEntity<RequestId, UserId>>> {
  return applyReferralStep(deps, input, (referral, _professionalId, occurredAt) =>
    applyReferralAcceptance(referral, occurredAt),
  );
}

/** Capacidades de la derivación de salida. */
export interface ReferRequestDeps<RequestId extends string, UserId extends string> {
  readonly professionals: ActiveProfessionalReader<UserId>;
  readonly requests: RequestReader<RequestId, UserId> &
    RequestTakeReader<RequestId, UserId> &
    RequestStatusWriter<RequestId, UserId> &
    RequestTransitionRecorder<RequestId, UserId>;
  readonly notifications: NotificationEventRecorder;
  /** Reloj del servidor para el registro del cambio; las pruebas lo fijan. */
  readonly now: () => number;
}

/**
 * Deriva la solicitud a otra unidad: mueve `under_review` o
 * `awaiting_information_or_acceptance` a `referred` con la política de
 * transición. Solo un Profesional con cuenta vigente y toma activa. Pide el
 * nombre de la unidad de destino y la razón que lee el estudiante; no pide
 * destinatarios ni antecedentes. Un estado que no admite el paso responde
 * `conflict` y un campo que falta `request_fields_invalid`, sin escribir.
 *
 * Persiste el estado, la derivación y el registro del cambio (razón, actor y
 * fecha) en la misma transacción, junto con el aviso al Estudiante (TI2-150),
 * que lleva solo la solicitud; nunca abre acompañamiento.
 */
export async function referRequest<RequestId extends string, UserId extends string>(
  deps: ReferRequestDeps<RequestId, UserId>,
  input: {
    readonly tokenIdentifier: string | null;
    readonly requestId: RequestId;
    readonly destinationUnit: string;
    readonly reason: string;
  },
): Promise<ApiResult<RequestEntity<RequestId, UserId>>> {
  const professional = await deps.professionals.findActiveProfessional(input.tokenIdentifier);
  if (professional === null) return denied();
  const row = await deps.requests.getRequest(input.requestId);
  if (row === null) return denied();
  if (!(await deps.requests.hasActiveTake(row._id, professional._id))) return denied();
  const result = transitionRequest({
    from: row.status,
    to: "referred",
    actorId: professional._id,
    occurredAt: deps.now(),
    reason: input.reason,
  });
  if (result.status === "rejected") {
    return result.cause === "reason_required"
      ? invalidRequestFields("Se requiere la razón de la derivación.")
      : stateConflict("La solicitud no admite la derivación en su estado actual.");
  }
  const destinationUnit = toDestinationUnit(input.destinationUnit);
  if (destinationUnit.status === "error") return destinationUnit;
  // La política ya exigió y recortó la razón de toda fila hacia `referred`.
  const reason = toReferralReason(result.change.reason ?? "");
  if (reason.status === "error") return reason;
  // El estado y su derivación van en la misma escritura, como el cierre y su razón.
  await deps.requests.setRequestStatus(
    row._id,
    toStatusChange(result.change, {
      destinationUnit: destinationUnit.data,
      referredAt: result.change.occurredAt,
      referredBy: professional._id,
      reason: reason.data,
    }),
  );
  await deps.requests.logRequestTransition({
    requestId: row._id,
    from: result.change.from,
    to: result.change.to,
    actorId: professional._id,
    reason: reason.data,
    occurredAt: result.change.occurredAt,
  });
  await notifyRequestChange(deps.notifications, row, result.change);
  return okResult(toEntity(row, result.change.to));
}
