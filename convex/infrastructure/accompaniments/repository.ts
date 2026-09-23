import type { PaginationOptions } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

/**
 * Repositorio de acompañamientos (S2).
 *
 * Capa de Infraestructura: único lugar que toca `ctx.db` en el flujo de
 * acompañamientos y asignaciones. No decide autorización ni resuelve
 * identidad; solo persiste/recupera con los índices declarados en
 * `convex/schema.ts`, consultando los campos en el orden del índice.
 *
 * Opera con datos ficticios.
 */

/** Contexto con lectura de base de datos (consultas y mutaciones). */
type DbReader = QueryCtx | MutationCtx;

/** Perfil vinculado a la identidad autenticada, o `null` si no existe. */
export async function findProfileByTokenIdentifier(
  ctx: DbReader,
  tokenIdentifier: string,
): Promise<Doc<"users"> | null> {
  return await ctx.db
    .query("users")
    .withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", tokenIdentifier))
    .unique();
}

/** Acompañamiento por id, o `null` si no existe. */
export async function getAccompanimentById(
  ctx: DbReader,
  accompanimentId: Id<"accompaniments">,
): Promise<Doc<"accompaniments"> | null> {
  return await ctx.db.get(accompanimentId);
}

/**
 * Acompañamiento abierto desde la solicitud, o `null` si aún no se aceptó.
 * La vía guardada crea como máximo uno por solicitud; basta una fila para
 * decidir sin lecturas ilimitadas.
 */
export async function findAccompanimentByRequest(
  ctx: DbReader,
  requestId: Id<"requests">,
): Promise<Doc<"accompaniments"> | null> {
  const rows = await ctx.db
    .query("accompaniments")
    .withIndex("by_request", (q) => q.eq("requestId", requestId))
    .take(1);
  return rows[0] ?? null;
}

/**
 * Abre el acompañamiento en estado `active` vinculado a su solicitud de
 * origen. Solo persistencia: la unicidad la garantiza la vía guardada de
 * aceptación (TI2-24) al comprobar y crear en la misma transacción.
 */
export async function insertAccompaniment(
  ctx: MutationCtx,
  input: {
    readonly studentId: Id<"users">;
    readonly objective: string;
    readonly accessNeeds: string;
    readonly requestId: Id<"requests">;
  },
) {
  return await ctx.db.insert("accompaniments", { ...input, status: "active" });
}

/** Usuario por id, o `null` si no existe. */
export async function getUserById(
  ctx: DbReader,
  userId: Id<"users">,
): Promise<Doc<"users"> | null> {
  return await ctx.db.get(userId);
}

/**
 * Filas de asignación para la tripla exacta (acompañamiento, usuario), una
 * como máximo por rol. Basta para decidir sin lecturas ilimitadas.
 */
export async function findActiveAssignmentsForUser(
  ctx: DbReader,
  accompanimentId: Id<"accompaniments">,
  userId: Id<"users">,
): Promise<Doc<"accompanimentAssignments">[]> {
  const professional = await ctx.db
    .query("accompanimentAssignments")
    .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
      q
        .eq("accompanimentId", accompanimentId)
        .eq("userId", userId)
        .eq("status", "active")
        .eq("assignedRole", "professional"),
    )
    .take(1);
  const intern = await ctx.db
    .query("accompanimentAssignments")
    .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
      q
        .eq("accompanimentId", accompanimentId)
        .eq("userId", userId)
        .eq("status", "active")
        .eq("assignedRole", "intern"),
    )
    .take(1);
  return [...professional, ...intern];
}

/** Página de acompañamientos propios del estudiante. */
export async function paginateOwnedAccompaniments(
  ctx: DbReader,
  studentId: Id<"users">,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("accompaniments")
    .withIndex("by_student", (q) => q.eq("studentId", studentId))
    .paginate(paginationOpts);
}

/**
 * Ventana del listado asignado con paginación keyset sobre el
 * acompañamiento. El índice ordena por esa columna, así que las filas
 * duplicadas quedan adyacentes y el cursor las excluye enteras.
 */
export async function queryAssignedRowsAfter(
  ctx: DbReader,
  input: {
    readonly userId: Id<"users">;
    readonly assignedRole: "professional" | "intern";
    readonly cursor: Id<"accompaniments"> | undefined;
    readonly take: number;
  },
) {
  return await ctx.db
    .query("accompanimentAssignments")
    .withIndex("by_user_and_status_and_assigned_role_and_accompaniment", (q) => {
      const ranged = q
        .eq("userId", input.userId)
        .eq("status", "active")
        .eq("assignedRole", input.assignedRole);
      return input.cursor === undefined ? ranged : ranged.gt("accompanimentId", input.cursor);
    })
    .order("asc")
    .take(input.take);
}

/** Página de notas internas del acompañamiento. */
export async function paginateInternalNotes(
  ctx: DbReader,
  accompanimentId: Id<"accompaniments">,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("followUpNotes")
    .withIndex("by_accompaniment", (q) => q.eq("accompanimentId", accompanimentId))
    .paginate(paginationOpts);
}

export type AssignmentTriple = {
  readonly accompanimentId: Id<"accompaniments">;
  readonly userId: Id<"users">;
  readonly assignedRole: "professional" | "intern";
};

/** Fila activa exacta de la tripla, si existe. */
export async function findExistingActiveAssignment(
  ctx: MutationCtx,
  triple: AssignmentTriple,
): Promise<Doc<"accompanimentAssignments"> | null> {
  const rows = await ctx.db
    .query("accompanimentAssignments")
    .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
      q
        .eq("accompanimentId", triple.accompanimentId)
        .eq("userId", triple.userId)
        .eq("status", "active")
        .eq("assignedRole", triple.assignedRole),
    )
    .take(1);
  return rows[0] ?? null;
}

/**
 * Verdadero cuando el usuario tiene asignación profesional activa sobre el
 * acompañamiento (TI2-28). Chequeo de presencia exacto: una fila basta para
 * decidir, sin lecturas ilimitadas.
 */
export async function hasActiveProfessionalAssignment(
  ctx: MutationCtx,
  input: {
    readonly accompanimentId: Id<"accompaniments">;
    readonly userId: Id<"users">;
  },
): Promise<boolean> {
  const rows = await ctx.db
    .query("accompanimentAssignments")
    .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
      q
        .eq("accompanimentId", input.accompanimentId)
        .eq("userId", input.userId)
        .eq("status", "active")
        .eq("assignedRole", "professional"),
    )
    .take(1);
  return rows.length > 0;
}

/** Crea la fila activa de la tripla, registrando quién concede y cuándo. */
export async function insertActiveAssignment(
  ctx: MutationCtx,
  triple: AssignmentTriple,
  grantedBy: Id<"users">,
) {
  return await ctx.db.insert("accompanimentAssignments", {
    ...triple,
    status: "active",
    grantedBy,
    grantedAt: Date.now(),
  });
}

/** Lote de filas activas de la tripla para revocación. */
export async function takeActiveTripleRows(
  ctx: MutationCtx,
  triple: AssignmentTriple,
  take: number,
) {
  return await ctx.db
    .query("accompanimentAssignments")
    .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
      q
        .eq("accompanimentId", triple.accompanimentId)
        .eq("userId", triple.userId)
        .eq("status", "active")
        .eq("assignedRole", triple.assignedRole),
    )
    .take(take);
}

/** Marca una fila de asignación como revocada, registrando quién revoca y cuándo. */
export async function revokeAssignmentRow(
  ctx: MutationCtx,
  assignmentId: Id<"accompanimentAssignments">,
  revokedBy: Id<"users">,
) {
  await ctx.db.patch(assignmentId, {
    status: "revoked",
    revokedBy,
    revokedAt: Date.now(),
  });
}
