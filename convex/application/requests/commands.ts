import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import { toAccompanimentRequest } from "../../domain/request/request";
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { findProfileByTokenIdentifier } from "../../infrastructure/accompaniments/repository";
import { AUTHORIZATION_DENIED_MESSAGE } from "../authorization/authorize";
import { insertReceivedRequest } from "../../infrastructure/requests/repository";

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

/** Estudiante con cuenta habilitada y vigente. */
async function requireActiveStudent(
  ctx: MutationCtx,
  identity: UserIdentity | null,
): Promise<Doc<"users">> {
  if (identity === null) deny();
  const caller = await findProfileByTokenIdentifier(ctx, identity?.tokenIdentifier ?? "");
  if (
    caller === null ||
    caller.role !== "student" ||
    caller.institutionalStatus !== "enabled" ||
    caller.accountStatus !== "active"
  ) {
    deny();
  }
  return caller;
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
  const row = await ctx.db.get(requestId);
  if (row === null) deny();
  return toAccompanimentRequest({
    _id: row._id,
    studentId: row.studentId,
    status: row.status,
    accessNeeds: row.accessNeeds,
    createdAt: row.createdAt,
  });
}
