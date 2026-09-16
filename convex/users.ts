import { v } from "convex/values";
import { env, internalMutation, internalQuery } from "./_generated/server";
import { normalizeEmail } from "./domain/auth/institutional_domain";
import { findUserByEmail } from "./infrastructure/accounts/repository";
import { accountStatusUnion, institutionalStatusUnion, roleUnion } from "./validators";

/**
 * Módulo de funciones internas para la entidad 'users'.
 * Operan con el esquema oficial de Convex y datos ficticios.
 */

/**
 * Crea un usuario ficticio de prueba para validar persistencia, roles y estados.
 *
 * Solo opera cuando el operador habilita las semillas en el entorno
 * (`TEST_SEEDS_ENABLED === "true"`, variable de servidor no controlable por
 * el cliente): en producción la variable permanece ausente y la llamada se
 * rechaza. Además, jamás crea administradores: la única vía de creación
 * administrativa es el arranque controlado `internal.accounts.ensureBootstrapAdmin`.
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
    if (env.TEST_SEEDS_ENABLED !== "true") {
      throw new Error("Las semillas de prueba no están habilitadas en este entorno");
    }
    if (args.role === "admin") {
      throw new Error("Las semillas de prueba no pueden crear administradores");
    }
    const existing = await ctx.db
      .query("users")
      .withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", args.tokenIdentifier))
      .unique();
    if (existing !== null) {
      throw new Error("Ya existe un perfil para esta identidad");
    }
    // Unicidad de correo (TI2-17): se normaliza antes de buscar e insertar
    // para que diferencias de mayúsculas o espacios no creen duplicados
    // lógicos; dos perfiles con el mismo correo romperían la búsqueda por
    // identidad en `by_email`.
    const email = normalizeEmail(args.email);
    const emailTaken = await findUserByEmail(ctx, email);
    if (emailTaken !== null) {
      throw new Error("Ya existe un perfil con este correo");
    }
    return await ctx.db.insert("users", { ...args, email });
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
