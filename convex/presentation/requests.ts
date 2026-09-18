import { v } from "convex/values";
import { registerRequest } from "../application/requests/commands";
import { mutation } from "../_generated/server";
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
