import { v } from "convex/values";
import { toSecureConvexError } from "../application/authorization/authorize";
import { toMinimalIdentity } from "../application/session/minimal_identity";
import { resolveSessionAndRole } from "../application/session/portal_role";
import { getMyProfileUseCase } from "../application/session/profile";
import type { PublicApiError } from "../domain/errors/api_error";
import { query } from "../_generated/server";
import { accountStatusUnion, institutionalStatusUnion, roleUnion } from "../validators";

/**
 * Traducción segura del borde Convex para endpoints nuevos (TI2-88).
 *
 * Entrada pública delgada: reutiliza la misma traducción de Aplicación para
 * que todos los endpoints nuevos de disponibilidad, espacios y atención
 * respondan `ConvexError({code, message})` con solo esas dos claves, sin
 * pila, identificadores de terceros, necesidades ni notas. Sprint 1 se
 * conserva (`unauthenticated` acá y `ConvexError("No autorizado")` en el
 * resto); los clientes distinguen por `code`, nunca por el texto.
 */
export function throwPublicApiError(error: PublicApiError): never {
  throw toSecureConvexError(error);
}

/**
 * Borde de Presentación: estado de sesión (TI2-3).
 *
 * Valida la entrada (sin argumentos), resuelve la identidad en el servidor
 * con `ctx.auth.getUserIdentity()` y delega en Aplicación/Dominio. Devuelve
 * solo datos mínimos; una sesión expirada, ausente o con correo no
 * institucional responde igual: `unauthenticated`, sin exponer el motivo.
 */

export const getSessionState = query({
  args: {},
  returns: v.union(
    v.object({
      status: v.literal("authenticated"),
      email: v.string(),
      name: v.string(),
      population: v.union(v.literal("estudiante"), v.literal("personal")),
    }),
    v.object({ status: v.literal("unauthenticated") }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) return { status: "unauthenticated" as const };

    const minimal = toMinimalIdentity({
      email: identity.email,
      name: identity.name,
    });
    if (minimal === null) return { status: "unauthenticated" as const };

    return {
      status: "authenticated" as const,
      email: minimal.email,
      name: minimal.name,
      population: minimal.population,
    };
  },
});

/**
 * Perfil propio autenticado (TI2-10).
 *
 * Adaptador delgado: resuelve la identidad en el servidor y delega en
 * Aplicación. Devuelve solo lo necesario para la interfaz condicionada por
 * rol; sin identidad o sin perfil responde la denegación genérica.
 */
export const getMyProfile = query({
  args: {},
  returns: v.object({
    fullName: v.string(),
    email: v.string(),
    role: roleUnion,
    institutionalStatus: institutionalStatusUnion,
    accountStatus: accountStatusUnion,
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    return await getMyProfileUseCase(ctx, identity);
  },
});

const sessionStateValidator = v.union(
  v.object({
    status: v.literal("authenticated"),
    email: v.string(),
    name: v.string(),
    population: v.union(v.literal("estudiante"), v.literal("personal")),
  }),
  v.object({ status: v.literal("unauthenticated") }),
);

const sessionRoleValidator = v.union(
  v.object({ status: v.literal("authenticated"), role: roleUnion, email: v.string() }),
  v.object({ status: v.literal("unauthenticated") }),
);

/**
 * Borde de Presentación: sesión y rol propio para navegación Web (TI2-20).
 *
 * Adaptador delgado: resuelve la identidad una vez en el servidor y delega
 * en Aplicación. Devuelve sesión y rol juntos para que la Web nunca observe
 * la sesión de una cuenta con el rol de otra al cambiar de cuenta. Sin
 * identidad, sin perfil o sin vigencia responde `unauthenticated` en la
 * mitad que corresponda. No autoriza nada por sí mismo.
 */
export const getSessionWithRole = query({
  args: {},
  returns: v.object({
    session: sessionStateValidator,
    role: sessionRoleValidator,
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    return await resolveSessionAndRole(ctx, identity);
  },
});
