import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/**
 * Crea un usuario de prueba para validar persistencia, roles y estados.
 */
export const createTestUser = internalMutation({
  args: {
    email: v.string(),
    name: v.string(),
    role: v.string(),
    status: v.string(),
  },

  handler: async (ctx, args) => {
    return await ctx.db.insert("users", args);
  },
});

/**
 * Consulta un usuario por su ID interno.
 */
export const getUserById = internalQuery({
  args: { id: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});