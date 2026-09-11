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
 * Handlers internos expuestos para pruebas unitarias de persistencia.
 */
export const createTestUserHandler = async (ctx: any, args: any) => {
  return await ctx.db.insert("users", args);
};

export const getUserByIdHandler = async (ctx: any, args: { id: any }) => {
  return await ctx.db.get(args.id);
};

/**
 * Crea un usuario ficticio de prueba para validar persistencia, roles y estados.
 */
export const createTestUser = internalMutation({
  args: {
    email: v.string(),
    fullName: v.string(),
    role: roleUnion,
    institutionalStatus: institutionalStatusUnion,
    accountStatus: accountStatusUnion,
  },
  handler: createTestUserHandler,
});

/**
 * Consulta un usuario ficticio por su ID interno.
 */
export const getUserById = internalQuery({
  args: { id: v.id("users") },
  handler: getUserByIdHandler,
});
