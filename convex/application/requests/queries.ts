import type { PaginationOptions, UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import { toAccompanimentRequest } from "../../domain/request/request";
import type { Doc } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { findProfileByTokenIdentifier } from "../../infrastructure/accompaniments/repository";
import { AUTHORIZATION_DENIED_MESSAGE } from "../authorization/authorize";
import { listOwnedRequests } from "../../infrastructure/requests/repository";

/**
 * Casos de uso de lectura de solicitudes (TI2-9).
 *
 * Capa de Aplicación: recibe la identidad ya resuelta en el borde con
 * `ctx.auth.getUserIdentity()`, exige Estudiante con cuenta habilitada y
 * vigente, y lee con Infraestructura. El Estudiante solo ve sus recursos
 * propios: el `studentId` siempre sale del perfil del servidor, nunca del
 * cliente. Opera con datos ficticios.
 */

function deny(): never {
  throw new ConvexError(AUTHORIZATION_DENIED_MESSAGE);
}

/** Estudiante con cuenta habilitada y vigente. */
async function requireActiveStudent(
  ctx: QueryCtx,
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
 * Lista las solicitudes propias del Estudiante, paginado. Cualquier otro
 * rol recibe denegación genérica, sin motivo ni existencia de recursos.
 */
export async function listOwnRequestsUseCase(
  ctx: QueryCtx,
  identity: UserIdentity | null,
  args: { readonly paginationOpts: PaginationOptions },
) {
  const student = await requireActiveStudent(ctx, identity);
  const result = await listOwnedRequests(ctx, student._id, args.paginationOpts);
  return {
    ...result,
    page: result.page.map((row) =>
      toAccompanimentRequest({
        _id: row._id,
        studentId: row.studentId,
        status: row.status,
        accessNeeds: row.accessNeeds,
        createdAt: row.createdAt,
      }),
    ),
  };
}
