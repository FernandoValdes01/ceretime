import { v } from "convex/values";
import { toMinimalIdentity } from "../application/session/minimal_identity";
import { getMyProfileUseCase } from "../application/session/profile";
import { query } from "../_generated/server";
import { accountStatusUnion, institutionalStatusUnion, roleUnion } from "../validators";

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
