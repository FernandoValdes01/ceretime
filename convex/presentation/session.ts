import { ConvexError, v } from "convex/values";
import { AUTHORIZATION_DENIED_MESSAGE } from "../application/authorization/authorize";
import { toMinimalIdentity } from "../application/session/minimal_identity";
import { resolveSessionAndRole } from "../application/session/portal_role";
import { getMyProfileUseCase } from "../application/session/profile";
import type { PublicApiError } from "../domain/errors/api_error";
import { query } from "../_generated/server";
import { accountStatusUnion, institutionalStatusUnion, roleUnion } from "../validators";

/**
 * Traducción segura del borde Convex para endpoints nuevos (TI2-88).
 *
 * Borde compartido de Presentación: convierte un `PublicApiError` del
 * dominio en `ConvexError({code, message})` con solo esas dos claves, sin
 * pila, identificadores de terceros, necesidades ni notas. Conflicto
 * (`conflict`) y ausencia de cupo (`no_availability`) usan códigos distintos
 * sin filtrar la existencia de recursos; la ausencia de cupo se coordina por
 * el canal oficial con la referencia mínima ya entregada, sin crear una
 * reserva incompatible. Todos los endpoints nuevos de disponibilidad,
 * espacios y atención la reutilizan en vez de inventar su propia forma de
 * error o depender de autorización para adaptar sus respuestas. Sprint 1 se
 * conserva (`unauthenticated` acá y `ConvexError("No autorizado")` en el
 * resto); los clientes distinguen por `code`, nunca por el texto.
 */
export function toSecureConvexError(
  error: PublicApiError,
): ConvexError<{ code: string; message: string }> {
  return new ConvexError({ code: error.code, message: error.message });
}

/**
 * Denegación de Sprint 1 para reutilizar en endpoints nuevos y existentes.
 *
 * Lanza el mismo `ConvexError("No autorizado")` sin revelar si el recurso
 * existe o a quién pertenece. Se conserva para compatibilidad: los clientes
 * distinguen por código en el contrato común, nunca interpretando el texto.
 */
export function denyUnauthorized(): never {
  throw new ConvexError(AUTHORIZATION_DENIED_MESSAGE);
}

/**
 * Entrada pública delgada: lanza la traducción compartida de este borde para
 * que disponibilidad, espacios y atención respondan igual sin duplicarla.
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
