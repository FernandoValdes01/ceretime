import { v } from "convex/values";
import { assignAccompaniment, revokeAccompaniment } from "./application/accompaniments/commands";
import { internalMutation } from "./_generated/server";
import { assignmentRoleUnion } from "./validators";

/**
 * Escritura guardada de asignaciones (S2).
 *
 * Borde interno: valida la entrada, resuelve la identidad en el servidor y
 * delega en Aplicación, que persiste con Infraestructura. Única vía de
 * escritura de `accompanimentAssignments` junto a `revoke`. El llamante debe
 * ser un Profesional con cuenta habilitada y vigente; el recorte por
 * acompañamiento (asignar solo en los propios) llega con el flujo público
 * de RF-39. Las lecturas además deduplican por `accompanimentId` ante filas
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
 * `assign` y es idempotente: revocar una fila ya revocada no falla. Revoca
 * TODAS las filas activas de la tripla en lugar de una sola, para que ninguna
 * fila escrita fuera del Backend deje acceso activo tras informar éxito.
 * Si no alcanza a cerrarlas todas, falla en vez de informar éxito parcial.
 * Completa la vía de escritura para que ningún flujo necesite inserts
 * directos.
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
