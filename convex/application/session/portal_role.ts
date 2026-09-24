import type { UserIdentity } from "convex/server";
import type { QueryCtx } from "../../_generated/server";
import type { Role } from "../../domain/identity/roles";
import { findProfileByTokenIdentifier } from "../../infrastructure/accounts/repository";

/**
 * Caso de uso: rol propio para navegación Web (TI2-20).
 *
 * Devuelve el rol del perfil vinculado a la identidad, o no autenticado
 * cuando no hay identidad o no existe perfil. Solo lectura del propio
 * perfil: no decide permisos ni expone datos de terceros. La autorización
 * efectiva sigue en cada función guardada del Backend.
 */
export type SessionRole =
  | { readonly status: "authenticated"; readonly role: Role }
  | { readonly status: "unauthenticated" };

export async function resolveSessionRole(
  ctx: QueryCtx,
  identity: UserIdentity | null,
): Promise<SessionRole> {
  if (identity === null) return { status: "unauthenticated" };
  const profile = await findProfileByTokenIdentifier(ctx, identity.tokenIdentifier ?? "");
  if (profile === null) return { status: "unauthenticated" };
  return { status: "authenticated", role: profile.role };
}
