import { v } from "convex/values";
import { toMinimalIdentity } from "../application/session/minimal_identity";
import { resolveSessionAndRole } from "../application/session/portal_role";
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
