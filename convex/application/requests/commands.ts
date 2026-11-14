import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import { toOpeningObjective, type Accompaniment } from "../../domain/accompaniments/accompaniment";
import {
  ACCESS_NEEDS_MAX_LENGTH,
  toCompleteSubmission,
  toInformationResponse,
  toRequestSubmission,
  type AccompanimentRequest,
  type RequestSubmission,
  type RequestSubmissionDraft,
  toAccessNeedsText,
  toAccompanimentRequest,
} from "../../domain/requests/request";
import {
  CONFLICT_ERROR_CODE,
  REQUEST_FIELDS_INVALID_ERROR_CODE,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import { transitionRequest } from "../../domain/requests/transition_policy";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { AUTHORIZATION_DENIED_MESSAGE } from "../authorization/authorize";
import {
  findAccompanimentByRequest,
  getAccompanimentById,
  insertAccompaniment,
  insertActiveAssignment,
} from "../../infrastructure/accompaniments/repository";
import {
  findActiveTake,
  getRequestById,
  insertActiveTake,
  insertReceivedRequest,
  insertReceivedRequestOnce,
  logRequestTransition,
  markRequestTaken,
  setRequestStatus,
} from "../../infrastructure/requests/repository";
import {
  findActiveProfessional,
  findActiveStudent,
  requireActiveProfessional,
  requireActiveStudent,
} from "./identity";
import { toStatusChange } from "./status_change";

/**
 * Casos de uso de escritura de solicitudes (TI2-9, TI2-85, TI2-141).
 *
 * Capa de Aplicación: recibe la identidad ya resuelta en el borde con
 * `ctx.auth.getUserIdentity()`, exige el rol con cuenta habilitada y
 * vigente, y persiste con Infraestructura. El envío completo de TI2-141
 * guarda la lista de necesidades de acceso como `accessNeedSelections` y el
 * repositorio deriva de ella el texto unido; la forma anterior guarda solo
 * ese texto. Opera con datos ficticios.
 */

/** Denegación de Sprint 1, que conservan sus operaciones y la forma anterior de `createRequest`. */
function deny(): never {
  throw new ConvexError(AUTHORIZATION_DENIED_MESSAGE);
}

/*
 * Las operaciones que publica TI2-141 (envío completo, respuesta, cancelación
 * y cierre) devuelven `ApiResult` y Presentación lo traduce con
 * `unwrapApiResult`, como espacios y atenciones: la denegación es
 * `unauthorized`, un campo inválido `request_fields_invalid` y un estado que
 * no admite el paso `conflict`. Las de Sprint 1 y la forma anterior de
 * `createRequest` conservan su `Error` y su denegación como texto hasta
 * TI2-181.
 */

function denied<T>(): ApiResult<T> {
  return errResult(unauthorizedError());
}

function invalidFields<T>(message: string): ApiResult<T> {
  return errResult({ code: REQUEST_FIELDS_INVALID_ERROR_CODE, message });
}

function stateConflict<T>(message: string): ApiResult<T> {
  return errResult({ code: CONFLICT_ERROR_CODE, message });
}

/** Solicitud pública con los identificadores de Convex, para los validadores de la API. */
type StoredRequest = AccompanimentRequest & {
  readonly _id: Id<"requests">;
  readonly studentId: Id<"users">;
};

/** Campos que solo existen en la forma completa. */
const FULL_FORM_FIELDS = [
  "needSummary",
  "expectedOutcome",
  "otherAccessNeed",
  "modalityPreference",
  "generalAvailability",
  "preferredAccessibleInformationChannel",
  "idempotencyKey",
] as const;

/** Forma anterior: `accessNeeds` como texto y ningún campo de la forma completa. */
function isLegacySubmission(
  input: RequestSubmissionDraft,
): input is RequestSubmissionDraft & { readonly accessNeeds: string } {
  return (
    typeof input.accessNeeds === "string" &&
    FULL_FORM_FIELDS.every((field) => input[field] === undefined)
  );
}

/**
 * Registra la solicitud del Estudiante en estado `received`. Solo el propio
 * Estudiante con cuenta vigente puede registrar; cualquier otro caso recibe
 * denegación genérica, sin motivo ni existencia del recurso.
 *
 * La forma anterior (solo `accessNeeds` como texto) valida el texto como
 * siempre, hasta `ACCESS_NEEDS_MAX_LENGTH`, no es idempotente porque no trae
 * clave y conserva su `Error` y su denegación como texto. Cualquier otra
 * entrada sigue la forma completa (TI2-141): autoriza antes de validar, exige
 * sus campos con `toCompleteSubmission`, los valida con `toRequestSubmission`
 * y se guarda con `insertReceivedRequestOnce`: un reintento con la misma
 * clave devuelve la solicitud ya creada sin escribir otra. Sus rechazos van
 * en el `ApiResult`.
 */
export async function registerRequest(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  input: RequestSubmissionDraft,
): Promise<ApiResult<StoredRequest>> {
  if (isLegacySubmission(input)) {
    const student = await requireActiveStudent(ctx, identity);
    const requestId = await registerLegacyRequest(ctx, student._id, input.accessNeeds);
    return okResult(await readRegistered(ctx, requestId));
  }
  const student = await findActiveStudent(ctx, identity?.tokenIdentifier ?? null);
  if (student === null) return denied();
  const complete = toCompleteSubmission(input);
  if (complete.status === "error") return complete;
  const submission = toRequestSubmission(complete.data);
  if (submission.status === "error") return submission;
  const requestId = await registerFullRequest(ctx, student._id, submission.data);
  return okResult(await readRegistered(ctx, requestId));
}

/** Solicitud recién registrada, leída de vuelta en la misma mutation. */
async function readRegistered(ctx: MutationCtx, requestId: Id<"requests">): Promise<StoredRequest> {
  const row = await getRequestById(ctx, requestId);
  if (row === null) throw new Error("La solicitud registrada no quedó guardada.");
  return toAccompanimentRequest({
    _id: row._id,
    studentId: row.studentId,
    status: row.status,
    accessNeeds: row.accessNeeds,
    createdAt: row.createdAt,
  });
}

/** Guarda el envío completo ya validado. */
async function registerFullRequest(
  ctx: MutationCtx,
  studentId: Id<"users">,
  submission: RequestSubmission,
): Promise<Id<"requests">> {
  const { accessNeeds, generalAvailability, ...content } = submission;
  const { requestId } = await insertReceivedRequestOnce(ctx, {
    ...content,
    // La lista del contrato se persiste como `accessNeedSelections` (TI2-135),
    // y el repositorio deriva de ella el texto unido. El esquema tipa los
    // arreglos como mutables; el dominio, de solo lectura.
    accessNeedSelections: [...accessNeeds],
    generalAvailability: {
      ...generalAvailability,
      preferredWeekdays: [...generalAvailability.preferredWeekdays],
    },
    studentId,
    provenance: { channel: "student", receivedAt: Date.now() },
  });
  return requestId;
}

async function registerLegacyRequest(
  ctx: MutationCtx,
  studentId: Id<"users">,
  raw: string,
): Promise<Id<"requests">> {
  const accessNeeds = toAccessNeedsText(raw);
  if (accessNeeds === null) {
    throw new Error("Se requiere describir la necesidad de acceso");
  }
  if (accessNeeds.length > ACCESS_NEEDS_MAX_LENGTH) {
    throw new Error(
      `La necesidad de acceso supera el máximo permitido (${ACCESS_NEEDS_MAX_LENGTH} caracteres)`,
    );
  }
  return await insertReceivedRequest(ctx, { studentId, accessNeeds });
}

/**
 * Pide información adicional al Estudiante: mueve la solicitud a
 * `awaiting_information_or_acceptance` aplicando la política de TI2-21. Solo
 * un Profesional con cuenta vigente; cualquier otro caso recibe denegación
 * genérica. Exige toma activa previa: sin relación explícita con la
 * solicitud no se opera. Si el estado actual no admite el paso o falta el
 * motivo, se rechaza sin modificar nada. Persiste el estado y el registro
 * del cambio (motivo, actor y fecha) en la misma transacción.
 */
export async function requestAdditionalInformation(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  input: { readonly requestId: Id<"requests">; readonly reason: string },
) {
  const professional = await requireActiveProfessional(ctx, identity);
  const row = await getRequestById(ctx, input.requestId);
  if (row === null) deny();
  const take = await findActiveTake(ctx, input.requestId, professional._id);
  if (take === null) deny();
  const result = transitionRequest({
    from: row.status,
    to: "awaiting_information_or_acceptance",
    actorId: professional._id,
    occurredAt: Date.now(),
    reason: input.reason,
  });
  if (result.status === "rejected") {
    if (result.cause === "reason_required") {
      throw new Error("Se requiere el motivo para pedir información adicional");
    }
    throw new Error("La solicitud no admite pedir información adicional en su estado actual");
  }
  await setRequestStatus(ctx, input.requestId, toStatusChange(result.change));
  await logRequestTransition(ctx, {
    requestId: input.requestId,
    from: result.change.from,
    to: result.change.to,
    actorId: professional._id,
    ...(result.change.reason === undefined ? {} : { reason: result.change.reason }),
    occurredAt: result.change.occurredAt,
  });
  return toAccompanimentRequest({
    _id: row._id,
    studentId: row.studentId,
    status: result.change.to,
    accessNeeds: row.accessNeeds,
    createdAt: row.createdAt,
  });
}

/**
 * Toma una solicitud recibida para revisión: crea la relación explícita
 * entre el Profesional y la solicitud, auditando quién y cuándo. Solo el
 * propio Profesional con cuenta vigente puede tomar para sí, solo en estado
 * `received` y sin otra toma activa; si no, se rechaza. Tomar inicia la
 * revisión (`received` → `under_review`) para que el flujo público no quede
 * bloqueado: `createRequest` siempre crea en `received` y ninguna otra
 * mutación pública avanza ese paso.
 */
export async function takeRequest(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  input: { readonly requestId: Id<"requests"> },
) {
  const professional = await requireActiveProfessional(ctx, identity);
  const row = await getRequestById(ctx, input.requestId);
  if (row === null) deny();
  if (row.status !== "received") {
    throw new Error("Solo se pueden tomar solicitudes recibidas");
  }
  const existing = await findActiveTake(ctx, input.requestId, professional._id);
  if (existing !== null) {
    throw new Error("Ya tomaste esta solicitud");
  }
  await insertActiveTake(ctx, {
    requestId: input.requestId,
    userId: professional._id,
    grantedBy: professional._id,
  });
  await markRequestTaken(ctx, input.requestId, professional._id);
  const result = transitionRequest({
    from: row.status,
    to: "under_review",
    actorId: professional._id,
    occurredAt: Date.now(),
  });
  if (result.status === "rejected") {
    throw new Error("La solicitud no admite iniciar la revisión en su estado actual");
  }
  await setRequestStatus(ctx, input.requestId, toStatusChange(result.change));
  await logRequestTransition(ctx, {
    requestId: input.requestId,
    from: result.change.from,
    to: result.change.to,
    actorId: professional._id,
    occurredAt: result.change.occurredAt,
  });
  return toAccompanimentRequest({
    _id: row._id,
    studentId: row.studentId,
    status: result.change.to,
    accessNeeds: row.accessNeeds,
    createdAt: row.createdAt,
  });
}

/**
 * Acepta la solicitud y abre exactamente un acompañamiento (TI2-24).
 *
 * Solo un Profesional con cuenta vigente y con toma activa sobre la
 * solicitud; cualquier otro caso recibe denegación genérica. La transición
 * válida es `under_review` o `awaiting_information_or_acceptance` hacia
 * `accepted` según la política de TI2-21; otro estado se rechaza sin
 * modificar nada. El objetivo lo aporta quien acepta y es obligatorio.
 *
 * Todo ocurre en la misma transacción: estado, bitácora (actor y fecha),
 * acompañamiento (estudiante, necesidades de acceso y vínculo a la solicitud
 * de origen) y asignación inicial del Profesional responsable. Repetir la
 * aceptación —incluso en concurrencia, que Convex ejecuta en serie— encuentra el
 * acompañamiento ya creado y se rechaza sin duplicar. La asignación inicial
 * la otorga el propio acto de aceptación; la regla de no auto-otorgarse de
 * TI2-28 rige las concesiones posteriores a terceros, no la apertura.
 */
export async function acceptRequest(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  input: { readonly requestId: Id<"requests">; readonly objective: string },
): Promise<Accompaniment<Id<"accompaniments">, Id<"users">>> {
  const professional = await requireActiveProfessional(ctx, identity);
  const row = await getRequestById(ctx, input.requestId);
  if (row === null) deny();
  const take = await findActiveTake(ctx, input.requestId, professional._id);
  if (take === null) deny();
  const existing = await findAccompanimentByRequest(ctx, input.requestId);
  if (existing !== null) {
    throw new Error("La solicitud ya fue aceptada");
  }
  const result = transitionRequest({
    from: row.status,
    to: "accepted",
    actorId: professional._id,
    occurredAt: Date.now(),
  });
  if (result.status === "rejected") {
    throw new Error("La solicitud no admite la aceptación en su estado actual");
  }
  const objective = toOpeningObjective(input.objective);
  if (objective === null) {
    throw new Error("Se requiere el objetivo para abrir el acompañamiento");
  }
  await setRequestStatus(ctx, input.requestId, toStatusChange(result.change));
  await logRequestTransition(ctx, {
    requestId: input.requestId,
    from: result.change.from,
    to: result.change.to,
    actorId: professional._id,
    occurredAt: result.change.occurredAt,
  });
  const accompanimentId = await insertAccompaniment(ctx, {
    studentId: row.studentId,
    objective,
    accessNeeds: row.accessNeeds,
    requestId: input.requestId,
  });
  await insertActiveAssignment(
    ctx,
    {
      accompanimentId,
      userId: professional._id,
      assignedRole: "professional",
    },
    professional._id,
  );
  const opened = await getAccompanimentById(ctx, accompanimentId);
  if (opened === null) deny();
  return {
    _id: opened._id,
    studentId: opened.studentId,
    status: opened.status,
    objective: opened.objective,
    accessNeeds: opened.accessNeeds,
    view: "full" as const,
  };
}

/**
 * Cancela la solicitud propia del Estudiante (TI2-85): mueve `received`,
 * `under_review` o `awaiting_information_or_acceptance` a `cancelled`
 * aplicando la política de TI2-21. Solo el propio Estudiante con cuenta
 * vigente; una solicitud ajena o inexistente recibe la misma denegación
 * genérica, así no se revela que existe. El motivo es obligatorio. Si el
 * estado no admite el paso, incluida una solicitud ya cancelada, se rechaza
 * sin modificar nada. Persiste el estado y el registro del cambio (motivo,
 * actor y fecha) en la misma transacción y nunca abre acompañamiento.
 */
export async function cancelRequest(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  input: { readonly requestId: Id<"requests">; readonly reason: string },
): Promise<ApiResult<StoredRequest>> {
  const student = await findActiveStudent(ctx, identity?.tokenIdentifier ?? null);
  if (student === null) return denied();
  const row = await getRequestById(ctx, input.requestId);
  if (row === null || row.studentId !== student._id) return denied();
  const result = transitionRequest({
    from: row.status,
    to: "cancelled",
    actorId: student._id,
    occurredAt: Date.now(),
    reason: input.reason,
  });
  if (result.status === "rejected") {
    return result.cause === "reason_required"
      ? invalidFields("Se requiere el motivo para cancelar la solicitud.")
      : stateConflict("La solicitud no admite la cancelación en su estado actual.");
  }
  await setRequestStatus(ctx, input.requestId, toStatusChange(result.change));
  await logRequestTransition(ctx, {
    requestId: input.requestId,
    from: result.change.from,
    to: result.change.to,
    actorId: student._id,
    ...(result.change.reason === undefined ? {} : { reason: result.change.reason }),
    occurredAt: result.change.occurredAt,
  });
  return okResult(
    toAccompanimentRequest({
      _id: row._id,
      studentId: row.studentId,
      status: result.change.to,
      accessNeeds: row.accessNeeds,
      createdAt: row.createdAt,
    }),
  );
}

/**
 * Cierra la solicitud sin abrir acompañamiento (TI2-85): mueve
 * `under_review` o `awaiting_information_or_acceptance` a
 * `closed_without_accompaniment` aplicando la política de TI2-21. Solo un
 * Profesional con cuenta vigente y toma activa sobre la solicitud; cualquier
 * otro caso recibe denegación genérica. El motivo es la razón comprensible
 * que pide la especificación y es obligatorio. Si el estado no admite el
 * paso, incluida una solicitud aceptada o ya cerrada, se rechaza sin
 * modificar nada. Persiste el estado, la razón vigente (`closureReason`) y
 * el registro del cambio en la misma transacción; la toma queda tal cual,
 * como rastro de quién revisó.
 */
export async function closeRequestWithoutAccompaniment(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  input: { readonly requestId: Id<"requests">; readonly reason: string },
): Promise<ApiResult<StoredRequest>> {
  const professional = await findActiveProfessional(ctx, identity?.tokenIdentifier ?? null);
  if (professional === null) return denied();
  const row = await getRequestById(ctx, input.requestId);
  if (row === null) return denied();
  const take = await findActiveTake(ctx, input.requestId, professional._id);
  if (take === null) return denied();
  const result = transitionRequest({
    from: row.status,
    to: "closed_without_accompaniment",
    actorId: professional._id,
    occurredAt: Date.now(),
    reason: input.reason,
  });
  if (result.status === "rejected") {
    return result.cause === "reason_required"
      ? invalidFields("Se requiere el motivo para cerrar la solicitud sin acompañamiento.")
      : stateConflict("La solicitud no admite el cierre sin acompañamiento en su estado actual.");
  }
  await setRequestStatus(ctx, input.requestId, toStatusChange(result.change));
  await logRequestTransition(ctx, {
    requestId: input.requestId,
    from: result.change.from,
    to: result.change.to,
    actorId: professional._id,
    ...(result.change.reason === undefined ? {} : { reason: result.change.reason }),
    occurredAt: result.change.occurredAt,
  });
  return okResult(
    toAccompanimentRequest({
      _id: row._id,
      studentId: row.studentId,
      status: result.change.to,
      accessNeeds: row.accessNeeds,
      createdAt: row.createdAt,
    }),
  );
}

/**
 * Responde a la información que pidió el Profesional (TI2-141): devuelve la
 * solicitud de `awaiting_information_or_acceptance` a `under_review` para
 * que quien la tomó la retome. Solo el Estudiante dueño con cuenta vigente;
 * una solicitud ajena o inexistente recibe la misma denegación genérica. La
 * respuesta es obligatoria, tiene tope y queda como motivo del cambio en el
 * historial, junto al actor y la fecha, en la misma transacción. Fuera de la
 * espera se rechaza sin modificar nada y nunca abre acompañamiento.
 */
export async function respondToInformationRequest(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  input: { readonly requestId: Id<"requests">; readonly response: string },
): Promise<ApiResult<StoredRequest>> {
  const student = await findActiveStudent(ctx, identity?.tokenIdentifier ?? null);
  if (student === null) return denied();
  const row = await getRequestById(ctx, input.requestId);
  if (row === null || row.studentId !== student._id) return denied();
  // Solo la espera admite respuesta: `received -> under_review` existe en la
  // tabla, pero es la toma del Profesional, no un paso del Estudiante.
  if (row.status !== "awaiting_information_or_acceptance") {
    return stateConflict("La solicitud no admite una respuesta en su estado actual.");
  }
  const response = toInformationResponse(input.response);
  if (response.status === "error") return response;
  const result = transitionRequest({
    from: row.status,
    to: "under_review",
    actorId: student._id,
    occurredAt: Date.now(),
    reason: response.data,
  });
  if (result.status === "rejected") {
    return stateConflict("La solicitud no admite una respuesta en su estado actual.");
  }
  await setRequestStatus(ctx, input.requestId, toStatusChange(result.change));
  await logRequestTransition(ctx, {
    requestId: input.requestId,
    from: result.change.from,
    to: result.change.to,
    actorId: student._id,
    reason: response.data,
    occurredAt: result.change.occurredAt,
  });
  return okResult(
    toAccompanimentRequest({
      _id: row._id,
      studentId: row.studentId,
      status: result.change.to,
      accessNeeds: row.accessNeeds,
      createdAt: row.createdAt,
    }),
  );
}
