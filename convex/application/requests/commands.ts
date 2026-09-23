import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import { toOpeningObjective, type Accompaniment } from "../../domain/accompaniment/accompaniment";
import { toAccompanimentRequest } from "../../domain/request/request";
import { transitionRequest } from "../../domain/request/transition_policy";
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
  logRequestTransition,
  markRequestTaken,
  setRequestStatus,
} from "../../infrastructure/requests/repository";
import { requireActiveProfessional, requireActiveStudent } from "./identity";

/**
 * Casos de uso de escritura de solicitudes (TI2-9).
 *
 * Capa de Aplicación: recibe la identidad ya resuelta en el borde con
 * `ctx.auth.getUserIdentity()`, exige Estudiante con cuenta habilitada y
 * vigente, y persiste con Infraestructura. Convertir el contenido
 * estructurado a la forma persistida es alcance de TI2-23: aquí solo se
 * guarda el texto de necesidades de acceso. Opera con datos ficticios.
 */

function deny(): never {
  throw new ConvexError(AUTHORIZATION_DENIED_MESSAGE);
}

/**
 * Registra la solicitud del Estudiante en estado `received`. Solo el propio
 * Estudiante con cuenta vigente puede registrar; cualquier otro caso recibe
 * denegación genérica, sin motivo ni existencia del recurso.
 */
export async function registerRequest(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  input: { readonly accessNeeds: string },
) {
  const student = await requireActiveStudent(ctx, identity);
  const requestId = await insertReceivedRequest(ctx, {
    studentId: student._id,
    accessNeeds: input.accessNeeds,
  });
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
 * aceptación —incluso en concurrencia, que Convex serializa— encuentra el
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
