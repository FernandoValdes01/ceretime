import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { requestStatusUnion } from "./validators";

/**
 * Módulo de funciones internas para la entidad 'requests'.
 * Operan con el esquema oficial de Convex y datos ficticios.
 * Solo persistencia: las transiciones de estado las aplica TI2-21, aquí no
 * se valida ningún cambio de estado.
 */

/**
 * Crea una solicitud ficticia de prueba para validar persistencia y estados.
 */
export const createTestRequest = internalMutation({
  args: {
    studentId: v.id("users"),
    status: requestStatusUnion,
    accessNeeds: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("requests", { ...args, createdAt: Date.now() });
  },
});

/**
 * Consulta una solicitud ficticia por su ID interno.
 */
export const getRequestById = internalQuery({
  args: { id: v.id("requests") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
