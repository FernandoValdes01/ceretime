import type { PaginationOptions } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

/**
 * Repositorio de solicitudes (TI2-9).
 *
 * Capa de Infraestructura: único lugar que toca `ctx.db` en el flujo de
 * solicitudes. No decide autorización ni resuelve identidad; solo
 * persiste/recupera con los índices declarados en `convex/schema.ts`.
 *
 * Opera con datos ficticios.
 */

/** Contexto con lectura de base de datos (consultas y mutaciones). */
type DbReader = QueryCtx | MutationCtx;

/** Inserta una solicitud recibida del estudiante. */
export async function insertReceivedRequest(
  ctx: MutationCtx,
  input: {
    readonly studentId: Id<"users">;
    readonly accessNeeds: string;
  },
) {
  return await ctx.db.insert("requests", {
    studentId: input.studentId,
    status: "received",
    accessNeeds: input.accessNeeds,
    createdAt: Date.now(),
  });
}

/** Solicitud por id, o `null` si no existe. */
export async function getRequestById(
  ctx: DbReader,
  requestId: Id<"requests">,
): Promise<Doc<"requests"> | null> {
  return await ctx.db.get(requestId);
}

/** Actualiza el estado de una solicitud. */
export async function setRequestStatus(
  ctx: MutationCtx,
  requestId: Id<"requests">,
  status: Doc<"requests">["status"],
): Promise<void> {
  await ctx.db.patch(requestId, { status });
}

/** Solicitudes propias del estudiante, paginadas. */
export async function listOwnedRequests(
  ctx: DbReader,
  studentId: Id<"users">,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("requests")
    .withIndex("by_student", (q) => q.eq("studentId", studentId))
    .paginate(paginationOpts);
}
