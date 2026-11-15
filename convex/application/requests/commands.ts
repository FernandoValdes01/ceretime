import type { UserIdentity } from "convex/server";
import { toOpeningObjective, type Accompaniment } from "../../domain/accompaniments/accompaniment";
import {
  ACCESS_NEEDS_MAX_LENGTH,
  invalidRequestFields,
  toCompleteSubmission,
  toRequestSubmission,
  type AccompanimentRequest,
  type RequestSubmission,
  type RequestSubmissionDraft,
  toAccessNeedsText,
  toAccompanimentRequest,
} from "../../domain/requests/request";
import { okResult, type ApiResult } from "../../domain/errors/api_error";
import { transitionRequest } from "../../domain/requests/transition_policy";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import {
  findActiveTake,
  getRequestById,
  insertReceivedRequest,
  insertReceivedRequestOnce,
  logRequestTransition,
  setRequestStatus,
} from "../../infrastructure/requests/repository";
import { findActiveProfessional, findActiveStudent, requireActiveStudent } from "./identity";
import type {
  AccompanimentOpener,
  ActiveProfessionalReader,
  RequestReader,
  RequestStatusWriter,
  RequestTakeReader,
  RequestTakeRecorder,
  RequestTransitionRecorder,
} from "./ports";
import { denied, stateConflict } from "./results";
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

/*
 * Las operaciones que publica TI2-141 (envío completo, cancelación y cierre
 * aquí; la respuesta, en `respond.ts`) devuelven `ApiResult` y Presentación lo
 * traduce con `unwrapApiResult`, como espacios y atenciones: la denegación es
 * `unauthorized`, un campo inválido `request_fields_invalid` y un estado que
 * no admite el paso `conflict`. Las de Sprint 1 y la forma anterior de
 * `createRequest` todavía lanzan su `Error` y su denegación como texto. Este
 * archivo sigue ligado al contexto de Convex y a repositorios concretos; la
 * respuesta ya recibe puertos y el resto pasa en TI2-181.
 */

/** Solicitud pública con los identificadores que instancia Presentación. */
type RequestEntity<RequestId extends string, UserId extends string> = AccompanimentRequest & {
  readonly _id: RequestId;
  readonly studentId: UserId;
};

/** Solicitud pública con los identificadores de Convex, para los validadores de la API. */
type StoredRequest = RequestEntity<Id<"requests">, Id<"users">>;

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
 * El `ApiResult` solo trae `error` en la forma completa (TI2-141). La forma
 * anterior (solo `accessNeeds` como texto) todavía lanza hasta TI2-181:
 * deniega con `ConvexError("No autorizado")` y rechaza el texto con `Error`.
 * Valida el texto como siempre, hasta `ACCESS_NEEDS_MAX_LENGTH`, y no es
 * idempotente porque no trae clave. Cualquier otra entrada sigue la forma
 * completa: autoriza antes de validar, exige sus campos con
 * `toCompleteSubmission`, los valida con `toRequestSubmission` y se guarda con
 * `insertReceivedRequestOnce`: un reintento con la misma clave devuelve la
 * solicitud ya creada sin escribir otra.
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

/** Capacidades que necesita pedir información; la composición entrega los adaptadores. */
export interface RequestAdditionalInformationDeps<RequestId extends string, UserId extends string> {
  readonly professionals: ActiveProfessionalReader<UserId>;
  readonly requests: RequestReader<RequestId, UserId> &
    RequestTakeReader<RequestId, UserId> &
    RequestStatusWriter<RequestId> &
    RequestTransitionRecorder<RequestId, UserId>;
  /** Reloj del servidor para el registro del cambio; las pruebas lo fijan. */
  readonly now: () => number;
}

/**
 * Pide información adicional al Estudiante: mueve la solicitud a
 * `awaiting_information_or_acceptance` aplicando la política de TI2-21. Solo
 * un Profesional con cuenta vigente y toma activa previa: sin relación
 * explícita con la solicitud no se opera, y cualquier otra persona o una
 * solicitud inexistente recibe `unauthorized`. Sin motivo responde
 * `request_fields_invalid`, y un estado que no admite el paso `conflict`
 * (TI2-181), sin modificar nada. Persiste el estado y el registro del cambio
 * (motivo, actor y fecha) en la misma transacción.
 */
export async function requestAdditionalInformation<RequestId extends string, UserId extends string>(
  deps: RequestAdditionalInformationDeps<RequestId, UserId>,
  input: {
    readonly tokenIdentifier: string | null;
    readonly requestId: RequestId;
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
    to: "awaiting_information_or_acceptance",
    actorId: professional._id,
    occurredAt: deps.now(),
    reason: input.reason,
  });
  if (result.status === "rejected") {
    return result.cause === "reason_required"
      ? invalidRequestFields("Se requiere el motivo para pedir información adicional")
      : stateConflict("La solicitud no admite pedir información adicional en su estado actual");
  }
  await deps.requests.setRequestStatus(row._id, toStatusChange(result.change));
  await deps.requests.logRequestTransition({
    requestId: row._id,
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

/** Capacidades que necesita la toma; la composición entrega los adaptadores. */
export interface TakeRequestDeps<RequestId extends string, UserId extends string> {
  readonly professionals: ActiveProfessionalReader<UserId>;
  readonly requests: RequestReader<RequestId, UserId> &
    RequestTakeReader<RequestId, UserId> &
    RequestTakeRecorder<RequestId, UserId> &
    RequestStatusWriter<RequestId> &
    RequestTransitionRecorder<RequestId, UserId>;
  /** Reloj del servidor para el registro del cambio; las pruebas lo fijan. */
  readonly now: () => number;
}

/**
 * Toma una solicitud recibida para revisión: crea la relación explícita
 * entre el Profesional y la solicitud, auditando quién y cuándo. Solo el
 * propio Profesional con cuenta vigente puede tomar para sí; cualquier otra
 * persona, o una solicitud inexistente, recibe `unauthorized`. Una solicitud que
 * ya no está recibida, o que ya tomó, responde `conflict` (TI2-181) sin
 * escribir nada. Tomar inicia la revisión (`received` → `under_review`) para
 * que el flujo público no quede bloqueado: `createRequest` siempre crea en
 * `received` y ninguna otra mutación pública avanza ese paso.
 *
 * Una solicitud que existe y no está recibida responde `conflict` y no
 * `unauthorized`: la bandeja ya muestra las recibidas a todo Profesional
 * vigente, así que el código no revela más que ella.
 */
export async function takeRequest<RequestId extends string, UserId extends string>(
  deps: TakeRequestDeps<RequestId, UserId>,
  input: { readonly tokenIdentifier: string | null; readonly requestId: RequestId },
): Promise<ApiResult<RequestEntity<RequestId, UserId>>> {
  const professional = await deps.professionals.findActiveProfessional(input.tokenIdentifier);
  if (professional === null) return denied();
  const row = await deps.requests.getRequest(input.requestId);
  if (row === null) return denied();
  if (row.status !== "received") {
    return stateConflict("Solo se pueden tomar solicitudes recibidas");
  }
  if (await deps.requests.hasActiveTake(row._id, professional._id)) {
    return stateConflict("Ya tomaste esta solicitud");
  }
  const result = transitionRequest({
    from: row.status,
    to: "under_review",
    actorId: professional._id,
    occurredAt: deps.now(),
  });
  if (result.status === "rejected") {
    return stateConflict("La solicitud no admite iniciar la revisión en su estado actual");
  }
  await deps.requests.recordTake(row._id, professional._id);
  await deps.requests.setRequestStatus(row._id, toStatusChange(result.change));
  await deps.requests.logRequestTransition({
    requestId: row._id,
    from: result.change.from,
    to: result.change.to,
    actorId: professional._id,
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

/** Capacidades que necesita la aceptación; la composición entrega los adaptadores. */
export interface AcceptRequestDeps<
  RequestId extends string,
  UserId extends string,
  AccompanimentId extends string,
> {
  readonly professionals: ActiveProfessionalReader<UserId>;
  readonly requests: RequestReader<RequestId, UserId> &
    RequestTakeReader<RequestId, UserId> &
    RequestStatusWriter<RequestId> &
    RequestTransitionRecorder<RequestId, UserId>;
  readonly accompaniments: AccompanimentOpener<RequestId, UserId, AccompanimentId>;
  /** Reloj del servidor para el registro del cambio; las pruebas lo fijan. */
  readonly now: () => number;
}

/**
 * Acepta la solicitud y abre exactamente un acompañamiento (TI2-24).
 *
 * Solo un Profesional con cuenta vigente y con toma activa sobre la
 * solicitud; cualquier otra persona o una solicitud inexistente recibe
 * `unauthorized`. La transición válida es `under_review` o
 * `awaiting_information_or_acceptance` hacia `accepted` según la política de
 * TI2-21; otro estado, o una solicitud ya aceptada, responde `conflict`. El
 * objetivo lo aporta quien acepta y es obligatorio: sin él responde
 * `request_fields_invalid` (TI2-181). Ningún rechazo modifica nada.
 *
 * Todo ocurre en la misma transacción: estado, bitácora (actor y fecha),
 * acompañamiento (estudiante, necesidades de acceso y vínculo a la solicitud
 * de origen) y asignación inicial del Profesional responsable. Repetir la
 * aceptación —incluso en concurrencia, que Convex ejecuta en serie— encuentra el
 * acompañamiento ya creado y se rechaza sin duplicar. La asignación inicial
 * la otorga el propio acto de aceptación; la regla de no auto-otorgarse de
 * TI2-28 rige las concesiones posteriores a terceros, no la apertura.
 */
export async function acceptRequest<
  RequestId extends string,
  UserId extends string,
  AccompanimentId extends string,
>(
  deps: AcceptRequestDeps<RequestId, UserId, AccompanimentId>,
  input: {
    readonly tokenIdentifier: string | null;
    readonly requestId: RequestId;
    readonly objective: string;
  },
): Promise<ApiResult<Accompaniment<AccompanimentId, UserId>>> {
  const professional = await deps.professionals.findActiveProfessional(input.tokenIdentifier);
  if (professional === null) return denied();
  const row = await deps.requests.getRequest(input.requestId);
  if (row === null) return denied();
  if (!(await deps.requests.hasActiveTake(row._id, professional._id))) return denied();
  if (await deps.accompaniments.hasAccompanimentForRequest(row._id)) {
    return stateConflict("La solicitud ya fue aceptada");
  }
  const result = transitionRequest({
    from: row.status,
    to: "accepted",
    actorId: professional._id,
    occurredAt: deps.now(),
  });
  if (result.status === "rejected") {
    return stateConflict("La solicitud no admite la aceptación en su estado actual");
  }
  const objective = toOpeningObjective(input.objective);
  if (objective === null) {
    return invalidRequestFields("Se requiere el objetivo para abrir el acompañamiento");
  }
  await deps.requests.setRequestStatus(row._id, toStatusChange(result.change));
  await deps.requests.logRequestTransition({
    requestId: row._id,
    from: result.change.from,
    to: result.change.to,
    actorId: professional._id,
    occurredAt: result.change.occurredAt,
  });
  return okResult(
    await deps.accompaniments.openAccompaniment({
      requestId: row._id,
      studentId: row.studentId,
      objective,
      accessNeeds: row.accessNeeds,
      professionalId: professional._id,
    }),
  );
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
      ? invalidRequestFields("Se requiere el motivo para cancelar la solicitud.")
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
      ? invalidRequestFields("Se requiere el motivo para cerrar la solicitud sin acompañamiento.")
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
