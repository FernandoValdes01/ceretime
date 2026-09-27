import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import type { AuthenticatedProfile } from "../../domain/identity/roles";
import type { QueryCtx } from "../../_generated/server";
import { findProfileByTokenIdentifier } from "../../infrastructure/accounts/repository";
import { AUTHORIZATION_DENIED_MESSAGE } from "../authorization/authorize";

/**
 * Caso de uso: perfil propio autenticado (TI2-10).
 *
 * Capa de Aplicación: recibe la identidad ya resuelta en el borde con
 * `ctx.auth.getUserIdentity()` y devuelve solo lo necesario para la
 * interfaz (`fullName`, `email`, `role` y estados de habilitación). No
 * exige cuenta habilitada y vigente: el propio titular necesita conocer su
 * estado para entender un bloqueo. Sin identidad o sin perfil responde la
 * denegación genérica, sin motivo. Opera con datos ficticios.
 */

function deny(): never {
  throw new ConvexError(AUTHORIZATION_DENIED_MESSAGE);
}

/** Perfil propio mínimo para la interfaz condicionada por rol. */
export async function getMyProfileUseCase(
  ctx: QueryCtx,
  identity: UserIdentity | null,
): Promise<AuthenticatedProfile> {
  if (identity === null) deny();
  const profile = await findProfileByTokenIdentifier(ctx, identity?.tokenIdentifier ?? "");
  if (profile === null) deny();
  return {
    fullName: profile.fullName,
    email: profile.email,
    role: profile.role,
    institutionalStatus: profile.institutionalStatus,
    accountStatus: profile.accountStatus,
  };
}
