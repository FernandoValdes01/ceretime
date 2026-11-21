import { ConvexError } from "convex/values";
import type { AuthenticatedProfile } from "../../domain/identity/roles";
import { initialProfileFor, profileFullName } from "../../domain/accounts/own_profile";
import { AUTHORIZATION_DENIED_MESSAGE } from "../authorization/authorize";
import { toMinimalIdentity } from "./minimal_identity";
import type { OwnProfileReader, OwnProfileStore } from "./ports";

/**
 * Casos de uso del perfil propio autenticado (TI2-10, TI2-182).
 *
 * Capa de Aplicación: recibe la identidad ya resuelta en el borde con
 * `ctx.auth.getUserIdentity()` y devuelve solo lo necesario para la
 * interfaz (`fullName`, `email`, `role` y estados de habilitación). No
 * exige cuenta habilitada y vigente: el propio titular necesita conocer su
 * estado para entender un bloqueo. Sin identidad o sin perfil responde la
 * denegación genérica, sin motivo.
 */

function deny(): never {
  throw new ConvexError(AUTHORIZATION_DENIED_MESSAGE);
}

/** Perfil propio mínimo para la interfaz condicionada por rol. */
export async function getMyProfileUseCase(
  identity: { readonly tokenIdentifier: string } | null,
  deps: { readonly profiles: OwnProfileReader },
): Promise<AuthenticatedProfile> {
  if (identity === null) deny();
  const profile = await deps.profiles.findByTokenIdentifier(identity.tokenIdentifier);
  if (profile === null) deny();
  return profile;
}

/** Lo que el primer ingreso necesita de la identidad autenticada. */
export type OwnProfileIdentity = {
  readonly tokenIdentifier: string;
  readonly email?: unknown;
  readonly name?: unknown;
};

/**
 * Perfil propio en el primer ingreso (TI2-182).
 *
 * Iniciar sesión con Google solo crea el usuario de Better Auth; sin una fila
 * en `users` vinculada por `tokenIdentifier`, cada consulta guardada deniega.
 * Este caso de uso crea esa fila con el perfil inicial que fija Dominio según
 * la población del correo verificado y, si ya existe, la devuelve sin
 * cambiarla: repetirlo nunca habilita, rehabilita ni cambia el rol.
 *
 * Un correo que ya figura en otro perfil no se vincula ni se duplica: el
 * correo no prueba que la identidad sea la misma persona que registró el
 * operador, así que la cuenta queda sin perfil y recibe la denegación
 * genérica hasta que el operador corrija el vínculo.
 */
export async function ensureOwnProfileUseCase(
  identity: OwnProfileIdentity | null,
  deps: { readonly profiles: OwnProfileStore; readonly now: () => number },
): Promise<AuthenticatedProfile> {
  if (identity === null) deny();
  const minimal = toMinimalIdentity({ email: identity.email, name: identity.name });
  if (minimal === null) deny();

  const linked = await deps.profiles.findByTokenIdentifier(identity.tokenIdentifier);
  if (linked !== null) return linked;

  if (await deps.profiles.isEmailRegistered(minimal.email)) deny();

  const initial = initialProfileFor(minimal.population);
  return await deps.profiles.create({
    ...initial,
    email: minimal.email,
    fullName: profileFullName(minimal.name, minimal.email),
    tokenIdentifier: identity.tokenIdentifier,
    ...(initial.institutionalStatus === "enabled" ? { enabledAt: deps.now() } : {}),
  });
}
