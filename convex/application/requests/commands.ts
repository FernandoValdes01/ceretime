import {
  toFullAccompaniment,
  toOpeningObjective,
  type Accompaniment,
} from "../../domain/accompaniments/accompaniment";
import {
  invalidRequestFields,
  toCompleteSubmission,
  toLegacyAccessNeeds,
  toRequestSubmission,
  type RequestSubmissionDraft,
} from "../../domain/requests/request";
import { okResult, type ApiResult } from "../../domain/errors/api_error";
import { referralAllowsAccompaniment } from "../../domain/requests/referral";
import { transitionRequest } from "../../domain/requests/transition_policy";
import type {
  AccompanimentOpener,
  ActiveProfessionalReader,
  ActiveStudentReader,
  RequestReader,
  RequestRegistrar,
  RequestStatusWriter,
  RequestTakeReader,
  RequestTakeRecorder,
  RequestTransitionRecorder,
} from "./ports";
import type { NotificationEventRecorder } from "../notifications/ports";
import { notifyRequestChange, notifyRequestReceived } from "./notifications";
import { denied, stateConflict, toEntity, type RequestEntity } from "./results";
import { toStatusChange } from "./status_change";

/**
 * Casos de uso de escritura de solicitudes (TI2-9, TI2-85, TI2-141, TI2-181).
 *
 * Capa de Aplicación: cada operación recibe sus dependencias como puertos de
 * `ports.ts` y no conoce Convex ni repositorios concretos. Presentación
 * compone los adaptadores de Infraestructura con el `ctx` de la mutation, así
 * cada operación sigue siendo una sola transacción. El perfil sale de la
 * sesión del servidor, nunca de un identificador del cliente.
 *
 * Todas devuelven `ApiResult` y Presentación lo traduce con
 * `unwrapApiResult`: la denegación es `unauthorized`, un campo inválido
 * `request_fields_invalid` (o `access_needs_*` en las necesidades de acceso)
 * y un estado que no admite el paso `conflict`.
 *
 * Cada registro y cada cambio de estado deja sus avisos (TI2-150) por el
 * puerto `notifications`, en la misma transacción y después de persistir. El
 * aviso lleva solo la solicitud y el destinatario: nunca el motivo, la
 * respuesta ni las necesidades. Opera con datos ficticios.
 */

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

/** Capacidades que necesita el registro; la composición entrega los adaptadores. */
export interface RegisterRequestDeps<RequestId extends string, UserId extends string> {
  readonly students: ActiveStudentReader<UserId>;
  readonly requests: RequestReader<RequestId, UserId> & RequestRegistrar<RequestId, UserId>;
  readonly notifications: NotificationEventRecorder;
  /** Reloj del servidor para la procedencia del envío; las pruebas lo fijan. */
  readonly now: () => number;
}

/**
 * Registra la solicitud del Estudiante en estado `received`. Solo el propio
 * Estudiante con cuenta vigente puede registrar; cualquier otra persona recibe
 * `unauthorized`, sin motivo ni existencia del recurso, aunque los campos
 * también fallen.
 *
 * La forma anterior (solo `accessNeeds` como texto) valida el texto con
 * `toLegacyAccessNeeds` de Dominio, con los códigos `access_needs_*`
 * (TI2-181), y no es idempotente porque no trae clave. Cualquier otra entrada
 * sigue la forma completa de TI2-141: exige sus campos con
 * `toCompleteSubmission`, los valida con `toRequestSubmission` y se guarda una
 * sola vez por clave: un reintento con la misma clave devuelve la solicitud
 * ya creada sin escribir otra.
 */
export async function registerRequest<RequestId extends string, UserId extends string>(
  deps: RegisterRequestDeps<RequestId, UserId>,
  input: { readonly tokenIdentifier: string | null; readonly submission: RequestSubmissionDraft },
): Promise<ApiResult<RequestEntity<RequestId, UserId>>> {
  const student = await deps.students.findActiveStudent(input.tokenIdentifier);
  if (student === null) return denied();
  const draft = input.submission;
  if (isLegacySubmission(draft)) {
    const accessNeeds = toLegacyAccessNeeds(draft.accessNeeds);
    if (accessNeeds.status === "error") return accessNeeds;
    const requestId = await deps.requests.registerLegacy(student._id, accessNeeds.data);
    return okResult(await readRegistered(deps, requestId));
  }
  const complete = toCompleteSubmission(draft);
  if (complete.status === "error") return complete;
  const submission = toRequestSubmission(complete.data);
  if (submission.status === "error") return submission;
  const requestId = await deps.requests.registerOnce(student._id, submission.data, deps.now());
  return okResult(await readRegistered(deps, requestId));
}

/**
 * Solicitud recién registrada, leída de vuelta en la misma mutation, con su
 * aviso de recepción. Un reintento con la misma clave lee la misma fila y su
 * aviso ya registrado no se duplica.
 */
async function readRegistered<RequestId extends string, UserId extends string>(
  deps: RegisterRequestDeps<RequestId, UserId>,
  requestId: RequestId,
): Promise<RequestEntity<RequestId, UserId>> {
  const row = await deps.requests.getRequest(requestId);
  if (row === null) throw new Error("La solicitud registrada no quedó guardada.");
  await notifyRequestReceived(deps.notifications, row);
  return toEntity(row);
}

/** Capacidades que necesita pedir información; la composición entrega los adaptadores. */
export interface RequestAdditionalInformationDeps<RequestId extends string, UserId extends string> {
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
  await notifyRequestChange(deps.notifications, row, result.change);
  return okResult(toEntity(row, result.change.to));
}

/** Capacidades que necesita la toma; la composición entrega los adaptadores. */
export interface TakeRequestDeps<RequestId extends string, UserId extends string> {
  readonly professionals: ActiveProfessionalReader<UserId>;
  readonly requests: RequestReader<RequestId, UserId> &
    RequestTakeReader<RequestId, UserId> &
    RequestTakeRecorder<RequestId, UserId> &
    RequestStatusWriter<RequestId, UserId> &
    RequestTransitionRecorder<RequestId, UserId>;
  readonly notifications: NotificationEventRecorder;
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
 * `unauthorized`, como pide TI2-181 (hallazgo 4 de TI4-83): revela a un
 * Profesional vigente solo que la solicitud existe, algo que pudo ver en la
 * bandeja mientras estaba recibida, y nunca su contenido.
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
  await notifyRequestChange(deps.notifications, row, result.change);
  return okResult(toEntity(row, result.change.to));
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
    RequestStatusWriter<RequestId, UserId> &
    RequestTransitionRecorder<RequestId, UserId>;
  readonly accompaniments: AccompanimentOpener<RequestId, UserId, AccompanimentId>;
  readonly notifications: NotificationEventRecorder;
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
 * `request_fields_invalid` (TI2-181). Una derivación de entrada sin contacto
 * o sin aceptación del estudiante responde `conflict` (TI2-143). Ningún
 * rechazo modifica nada.
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
): Promise<ApiResult<Accompaniment<AccompanimentId, UserId, RequestId>>> {
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
  // Una derivación de entrada no abre acompañamiento sin contacto y aceptación (TI2-143).
  if (!referralAllowsAccompaniment(row.incomingReferral)) {
    return stateConflict(
      "La derivación necesita el contacto con el estudiante y su aceptación antes de abrir el acompañamiento",
    );
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
  await notifyRequestChange(deps.notifications, row, result.change);
  const opened = await deps.accompaniments.openAccompaniment({
    requestId: row._id,
    studentId: row.studentId,
    objective,
    accessNeeds: row.accessNeeds,
    professionalId: professional._id,
  });
  // Quien acepta queda asignado como Profesional responsable: recibe la vista completa.
  return okResult(toFullAccompaniment(opened));
}

/** Capacidades que necesita la cancelación; la composición entrega los adaptadores. */
export interface CancelRequestDeps<RequestId extends string, UserId extends string> {
  readonly students: ActiveStudentReader<UserId>;
  readonly requests: RequestReader<RequestId, UserId> &
    RequestStatusWriter<RequestId, UserId> &
    RequestTransitionRecorder<RequestId, UserId>;
  readonly notifications: NotificationEventRecorder;
  /** Reloj del servidor para el registro del cambio; las pruebas lo fijan. */
  readonly now: () => number;
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
export async function cancelRequest<RequestId extends string, UserId extends string>(
  deps: CancelRequestDeps<RequestId, UserId>,
  input: {
    readonly tokenIdentifier: string | null;
    readonly requestId: RequestId;
    readonly reason: string;
  },
): Promise<ApiResult<RequestEntity<RequestId, UserId>>> {
  const student = await deps.students.findActiveStudent(input.tokenIdentifier);
  if (student === null) return denied();
  const row = await deps.requests.getRequest(input.requestId);
  if (row === null || row.studentId !== student._id) return denied();
  const result = transitionRequest({
    from: row.status,
    to: "cancelled",
    actorId: student._id,
    occurredAt: deps.now(),
    reason: input.reason,
  });
  if (result.status === "rejected") {
    return result.cause === "reason_required"
      ? invalidRequestFields("Se requiere el motivo para cancelar la solicitud.")
      : stateConflict("La solicitud no admite la cancelación en su estado actual.");
  }
  await deps.requests.setRequestStatus(row._id, toStatusChange(result.change));
  await deps.requests.logRequestTransition({
    requestId: row._id,
    from: result.change.from,
    to: result.change.to,
    actorId: student._id,
    ...(result.change.reason === undefined ? {} : { reason: result.change.reason }),
    occurredAt: result.change.occurredAt,
  });
  await notifyRequestChange(deps.notifications, row, result.change);
  return okResult(toEntity(row, result.change.to));
}

/** Capacidades que necesita el cierre; la composición entrega los adaptadores. */
export interface CloseRequestDeps<RequestId extends string, UserId extends string> {
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
 * Cierra la solicitud sin abrir acompañamiento (TI2-85): mueve
 * `under_review` o `awaiting_information_or_acceptance` a
 * `closed_without_accompaniment` aplicando la política de TI2-21. Solo un
 * Profesional con cuenta vigente y toma activa sobre la solicitud; cualquier
 * otra persona recibe denegación genérica. El motivo es la razón comprensible
 * que pide la especificación y es obligatorio. Si el estado no admite el
 * paso, incluida una solicitud aceptada o ya cerrada, se rechaza sin
 * modificar nada. Persiste el estado, la razón vigente (`closureReason`) y
 * el registro del cambio en la misma transacción; la toma queda tal cual,
 * como rastro de quién revisó.
 */
export async function closeRequestWithoutAccompaniment<
  RequestId extends string,
  UserId extends string,
>(
  deps: CloseRequestDeps<RequestId, UserId>,
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
    to: "closed_without_accompaniment",
    actorId: professional._id,
    occurredAt: deps.now(),
    reason: input.reason,
  });
  if (result.status === "rejected") {
    return result.cause === "reason_required"
      ? invalidRequestFields("Se requiere el motivo para cerrar la solicitud sin acompañamiento.")
      : stateConflict("La solicitud no admite el cierre sin acompañamiento en su estado actual.");
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
  await notifyRequestChange(deps.notifications, row, result.change);
  return okResult(toEntity(row, result.change.to));
}
