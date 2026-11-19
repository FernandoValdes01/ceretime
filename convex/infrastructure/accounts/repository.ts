import type { PaginationOptions } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { OwnProfileStore } from "../../application/session/ports";
import type { AuthenticatedProfile } from "../../domain/identity/roles";

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

/** Primer perfil con ese correo, o `null` si no existe. */
export async function findUserByEmail(ctx: DbReader, email: string): Promise<Doc<"users"> | null> {
  const rows = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .take(1);
  return rows[0] ?? null;
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

/**
 * Marca la cuenta profesional o administrativa como revocada (TI2-137).
 *
 * Fija `institutionalStatus` en `disabled` junto al actor administrador y la
 * fecha de la operación. Conserva `enabledBy`/`enabledAt` como historial y
 * no cambia el rol. La cuenta revocada deja de operar en la petición
 * siguiente porque ya no cumple `institutionalStatus === "enabled"`.
 */
export async function patchRevocation(
  ctx: MutationCtx,
  input: {
    readonly userId: Id<"users">;
    readonly revokedBy: Id<"users">;
    readonly revokedAt: number;
  },
): Promise<void> {
  await ctx.db.patch(input.userId, {
    institutionalStatus: "disabled",
    revokedBy: input.revokedBy,
    revokedAt: input.revokedAt,
  });
}

/** Página de cuentas de personal para el listado administrativo (TI2-137). */
export async function paginateStaffAccounts(
  ctx: QueryCtx,
  role: "professional" | "admin",
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("users")
    .withIndex("by_role", (q) => q.eq("role", role))
    .paginate(paginationOpts);
}

/** Perfil propio mínimo que ven la interfaz y los casos de uso de sesión. */
export function toAuthenticatedProfile(profile: Doc<"users">): AuthenticatedProfile {
  return {
    fullName: profile.fullName,
    email: profile.email,
    role: profile.role,
    institutionalStatus: profile.institutionalStatus,
    accountStatus: profile.accountStatus,
  };
}

/**
 * Adaptador del puerto `OwnProfileStore` (TI2-182). La habilitación
 * automática del Estudiante deja `enabledAt` sin `enabledBy`, igual que el
 * arranque: no hubo un administrador que actuara.
 */
export function ownProfileStore(ctx: MutationCtx): OwnProfileStore {
  return {
    findByTokenIdentifier: async (tokenIdentifier) => {
      const profile = await findProfileByTokenIdentifier(ctx, tokenIdentifier);
      return profile === null ? null : toAuthenticatedProfile(profile);
    },
    isEmailRegistered: async (email) => (await findUserByEmail(ctx, email)) !== null,
    create: async (profile) => {
      await ctx.db.insert("users", {
        email: profile.email,
        fullName: profile.fullName,
        role: profile.role,
        institutionalStatus: profile.institutionalStatus,
        accountStatus: profile.accountStatus,
        tokenIdentifier: profile.tokenIdentifier,
        ...(profile.enabledAt === undefined ? {} : { enabledAt: profile.enabledAt }),
      });
      return {
        fullName: profile.fullName,
        email: profile.email,
        role: profile.role,
        institutionalStatus: profile.institutionalStatus,
        accountStatus: profile.accountStatus,
      };
    },
  };
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
