import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import { toOpeningObjective, type Accompaniment } from "../../domain/accompaniments/accompaniment";
import {
  ACCESS_NEEDS_MAX_LENGTH,
  REQUEST_RESPONSE_MAX_LENGTH,
  toRequestSubmission,
  type AccessNeed,
  type RequestSubmission,
  toAccessNeedsText,
  toAccompanimentRequest,
} from "../../domain/requests/request";
import {
  CONFLICT_ERROR_CODE,
  REQUEST_FIELDS_INVALID_ERROR_CODE,
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
  closeRequestWithReason,
  findActiveTake,
  getRequestById,
  insertActiveTake,
  insertReceivedRequest,
  insertReceivedRequestOnce,
  logRequestTransition,
  markRequestTaken,
  setRequestStatus,
} from "../../infrastructure/requests/repository";
import { requireActiveProfessional, requireActiveStudent } from "./identity";

/**
 * Casos de uso de escritura de solicitudes (TI2-9, TI2-85, TI2-141).
 *
 * Capa de Aplicación: recibe la identidad ya resuelta en el borde con
 * `ctx.auth.getUserIdentity()`, exige el rol con cuenta habilitada y
 * vigente, y persiste con Infraestructura. Convertir el contenido
 * estructurado a la forma persistida es alcance de TI2-23: aquí solo se
 * guarda el texto de necesidades de acceso. Opera con datos ficticios.
 */

function deny(): never {
  throw new ConvexError(AUTHORIZATION_DENIED_MESSAGE);
}

/*
 * Rechazos de las operaciones que publica TI2-141 (envío completo, respuesta,
 * cancelación y cierre). Van como `ConvexError({code, message})` del contrato
 * común de TI2-88: un `Error` común llega a producción solo como «Server
 * Error», sin el mensaje. Las operaciones de Sprint 1 y la forma anterior de
 * `createRequest` conservan su `Error` documentado para no cambiarles el
 * contrato a sus consumidores.
 */

/** Un campo de la solicitud no cumple: el mensaje dice qué corregir. */
function rejectFields(message: string): never {
  throw new ConvexError({ code: REQUEST_FIELDS_INVALID_ERROR_CODE, message });
}

/** El estado actual no admite el paso pedido. */
function rejectState(message: string): never {
  throw new ConvexError({ code: CONFLICT_ERROR_CODE, message });
}

/**
 * Envío de una solicitud tal como lo recibe el borde. En la forma completa de
 * TI2-141, `accessNeeds` es la lista de necesidades de `AccompanimentRequestContent`;
 * en la forma anterior es el texto unido y no viaja ningún otro campo. La
 * forma anterior se conserva mientras Web y Mobile migran.
 */
export type RegisterRequestInput = {
  readonly accessNeeds?: string | readonly AccessNeed[];
} & Partial<Omit<RequestSubmission, "accessNeeds">>;

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

/** La forma completa con todos sus campos obligatorios, o el error que indica qué falta. */
function toFullSubmission(input: RegisterRequestInput): RequestSubmission {
  const {
    needSummary,
    expectedOutcome,
    accessNeeds,
    otherAccessNeed,
    modalityPreference,
    generalAvailability,
    preferredAccessibleInformationChannel,
    idempotencyKey,
  } = input;
  if (
    needSummary === undefined ||
    expectedOutcome === undefined ||
    accessNeeds === undefined ||
    typeof accessNeeds === "string" ||
    modalityPreference === undefined ||
    generalAvailability === undefined ||
    preferredAccessibleInformationChannel === undefined ||
    idempotencyKey === undefined
  ) {
    rejectFields("Faltan datos de la solicitud");
  }
  return {
    needSummary,
    expectedOutcome,
    accessNeeds,
    ...(otherAccessNeed === undefined ? {} : { otherAccessNeed }),
    modalityPreference,
    generalAvailability,
    preferredAccessibleInformationChannel,
    idempotencyKey,
  };
}

/**
 * Registra la solicitud del Estudiante en estado `received`. Solo el propio
 * Estudiante con cuenta vigente puede registrar; cualquier otro caso recibe
 * denegación genérica, sin motivo ni existencia del recurso.
 *
 * La forma completa (TI2-141) se valida con `toRequestSubmission` y se
 * guarda con `insertReceivedRequestOnce`: un reintento con la misma clave
 * devuelve la solicitud ya creada sin escribir otra. La forma anterior valida
 * el texto como siempre, hasta `ACCESS_NEEDS_MAX_LENGTH`, y no es idempotente
 * porque no trae clave. El rechazo por forma es un error operativo que indica
 * qué corregir, no una denegación.
 */
export async function registerRequest(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  input: RegisterRequestInput,
) {
  const student = await requireActiveStudent(ctx, identity);
  const { accessNeeds } = input;
  const requestId =
    typeof accessNeeds === "string"
      ? await registerLegacyRequest(ctx, student._id, accessNeeds, input)
      : await registerFullRequest(ctx, student._id, toFullSubmission(input));
  const row = await getRequestById(ctx, requestId);
  if (row === null) deny();
  return toAccompanimentRequest({
    _id: row._id,
    studentId: row.studentId,
    status: row.status,
    accessNeeds: row.accessNeeds,
    createdAt: row.createdAt,
  });
}

async function registerFullRequest(
  ctx: MutationCtx,
  studentId: Id<"users">,
  input: RequestSubmission,
): Promise<Id<"requests">> {
  const submission = toRequestSubmission(input);
  if (submission.status === "error") rejectFields(submission.error.message);
  const { accessNeeds, generalAvailability, ...content } = submission.data;
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
  input: RegisterRequestInput,
): Promise<Id<"requests">> {
  // Con el texto unido no viajan los campos de la forma completa: juntar las dos
  // guardaría una solicitud a medias.
  if (FULL_FORM_FIELDS.some((field) => input[field] !== undefined)) {
    rejectFields(
      "Envía las necesidades de acceso como lista junto con los demás datos de la solicitud",
    );
  }
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
  await setRequestStatus(ctx, input.requestId, result.change.to);
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
  await setRequestStatus(ctx, input.requestId, result.change.to);
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
  await setRequestStatus(ctx, input.requestId, result.change.to);
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
) {
  const student = await requireActiveStudent(ctx, identity);
  const row = await getRequestById(ctx, input.requestId);
  if (row === null) deny();
  if (row.studentId !== student._id) deny();
  const result = transitionRequest({
    from: row.status,
    to: "cancelled",
    actorId: student._id,
    occurredAt: Date.now(),
    reason: input.reason,
  });
  if (result.status === "rejected") {
    if (result.cause === "reason_required") {
      rejectFields("Se requiere el motivo para cancelar la solicitud");
    }
    rejectState("La solicitud no admite la cancelación en su estado actual");
  }
  await setRequestStatus(ctx, input.requestId, result.change.to);
  await logRequestTransition(ctx, {
    requestId: input.requestId,
    from: result.change.from,
    to: result.change.to,
    actorId: student._id,
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
) {
  const professional = await requireActiveProfessional(ctx, identity);
  const row = await getRequestById(ctx, input.requestId);
  if (row === null) deny();
  const take = await findActiveTake(ctx, input.requestId, professional._id);
  if (take === null) deny();
  const result = transitionRequest({
    from: row.status,
    to: "closed_without_accompaniment",
    actorId: professional._id,
    occurredAt: Date.now(),
    reason: input.reason,
  });
  if (result.status === "rejected") {
    if (result.cause === "reason_required") {
      rejectFields("Se requiere el motivo para cerrar la solicitud sin acompañamiento");
    }
    rejectState("La solicitud no admite el cierre sin acompañamiento en su estado actual");
  }
  // La política ya exigió el motivo; sin él no hay razón que mostrar.
  const closureReason = result.change.reason;
  if (closureReason === undefined) deny();
  await closeRequestWithReason(ctx, input.requestId, closureReason);
  await logRequestTransition(ctx, {
    requestId: input.requestId,
    from: result.change.from,
    to: result.change.to,
    actorId: professional._id,
    reason: closureReason,
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
) {
  const student = await requireActiveStudent(ctx, identity);
  const row = await getRequestById(ctx, input.requestId);
  if (row === null) deny();
  if (row.studentId !== student._id) deny();
  // Solo la espera admite respuesta: `received -> under_review` existe en la
  // tabla, pero es la toma del Profesional, no un paso del Estudiante.
  if (row.status !== "awaiting_information_or_acceptance") {
    rejectState("La solicitud no admite una respuesta en su estado actual");
  }
  const result = transitionRequest({
    from: row.status,
    to: "under_review",
    actorId: student._id,
    occurredAt: Date.now(),
    reason: input.response,
  });
  if (result.status === "rejected") {
    if (result.cause === "reason_required") {
      rejectFields("Se requiere la respuesta a la información pedida");
    }
    rejectState("La solicitud no admite una respuesta en su estado actual");
  }
  const response = result.change.reason;
  if (response === undefined) deny();
  if (response.length > REQUEST_RESPONSE_MAX_LENGTH) {
    rejectFields(
      `La respuesta supera el máximo permitido (${REQUEST_RESPONSE_MAX_LENGTH} caracteres)`,
    );
  }
  await setRequestStatus(ctx, input.requestId, result.change.to);
  await logRequestTransition(ctx, {
    requestId: input.requestId,
    from: result.change.from,
    to: result.change.to,
    actorId: student._id,
    reason: response,
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
