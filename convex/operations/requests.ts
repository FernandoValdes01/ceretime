import { v } from "convex/values";
import { env, internalMutation, internalQuery } from "../_generated/server";
import { requestStatusUnion } from "../infrastructure/validators";

/**
 * Módulo de funciones internas para la entidad 'requests'.
 * Operan con el esquema oficial de Convex y datos ficticios.
 * Solo persistencia: las transiciones de estado las aplica TI2-21, aquí no
 * se valida ningún cambio de estado.
 */

/**
 * Crea una solicitud ficticia de prueba para validar persistencia y estados.
 *
 * Misma guardia que `createTestUser`: solo opera con `TEST_SEEDS_ENABLED ===
 * "true"`, así que en producción se rechaza.
 */
export const createTestRequest = internalMutation({
  args: {
    studentId: v.id("users"),
    status: requestStatusUnion,
    accessNeeds: v.string(),
  },
  handler: async (ctx, args) => {
    if (env.TEST_SEEDS_ENABLED !== "true") {
      throw new Error("Las semillas de prueba no están habilitadas en este entorno");
    }
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
