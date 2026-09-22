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

/** Registra el cambio de estado con motivo, actor y fecha. */
export async function logRequestTransition(
  ctx: MutationCtx,
  input: {
    readonly requestId: Id<"requests">;
    readonly from: Doc<"requests">["status"];
    readonly to: Doc<"requests">["status"];
    readonly actorId: Id<"users">;
    readonly reason?: string;
    readonly occurredAt: number;
  },
): Promise<void> {
  await ctx.db.insert("requestTransitions", {
    requestId: input.requestId,
    from: input.from,
    to: input.to,
    actorId: input.actorId,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    occurredAt: input.occurredAt,
  });
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

/** Todas las solicitudes en orden de creación, paginadas. */
export async function listAllRequests(ctx: DbReader, paginationOpts: PaginationOptions) {
  return await ctx.db.query("requests").order("asc").paginate(paginationOpts);
}

/** Tomas activas del usuario, paginadas. */
export async function listActiveTakes(
  ctx: DbReader,
  userId: Id<"users">,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("requestAssignments")
    .withIndex("by_user_and_status", (q) => q.eq("userId", userId).eq("status", "active"))
    .order("asc")
    .paginate(paginationOpts);
}

/** Toma activa exacta de la solicitud por el usuario, si existe. */
export async function findActiveTake(
  ctx: DbReader,
  requestId: Id<"requests">,
  userId: Id<"users">,
): Promise<Doc<"requestAssignments"> | null> {
  const rows = await ctx.db
    .query("requestAssignments")
    .withIndex("by_request_and_user_and_status", (q) =>
      q.eq("requestId", requestId).eq("userId", userId).eq("status", "active"),
    )
    .take(1);
  return rows[0] ?? null;
}

/** Crea la toma activa de la solicitud por el usuario. */
export async function insertActiveTake(
  ctx: MutationCtx,
  input: {
    readonly requestId: Id<"requests">;
    readonly userId: Id<"users">;
    readonly grantedBy: Id<"users">;
  },
) {
  return await ctx.db.insert("requestAssignments", {
    requestId: input.requestId,
    userId: input.userId,
    grantedBy: input.grantedBy,
    grantedAt: Date.now(),
    status: "active",
  });
}
