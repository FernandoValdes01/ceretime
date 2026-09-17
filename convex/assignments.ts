import { v } from "convex/values";
import { assignAccompaniment, revokeAccompaniment } from "./application/accompaniments/commands";
import { internalMutation } from "./_generated/server";
import { assignmentRoleUnion } from "./validators";

/**
 * Escritura guardada de asignaciones (S2, TI2-28).
 *
 * Borde interno: valida la entrada, resuelve la identidad en el servidor y
 * delega en Aplicación, que persiste con Infraestructura. Única vía de
 * escritura de `accompanimentAssignments` junto a `revoke`. El llamante debe
 * ser un Profesional con cuenta habilitada y vigente y no puede asignarse
 * acceso a sí mismo: la asignación siempre la otorga otro profesional
 * autorizado. La concesión a Practicante exige además que el llamante esté
 * autorizado sobre el mismo acompañamiento y que el Practicante tenga cuenta
 * habilitada y vigente; el acompañamiento inexistente o no autorizado
 * responde el mismo error genérico. La asignación entre profesionales sigue
 * en arranque y su recorte por acompañamiento llega con el flujo público de
 * RF-39. Las lecturas además deduplican por `accompanimentId` ante filas
 * escritas a mano fuera del Backend. Opera con datos ficticios.
 */
export const assign = internalMutation({
  args: {
    accompanimentId: v.id("accompaniments"),
    userId: v.id("users"),
    assignedRole: assignmentRoleUnion,
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return await assignAccompaniment(ctx, identity, args);
  },
});

/**
 * Revoca una asignación existente. Comparte la exigencia de llamante con
 * `assign` y es idempotente: revocar una fila ya revocada no falla. El retiro
 * o la revocación de Practicante solo la realiza un Profesional autorizado
 * sobre el mismo acompañamiento; el acompañamiento inexistente o no
 * autorizado responde el mismo error genérico. Revoca TODAS las filas
 * activas de la tripla en lugar de una sola, para que ninguna fila escrita
 * fuera del Backend deje acceso activo tras informar éxito. Si no alcanza a
 * cerrarlas todas, falla en vez de informar éxito parcial. Completa la vía
 * de escritura para que ningún flujo necesite inserts directos.
 */
export const revoke = internalMutation({
  args: {
    accompanimentId: v.id("accompaniments"),
    userId: v.id("users"),
    assignedRole: assignmentRoleUnion,
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return await revokeAccompaniment(ctx, identity, args);
  },
});
