import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import {
  registerRequest,
  requestAdditionalInformation as requestAdditionalInformationUseCase,
  takeRequest as takeRequestUseCase,
} from "../application/requests/commands";
import {
  listAuthorizedRequestsUseCase,
  listOpenRequestsUseCase,
  listOwnRequestsUseCase,
  getRequestDetailUseCase,
} from "../application/requests/queries";
import { mutation, query } from "../_generated/server";
import { requestStatusUnion } from "../validators";

/**
 * Borde de Presentación: solicitudes del Estudiante (TI2-9).
 *
 * Adaptador delgado: valida la entrada, resuelve la identidad en el servidor
 * con `ctx.auth.getUserIdentity()` y delega en Aplicación. Nunca acepta un
 * `userId` del cliente como prueba ni toca `ctx.db` directamente.
 *
 * Toda denegación responde con el mismo error genérico, sin exponer el
 * motivo. Opera con datos ficticios.
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
 * Detalle de una solicitud propia o tomada (TI2-10).
 *
 * El Estudiante solo detalla sus solicitudes y el Profesional solo las que
 * tomó; el resto recibe la denegación genérica sin revelar existencia. La
 * bandeja minimizada sigue siendo la única vía de descubrimiento.
 */
export const getRequest = query({
  args: { requestId: v.id("requests") },
  returns: requestValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return await getRequestDetailUseCase(ctx, identity, args);
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
