import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import {
  acceptRequest as acceptRequestUseCase,
  registerRequest,
  requestAdditionalInformation as requestAdditionalInformationUseCase,
  takeRequest as takeRequestUseCase,
} from "../application/requests/commands";
import {
  listAuthorizedRequestsUseCase,
  listOpenRequestsUseCase,
  listOwnRequestsUseCase,
} from "../application/requests/queries";
import { mutation, query } from "../_generated/server";
import { requestStatusUnion } from "../validators";
import { acceptedAccompanimentValidator } from "./accompaniments";

/**
 * Borde de Presentación: solicitudes del Estudiante (TI2-9) y API pública de
 * mutations del Sprint 1 (TI2-26).
 *
 * Adaptador delgado: valida la entrada, resuelve la identidad en el servidor
 * con `ctx.auth.getUserIdentity()` y delega en Aplicación. Nunca acepta un
 * `userId` del cliente como prueba ni toca `ctx.db` directamente.
 *
 * Toda denegación responde con el mismo error genérico, sin exponer el
 * motivo. Opera con datos ficticios.
 *
 * TI2-26: las cuatro mutations de abajo son toda la escritura pública del
 * Sprint 1; la habilitación de cuentas y la concesión de accesos siguen en
 * las vías internas guardadas (`internal.accounts`, `internal.assignments`) y
 * el Sprint 1 no usa `action` (sin integraciones que lo requieran: OAuth corre
 * por las rutas HTTP de Better Auth).
 */

const requestBaseFields = {
  _id: v.id("requests"),
  studentId: v.id("users"),
  status: requestStatusUnion,
  createdAt: v.number(),
};

const requestValidator = v.object({
  ...requestBaseFields,
  accessNeeds: v.string(),
});

const minimizedRequestValidator = v.object(requestBaseFields);

/**
 * Registra la solicitud del Estudiante en estado `received`. Solo una
 * cuenta de Estudiante habilitada y vigente puede registrar; cualquier otro
 * caso recibe denegación.
 */
export const createRequest = mutation({
  args: { accessNeeds: v.string() },
  returns: requestValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return await registerRequest(ctx, identity, args);
  },
});

/**
 * Lista las solicitudes propias del Estudiante, paginado.
 * Cualquier otro rol recibe denegación.
 */
export const listOwnRequests = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(requestValidator),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return await listOwnRequestsUseCase(ctx, identity, args);
  },
});

/**
 * Lista las solicitudes tomadas por el Profesional, paginado. Sin toma
 * activa no hay acceso. Cualquier otro rol recibe denegación.
 */
export const listAuthorizedRequests = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(requestValidator),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return await listAuthorizedRequestsUseCase(ctx, identity, args);
  },
});

/**
 * Bandeja de triage para el Profesional, paginado y con vista minimizada
 * (sin `accessNeeds`). Solo descubrir, no autoriza a operar. Cualquier otro
 * rol recibe denegación.
 */
export const listOpenRequests = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(minimizedRequestValidator),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return await listOpenRequestsUseCase(ctx, identity, args);
  },
});

/**
 * Toma una solicitud para revisión. Solo el propio Profesional con cuenta
 * vigente; una toma activa existente se rechaza.
 */
export const takeRequest = mutation({
  args: { requestId: v.id("requests") },
  returns: requestValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return await takeRequestUseCase(ctx, identity, args);
  },
});

/**
 * Pide información adicional al Estudiante sobre una solicitud en revisión.
 * Solo un Profesional con cuenta vigente; el motivo es obligatorio.
 */
export const requestAdditionalInformation = mutation({
  args: { requestId: v.id("requests"), reason: v.string() },
  returns: requestValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return await requestAdditionalInformationUseCase(ctx, identity, args);
  },
});

/**
 * Acepta la solicitud y abre exactamente un acompañamiento (TI2-24).
 * Solo el Profesional con toma activa y cuenta vigente; el objetivo es
 * obligatorio. Repetir la aceptación se rechaza sin duplicar.
 */
export const acceptRequest = mutation({
  args: { requestId: v.id("requests"), objective: v.string() },
  returns: acceptedAccompanimentValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return await acceptRequestUseCase(ctx, identity, args);
  },
});
