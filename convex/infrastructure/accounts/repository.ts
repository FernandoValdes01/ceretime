import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

/**
 * Repositorio de cuentas (TI2-11).
 *
 * Capa de Infraestructura: único lugar que toca `ctx.db` en el flujo de
 * habilitación institucional y arranque administrativo. No decide
 * autorización ni resuelve identidad; solo persiste y recupera con los
 * índices declarados en `convex/schema.ts`, consultando los campos en el
 * orden del índice. Opera con datos ficticios.
 */

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

/** Usuario por id, o `null` si no existe. */
export async function getUserById(
  ctx: DbReader,
  userId: Id<"users">,
): Promise<Doc<"users"> | null> {
  return await ctx.db.get(userId);
}

/** Primera cuenta administrativa existente, o `null` cuando no hay ninguna. */
export async function findExistingAdmin(ctx: DbReader): Promise<Doc<"users"> | null> {
  const rows = await ctx.db
    .query("users")
    .withIndex("by_role", (q) => q.eq("role", "admin"))
    .take(1);
  return rows[0] ?? null;
}

/**
 * Marca la cuenta como habilitada con su auditoría.
 *
 * Fija `institutionalStatus` en `enabled` junto al actor administrador y la
 * fecha de la operación. No cambia el rol: la habilitación jamás convierte
 * una cuenta en Administradora.
 */
export async function patchEnablement(
  ctx: MutationCtx,
  input: {
    readonly userId: Id<"users">;
    readonly enabledBy: Id<"users">;
    readonly enabledAt: number;
  },
): Promise<void> {
  await ctx.db.patch(input.userId, {
    institutionalStatus: "enabled",
    enabledBy: input.enabledBy,
    enabledAt: input.enabledAt,
  });
}

/** Crea la cuenta administrativa inicial del entorno, ya habilitada. */
export async function insertBootstrapAdmin(
  ctx: MutationCtx,
  input: {
    readonly email: string;
    readonly fullName: string;
    readonly tokenIdentifier: string;
    readonly enabledAt: number;
  },
): Promise<Id<"users">> {
  return await ctx.db.insert("users", {
    email: input.email,
    fullName: input.fullName,
    role: "admin",
    institutionalStatus: "enabled",
    accountStatus: "active",
    tokenIdentifier: input.tokenIdentifier,
    enabledAt: input.enabledAt,
  });
}
