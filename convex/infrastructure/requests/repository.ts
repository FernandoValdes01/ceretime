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

/** Solicitudes propias del estudiante. */
export async function listOwnedRequests(
  ctx: DbReader,
  studentId: Id<"users">,
): Promise<Doc<"requests">[]> {
  return await ctx.db
    .query("requests")
    .withIndex("by_student", (q) => q.eq("studentId", studentId))
    .collect();
}
