import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  accompanimentStatusUnion,
  accountStatusUnion,
  assignmentRoleUnion,
  assignmentStatusUnion,
  institutionalStatusUnion,
  requestStatusUnion,
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
    // Auditoría de habilitación institucional (TI2-11): actor administrador y
    // fecha de la habilitación. Solo la fija la vía guardada de cuentas; el
    // arranque administrativo inicial deja `enabledBy` ausente y documenta el
    // procedimiento por entorno en `domain/accounts/enablement.md`.
    enabledBy: v.optional(v.id("users")),
    enabledAt: v.optional(v.number()),
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
  // `requestId` traza la solicitud aceptada que lo originó, si se conoce.
  accompaniments: defineTable({
    studentId: v.id("users"),
    status: accompanimentStatusUnion,
    objective: v.string(),
    accessNeeds: v.string(),
    requestId: v.optional(v.id("requests")),
  })
    .index("by_student", ["studentId"])
    .index("by_request", ["requestId"]),

  // Tabla 'accompanimentAssignments': asignaciones revocables por
  // acompañamiento. Separa habilitación de cuenta y asignación explícita.
  // Invariante: como máximo una fila activa por cada combinación de
  // acompañamiento, usuario y rol; la única vía de escritura son las
  // mutaciones internas guardadas `internal.assignments.assign` y
  // `internal.assignments.revoke`. La trazabilidad de filas legacy vive en
  // `migrations` (TI2-17): la auditoría las detecta sin inventar actor ni
  // fecha y la migración revoca las activas sin concesión con la revocación
  // real del operador.
  accompanimentAssignments: defineTable({
    accompanimentId: v.id("accompaniments"),
    userId: v.id("users"),
    assignedRole: assignmentRoleUnion,
    status: assignmentStatusUnion,
    // Trazabilidad de la vigencia: quién concede y cuándo, y quién revoca
    // y cuándo. Solo persistencia, sin reglas de autorización.
    grantedBy: v.optional(v.id("users")),
    grantedAt: v.optional(v.number()),
    revokedBy: v.optional(v.id("users")),
    revokedAt: v.optional(v.number()),
  })
    // Paginado keyset del listado asignado: ordena por acompañamiento para
    // que las filas duplicadas queden adyacentes y el cursor las excluya
    // enteras.
    .index("by_user_and_status_and_assigned_role_and_accompaniment", [
      "userId",
      "status",
      "assignedRole",
      "accompanimentId",
    ])
    // Chequeo de presencia exacto: una fila basta para decidir, sin lecturas
    // ilimitadas.
    .index("by_accompaniment_and_user_and_status_and_assigned_role", [
      "accompanimentId",
      "userId",
      "status",
      "assignedRole",
    ]),

  // Tabla 'followUpNotes': notas internas breves. Solo profesionales
  // autorizados del acompañamiento pueden leerlas.
  followUpNotes: defineTable({
    accompanimentId: v.id("accompaniments"),
    authorId: v.id("users"),
    body: v.string(),
  }).index("by_accompaniment", ["accompanimentId"]),

  // Tabla 'requests': solicitudes de acompañamiento. El estado usa los
  // literales de Sprint 1 del dominio (TI2-7); `createdAt` es la fecha de
  // creación como número. Solo persistencia: las transiciones las aplica TI2-21.
  requests: defineTable({
    studentId: v.id("users"),
    status: requestStatusUnion,
    accessNeeds: v.string(),
    createdAt: v.number(),
  })
    // Solicitudes propias del estudiante.
    .index("by_student", ["studentId"])
    // Solicitudes según su estado de revisión.
    .index("by_status", ["status"])
    // Solicitudes propias en un estado dado: pertenencia y estado en una
    // sola lectura para Sprint 1, sin filtrar en memoria.
    .index("by_student_and_status", ["studentId", "status"]),
});
