import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import { toAccompanimentRequest } from "../../domain/request/request";
import { transitionRequest } from "../../domain/request/transition_policy";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { AUTHORIZATION_DENIED_MESSAGE } from "../authorization/authorize";
import {
  getRequestById,
  insertReceivedRequest,
  logRequestTransition,
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
 * genérica. Si el estado actual no admite el paso o falta el motivo, se
 * rechaza sin modificar nada. Persiste el estado y el registro del cambio
 * (motivo, actor y fecha) en la misma transacción.
 */
export async function requestAdditionalInformation(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  input: { readonly requestId: Id<"requests">; readonly reason: string },
) {
  const professional = await requireActiveProfessional(ctx, identity);
  const row = await getRequestById(ctx, input.requestId);
  if (row === null) deny();
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
