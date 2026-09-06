import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
    users: defineTable({
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
        estadoCuenta: v.union(
            v.literal("activo"),
            v.literal("inactivo")
        ),
    })
    .index("by_email", ["email"])
    .index("by_rol", ["rol"])
    .index("by_estado_institucional", ["estadoInstitucional"])
}); 