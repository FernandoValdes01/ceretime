import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { accountStatusUnion, institutionalStatusUnion, roleUnion } from "./validators";

/**
 * Módulo de funciones internas para la entidad 'users'.
 * Operan con el esquema oficial de Convex y datos ficticios.
 */

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
    tokenIdentifier: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("users", args);
  },
});

/**
 * Consulta un usuario ficticio por su ID interno.
 */
export const getUserById = internalQuery({
  args: { id: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Consulta un usuario ficticio por su identificador de identidad.
 * Vincula el perfil persistido con la identidad autenticada
 * (`ctx.auth.getUserIdentity().tokenIdentifier`).
 */
export const getUserByTokenIdentifier = internalQuery({
  args: { tokenIdentifier: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", args.tokenIdentifier))
      .unique();
  },
});
