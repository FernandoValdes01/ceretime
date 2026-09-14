import { v } from "convex/values";
import {
  enableInternAccount,
  ensureBootstrapAdmin as ensureBootstrapAdminUseCase,
} from "./application/accounts/enablement";
import { internalMutation } from "./_generated/server";

/**
 * Escritura guardada de cuentas (TI2-11).
 *
 * Borde interno: valida la entrada, resuelve la identidad en el servidor y
 * delega en Aplicación, que persiste con Infraestructura. No existe función
 * pública para crear o promover Administradores: la habilitación de
 * Practicantes exige llamante Administrador vigente y el arranque inicial es
 * la única vía de creación administrativa, una sola vez por entorno. Opera
 * con datos ficticios.
 */

/**
 * Habilita la cuenta de un Practicante pendiente.
 *
 * Solo el Administrador con cuenta habilitada y vigente puede llamarla. Fija
 * `institutionalStatus` en `enabled` y registra actor (`enabledBy`) y fecha
 * (`enabledAt`); jamás cambia el rol ni concede acompañamientos.
 */
export const enableIntern = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return await enableInternAccount(ctx, identity, args);
  },
});

/**
 * Crea la cuenta administrativa inicial del entorno.
 *
 * Vía controlada y única: falla cuando ya existe un Administrador. El
 * procedimiento por entorno (valores, orden y verificación) vive en
 * `domain/accounts/enablement.md`; las semillas de desarrollo
 * (`internal.users.createTestUser`) nunca se ejecutan en producción.
 */
export const ensureBootstrapAdmin = internalMutation({
  args: {
    email: v.string(),
    fullName: v.string(),
    tokenIdentifier: v.string(),
  },
  handler: async (ctx, args) => {
    return await ensureBootstrapAdminUseCase(ctx, args);
  },
});
