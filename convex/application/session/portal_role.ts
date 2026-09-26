import type { UserIdentity } from "convex/server";
import type { QueryCtx } from "../../_generated/server";
import type { InstitutionalPopulation } from "../../domain/auth/institutional_domain";
import type { Role } from "../../domain/identity/roles";
import { findProfileByTokenIdentifier } from "../../infrastructure/accounts/repository";
import { toMinimalIdentity } from "./minimal_identity";

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

/** Sesión mínima tal como la expone `getSessionState` (TI2-3). */
export type SessionStateForRole =
  | {
      readonly status: "authenticated";
      readonly email: string;
      readonly name: string;
      readonly population: InstitutionalPopulation;
    }
  | { readonly status: "unauthenticated" };

/**
 * Sesión y rol resueltos desde la misma identidad en una sola llamada
 * (TI2-20). Al viajar juntos en una única respuesta, la Web nunca observa
 * la sesión de una cuenta con el rol de otra: al cambiar de cuenta ambas
 * mitades cambian a la vez. El correo de la sesión (identidad) puede
 * diferir del guardado en el perfil (el arranque admite ambos
 * independientes), así que el vínculo es la identidad común, nunca la
 * igualdad de correos.
 */
export type SessionAndRole = {
  readonly session: SessionStateForRole;
  readonly role: SessionRole;
};

export async function resolveSessionAndRole(
  ctx: QueryCtx,
  identity: UserIdentity | null,
): Promise<SessionAndRole> {
  const role = await resolveSessionRole(ctx, identity);
  if (identity === null) {
    return { session: { status: "unauthenticated" }, role };
  }
  const minimal = toMinimalIdentity({ email: identity.email, name: identity.name });
  if (minimal === null) {
    return { session: { status: "unauthenticated" }, role };
  }
  return {
    session: {
      status: "authenticated",
      email: minimal.email,
      name: minimal.name,
      population: minimal.population,
    },
    role,
  };
}
