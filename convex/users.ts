import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const roleUnion = v.union(
  v.literal("student"),
  v.literal("professional"),
  v.literal("intern"),
  v.literal("admin"),
);

const institutionalStatusUnion = v.union(
  v.literal("enabled"),
  v.literal("disabled"),
  v.literal("pending"),
);

const accountStatusUnion = v.union(v.literal("active"), v.literal("inactive"));

/**
 * Crea un usuario de prueba para validar persistencia, roles y estados.
 */
export const createTestUser = internalMutation({
  args: {
    email: v.string(),
    fullName: v.string(),
    role: roleUnion,
    institutionalStatus: institutionalStatusUnion,
    accountStatus: accountStatusUnion,
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
