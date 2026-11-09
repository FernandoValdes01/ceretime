import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import {
  enableStaffAccount,
  getAccountDetailUseCase,
  listAccountsUseCase,
  revokeStaffAccount,
} from "../application/accounts/enablement";
import { mutation, query } from "../_generated/server";
import {
  accountStatusUnion,
  institutionalStatusUnion,
  roleUnion,
} from "../infrastructure/validators";

/**
 * Borde de Presentación: cuentas profesionales y administrativas (TI2-137).
 *
 * Adaptador delgado: valida la entrada, resuelve la identidad en el servidor
 * con `ctx.auth.getUserIdentity()` y delega en Aplicación, que carga el
 * perfil con Infraestructura y decide con Dominio. Nunca acepta un `userId`
 * del cliente como prueba ni toca `ctx.db` directamente.
 *
 * Solo el Administrador con cuenta habilitada y vigente lista, lee,
 * habilita y revoca cuentas profesionales y administrativas. Toda
 * denegación (sin identidad, sin perfil, cuenta no vigente, rol ajeno o
 * recurso inexistente) responde el mismo error genérico, sin exponer el
 * motivo ni la existencia del recurso. Administrar no concede
 * acompañamientos ni notas: esa lectura sigue denegada. El detalle es
 * mínimo, sin `tokenIdentifier`, acompañamientos ni notas. Opera con datos
 * ficticios.
 */

const accountSummaryValidator = v.object({
  _id: v.id("users"),
  email: v.string(),
  fullName: v.string(),
  role: roleUnion,
  institutionalStatus: institutionalStatusUnion,
  accountStatus: accountStatusUnion,
  enabledBy: v.optional(v.id("users")),
  enabledAt: v.optional(v.number()),
  revokedBy: v.optional(v.id("users")),
  revokedAt: v.optional(v.number()),
});

/** Lista paginada de cuentas con detalle mínimo. Solo Administrador. */
export const listAccounts = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(accountSummaryValidator),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return await listAccountsUseCase(ctx, identity, args);
  },
});

/** Detalle mínimo de una cuenta. Solo Administrador. */
export const getAccount = query({
  args: { userId: v.id("users") },
  returns: accountSummaryValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return await getAccountDetailUseCase(ctx, identity, args);
  },
});

/**
 * Habilita una cuenta profesional o administrativa pendiente o revocada.
 * Registra actor y fecha. El practicante no entra por esta vía (TI2-140).
 */
export const enableAccount = mutation({
  args: { userId: v.id("users") },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return await enableStaffAccount(ctx, identity, args);
  },
});

/**
 * Revoca una cuenta profesional o administrativa habilitada.
 * Registra actor y fecha; la cuenta deja de operar en la petición siguiente.
 */
export const revokeAccount = mutation({
  args: { userId: v.id("users") },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return await revokeStaffAccount(ctx, identity, args);
  },
});
