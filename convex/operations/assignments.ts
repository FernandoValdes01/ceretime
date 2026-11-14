import { ConvexError, v } from "convex/values";
import { assignAccompaniment, revokeAccompaniment } from "../application/accompaniments/commands";
import { internalMutation } from "../_generated/server";
import { assignmentRoleUnion } from "../infrastructure/validators";

/**
 * Escritura guardada de asignaciones (S2, TI2-28, TI2-140).
 *
 * Borde interno: valida la entrada, resuelve la identidad en el servidor y
 * delega en Aplicación, que persiste con Infraestructura. Desenvuelve el
 * `ApiResult` al mensaje para conservar el contrato histórico de esta vía
 * (la superficie pública traduce el mismo caso al código de TI2-88). El
 * llamante debe ser un Profesional de personal con cuenta habilitada y
 * vigente y no puede asignarse acceso a sí mismo: la asignación siempre la
 * otorga otro profesional autorizado. La concesión a Practicante exige además
 * que el llamante esté autorizado sobre el mismo acompañamiento y que el
 * Practicante tenga cuenta habilitada y vigente; la cuenta de prueba exige lo
 * mismo y la lectura además exige ventana vigente. El acompañamiento
 * inexistente o no autorizado responde el mismo error genérico. La asignación
 * entre profesionales de personal sigue en arranque. Las lecturas además
 * deduplican por `accompanimentId` ante filas escritas a mano fuera del
 * Backend. Opera con datos ficticios.
 */
export const assign = internalMutation({
  args: {
    accompanimentId: v.id("accompaniments"),
    userId: v.id("users"),
    assignedRole: assignmentRoleUnion,
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const result = await assignAccompaniment(ctx, identity, args);
    if (result.status === "error") throw new ConvexError(result.error.message);
    return result.data;
  },
});

/**
 * Revoca una asignación existente. Comparte la exigencia de llamante con
 * `assign` y es idempotente: revocar una fila ya revocada no falla. El retiro
 * o la revocación de una asignación de Practicante o de cuenta de prueba solo
 * la realiza un Profesional de personal autorizado sobre el mismo
 * acompañamiento, aunque el objetivo haya perdido habilitación o vigencia;
 * el acompañamiento inexistente o no autorizado responde el mismo error
 * genérico. Revoca TODAS las filas activas de la tripla en lugar de una
 * sola, para que ninguna fila escrita fuera del Backend deje acceso activo
 * tras informar éxito. Si no alcanza a cerrarlas todas, falla en vez de
 * informar éxito parcial. Completa la vía de escritura para que ningún flujo
 * necesite inserts directos.
 */
export const revoke = internalMutation({
  args: {
    accompanimentId: v.id("accompaniments"),
    userId: v.id("users"),
    assignedRole: assignmentRoleUnion,
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const result = await revokeAccompaniment(ctx, identity, args);
    if (result.status === "error") throw new ConvexError(result.error.message);
    return result.data;
  },
});
