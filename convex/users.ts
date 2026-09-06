import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const createTestUser = mutation({
    args: {
        email: v.string(),
        nombreCompleto: v.string(),
        rol: v.union(
            v.literal("estudiante"),
            v.literal("profesional"),
            v.literal("practicante"),
            v.literal("administrador")
        ),
        estadoInstitucional: v.union(
            v.literal("habilitado"),
            v.literal("deshabilitado"),
            v.literal("pendiente")
        ),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("users",{
            email: args.email,
            nombreCompleto: args.nombreCompleto,
            rol: args.rol,
            estadoInstitucional: args.estadoInstitucional,
            estadoCuenta: "activo",
        });
    },
});

export const getUserById = query({
    args: { userId: v.id("users")},
    handler: async ( ctx, args) => {
        return await ctx.db.get(args.userId)
    },
});