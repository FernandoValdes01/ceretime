import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import {
  registerRequest,
  requestAdditionalInformation as requestAdditionalInformationUseCase,
} from "../application/requests/commands";
import {
  listAuthorizedRequestsUseCase,
  listOwnRequestsUseCase,
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

const requestValidator = v.object({
  _id: v.string(),
  studentId: v.string(),
  status: requestStatusUnion,
  accessNeeds: v.string(),
  createdAt: v.number(),
});

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
 * Lista todas las solicitudes de estudiantes para el Profesional, paginado.
 * Definición de alcance (TI2-9): todo Profesional vigente ve todas, vista
 * completa. Cualquier otro rol recibe denegación.
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
