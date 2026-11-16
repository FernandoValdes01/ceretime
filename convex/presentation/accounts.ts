import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import {
  enableInternByProfessional,
  enableStaffAccount,
  enableTestProfessionalAccount,
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
import { unwrapApiResult } from "./session";

/**
 * Borde de Presentación: cuentas profesionales y administrativas (TI2-137)
 * más habilitación de practicantes y cuenta de prueba por el profesional
 * (TI2-140).
 *
 * Adaptador delgado: valida la entrada, resuelve la identidad en el servidor
 * con `ctx.auth.getUserIdentity()` y delega en Aplicación, que carga el
 * perfil con Infraestructura y decide con Dominio. Nunca acepta un `userId`
 * del cliente como prueba ni toca `ctx.db` directamente.
 *
 * Solo el Administrador con cuenta habilitada y vigente lista, lee,
 * habilita y revoca cuentas de personal (profesional o administrador),
 * filtradas por rol con el índice `by_role`. El profesional de personal con
 * cuenta habilitada y vigente habilita practicantes pendientes y cuentas de
 * prueba `@alu.uct.cl` como profesional de prueba; el administrador también
 * puede hacerlo por esta vía. La cuenta de prueba jamás habilita. Habilitar
 * no concede acompañamientos: la lectura exige cuenta habilitada y asignación
 * activa y vigente. Los errores usan el contrato común de TI2-88 (`ConvexError({code, message})`
 * vía `unwrapApiResult`): `unauthorized` ante falta de identidad, perfil o
 * vigencia, rol ajeno u objetivo inexistente o fuera de esta vía, y
 * `conflict` ante un tránsito inválido que un llamante autorizado puede
 * explicar. Administrar no concede acompañamientos ni notas: esa lectura
 * sigue denegada. El detalle es mínimo, sin `tokenIdentifier`,
 * acompañamientos ni notas. Opera con datos ficticios.
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

const accountIdValidator = v.object({ userId: v.id("users") });

/** Lista paginada de cuentas de personal, filtrada por rol. Solo Administrador. */
export const listAccounts = query({
  args: {
    role: v.union(v.literal("professional"), v.literal("admin")),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(accountSummaryValidator),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(await listAccountsUseCase(ctx, identity, args));
  },
});

/** Detalle mínimo de una cuenta de personal. Solo Administrador. */
export const getAccount = query({
  args: { userId: v.id("users") },
  returns: accountSummaryValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(await getAccountDetailUseCase(ctx, identity, args));
  },
});

/**
 * Habilita una cuenta profesional o administrativa pendiente o revocada.
 * Registra actor y fecha. El practicante no entra por esta vía (TI2-140).
 */
export const enableAccount = mutation({
  args: { userId: v.id("users") },
  returns: accountIdValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(await enableStaffAccount(ctx, identity, args));
  },
});

/**
 * Revoca una cuenta profesional o administrativa habilitada.
 * Registra actor y fecha; la cuenta deja de operar en la petición siguiente.
 */
export const revokeAccount = mutation({
  args: { userId: v.id("users") },
  returns: accountIdValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(await revokeStaffAccount(ctx, identity, args));
  },
});

/**
 * Habilita una cuenta de practicante pendiente (TI2-140, RF-39).
 *
 * La llama el profesional de personal con cuenta habilitada y vigente (o el
 * administrador por esta misma vía) y registra actor y fecha. Habilitar no
 * concede acompañamientos: el practicante solo lee lo que el profesional
 * autorizado le asigne después.
 */
export const enableIntern = mutation({
  args: { userId: v.id("users") },
  returns: accountIdValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(await enableInternByProfessional(ctx, identity, args));
  },
});

/**
 * Habilita una cuenta `@alu.uct.cl` como profesional de prueba (TI2-140, RF-38/RN-25).
 *
 * La llama el administrador vigente o el profesional de personal vigente y
 * registra actor y fecha. La cuenta de prueba jamás habilita. Habilitar no
 * concede acompañamientos: la cuenta de prueba solo opera dentro de
 * acompañamientos explícitamente asignados y auditados, con cuenta habilitada
 * y asignación vigente.
 */
export const enableTestProfessional = mutation({
  args: { userId: v.id("users") },
  returns: accountIdValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(await enableTestProfessionalAccount(ctx, identity, args));
  },
});
