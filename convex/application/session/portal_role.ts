import type { UserIdentity } from "convex/server";
import type { QueryCtx } from "../../_generated/server";
import type { Role } from "../../domain/identity/roles";
import { findProfileByTokenIdentifier } from "../../infrastructure/accounts/repository";

/**
 * Caso de uso: rol propio para navegación Web (TI2-20).
 *
 * Devuelve el rol del perfil vinculado a la identidad cuando la cuenta
 * puede operar (habilitación institucional vigente y cuenta activa, como
 * exige `requireAuthorizedProfile`); sin identidad, sin perfil o sin
 * vigencia responde no autenticado. Incluye el correo del perfil para que
 * la Web vincule sesión y rol al mismo principal: al cambiar de cuenta
 * ambas consultas se actualizan en momentos distintos y el rol anterior no
 * debe abrir su portal. Solo lectura del propio perfil: no decide permisos
 * ni expone datos de terceros. La autorización efectiva sigue en cada
 * función guardada del Backend.
 */
export type SessionRole =
  | { readonly status: "authenticated"; readonly role: Role; readonly email: string }
  | { readonly status: "unauthenticated" };

export async function resolveSessionRole(
  ctx: QueryCtx,
  identity: UserIdentity | null,
): Promise<SessionRole> {
  if (identity === null) return { status: "unauthenticated" };
  const profile = await findProfileByTokenIdentifier(ctx, identity.tokenIdentifier ?? "");
  if (
    profile === null ||
    profile.institutionalStatus !== "enabled" ||
    profile.accountStatus !== "active"
  ) {
    return { status: "unauthenticated" };
  }
  return { status: "authenticated", role: profile.role, email: profile.email };
}
