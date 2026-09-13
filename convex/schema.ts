import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  accompanimentStatusUnion,
  accountStatusUnion,
  assignmentRoleUnion,
  assignmentStatusUnion,
  institutionalStatusUnion,
  roleUnion,
} from "./validators";

/**
 * Esquema de base de datos Convex para la gestión de usuarios y
 * acompañamientos mínimos de autorización (S2).
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

  // Tabla 'accompaniments': acompañamiento mínimo para probar la matriz.
  // `accessNeeds` es sensible (Ley 21.719) y se minimiza para Practicante.
  accompaniments: defineTable({
    studentId: v.id("users"),
    status: accompanimentStatusUnion,
    objective: v.string(),
    accessNeeds: v.string(),
  }).index("by_student", ["studentId"]),

  // Tabla 'accompanimentAssignments': asignaciones revocables por
  // acompañamiento. Separa habilitación de cuenta y asignación explícita.
  accompanimentAssignments: defineTable({
    accompanimentId: v.id("accompaniments"),
    userId: v.id("users"),
    assignedRole: assignmentRoleUnion,
    status: assignmentStatusUnion,
  })
    .index("by_accompaniment", ["accompanimentId"])
    .index("by_user", ["userId"])
    .index("by_accompaniment_and_user", ["accompanimentId", "userId"]),

  // Tabla 'followUpNotes': notas internas breves. Solo profesionales
  // autorizados del acompañamiento pueden leerlas.
  followUpNotes: defineTable({
    accompanimentId: v.id("accompaniments"),
    authorId: v.id("users"),
    body: v.string(),
  }).index("by_accompaniment", ["accompanimentId"]),
});
