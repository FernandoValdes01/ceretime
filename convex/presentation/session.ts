import { v } from "convex/values";
import { toMinimalIdentity } from "../application/session/minimal_identity";
import { resolveSessionRole } from "../application/session/portal_role";
import { roleUnion } from "../validators";
import { query } from "../_generated/server";

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
 * Borde de Presentación: rol propio para navegación Web (TI2-20).
 *
 * Adaptador delgado: resuelve la identidad en el servidor y delega en
 * Aplicación. Devuelve solo el rol del propio perfil para que la Web elija
 * portal; sin identidad o sin perfil responde `unauthenticated`, que los
 * guards tratan como denegado. No autoriza nada por sí mismo.
 */
export const getSessionRole = query({
  args: {},
  returns: v.union(
    v.object({ status: v.literal("authenticated"), role: roleUnion }),
    v.object({ status: v.literal("unauthenticated") }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    return await resolveSessionRole(ctx, identity);
  },
});
