import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { accountStatusUnion, institutionalStatusUnion, roleUnion } from "./validators";

/**
 * Esquema de base de datos Convex para la gestión de usuarios.
 * NOTA: Este esquema opera exclusivamente con DATOS FICTICIOS durante desarrollo y pruebas.
 */
export default defineSchema({
  // Tabla 'users': Registro de identidad, rol y estados institucionales
  users: defineTable({
    email: v.string(),
    fullName: v.string(),
    role: roleUnion,
    institutionalStatus: institutionalStatusUnion,
    accountStatus: accountStatusUnion,
    // Clave estable hacia la identidad autenticada
    // (`ctx.auth.getUserIdentity().tokenIdentifier`); solo ficticia en pruebas.
    tokenIdentifier: v.string(),
  })
    // Índice para búsquedas rápidas por correo electrónico
    .index("by_email", ["email"])
    // Índice para filtrado de usuarios según su rol
    .index("by_role", ["role"])
    // Índice para consulta según habilitación institucional
    .index("by_institutional_status", ["institutionalStatus"])
    // Índice para vincular el perfil con la identidad autenticada
    .index("by_token_identifier", ["tokenIdentifier"]),
});
