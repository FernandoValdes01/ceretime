import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  accompanimentStatusUnion,
  accountStatusUnion,
  appointmentStatusUnion,
  assignmentRoleUnion,
  assignmentStatusUnion,
  availabilityExceptionKindUnion,
  institutionalStatusUnion,
  modalityUnion,
  persistableRequestStatusUnion,
  roleUnion,
} from "./infrastructure/validators";

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
  // mutaciones internas guardadas `internal.operations.assignments.assign` y
  // `internal.operations.assignments.revoke`. La trazabilidad de filas legacy vive en
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
  // literales persistibles del dominio (Sprint 1 de TI2-7 más la cancelación
  // y el cierre de TI2-85, sin `referred`); el contrato de presentación
  // conserva los 4 estados hasta el mapping de TI2-85. `createdAt` es la
  // fecha de creación como número. Solo persistencia: las transiciones las
  // aplica TI2-21 y las reglas de cancelación son de TI2-85.
  requests: defineTable({
    studentId: v.id("users"),
    status: persistableRequestStatusUnion,
    accessNeeds: v.string(),
    createdAt: v.number(),
    // Profesional que la tomó para revisión, si alguien la tomó. Puntero de
    // lectura para el listado autorizado: cada solicitud aparece una sola
    // vez por construcción. Lo fija `takeRequest` junto a la toma.
    takenBy: v.optional(v.id("users")),
  })
    // Solicitudes propias del estudiante.
    .index("by_student", ["studentId"])
    // Solicitudes según su estado de revisión.
    .index("by_status", ["status"])
    // Solicitudes propias en un estado dado: pertenencia y estado en una
    // sola lectura para Sprint 1, sin filtrar en memoria.
    .index("by_student_and_status", ["studentId", "status"])
    // Solicitudes tomadas por cada profesional: base del listado
    // autorizado, una fila por solicitud.
    .index("by_takenBy", ["takenBy"]),

  // Tabla 'requestTransitions': bitácora append-only de cambios de estado.
  // Cada transición guarda motivo, actor y fecha junto al estado resultante,
  // en la misma transacción. Solo se escribe, nunca se modifica.
  requestTransitions: defineTable({
    requestId: v.id("requests"),
    from: persistableRequestStatusUnion,
    to: persistableRequestStatusUnion,
    actorId: v.id("users"),
    reason: v.optional(v.string()),
    occurredAt: v.number(),
  }).index("by_request", ["requestId"]),

  // Tabla 'requestAssignments': tomas de solicitudes por Profesionales.
  // Relación explícita que autoriza a operar una solicitud: como máximo una
  // fila activa por solicitud y usuario. Solo el propio Profesional toma
  // (nadie asigna a otro); queda auditado quién y cuándo.
  requestAssignments: defineTable({
    requestId: v.id("requests"),
    userId: v.id("users"),
    grantedBy: v.id("users"),
    grantedAt: v.number(),
    status: assignmentStatusUnion,
    revokedBy: v.optional(v.id("users")),
    revokedAt: v.optional(v.number()),
  })
    .index("by_request_and_user_and_status", ["requestId", "userId", "status"])
    .index("by_user_and_status", ["userId", "status"])
    // Barrido autorizado con duplicadas adyacentes: ordena por solicitud
    // para que las filas de la misma solicitud queden contiguas y el cursor
    // solo recuerde la última emitida (O(1)), sin historial lineal.
    .index("by_user_and_status_and_request", ["userId", "status", "requestId"]),

  // Tabla 'spaces': catálogo de espacios presenciales (TI2-83). Cada fila
  // identifica una sala por campus, edificio, piso y sala, con sus
  // condiciones de acceso e instrucciones de llegada compatibles con lector
  // de pantalla. `isActive` permite retirar una sala del catálogo sin
  // borrar el historial de atenciones que la usaron. Solo persistencia: el
  // catálogo autorizado lo publica TI2-99 y los repositorios los
  // implementa TI2-95.
  spaces: defineTable({
    campus: v.string(),
    building: v.string(),
    floor: v.string(),
    room: v.string(),
    accessConditions: v.string(),
    accessInstructions: v.string(),
    isActive: v.boolean(),
  })
    // Catálogo vigente: lo que TI2-99 lista como reservable.
    .index("by_isActive", ["isActive"])
    // Sala exacta por sede: ubica la fila y detecta el duplicado lógico
    // (mismo campus, edificio, piso y sala) sin barrer el catálogo.
    .index("by_campus_and_building_and_floor_and_room", ["campus", "building", "floor", "room"]),

  // Tabla 'availabilityBlocks': bloques recurrentes de cada profesional
  // (TI2-83). Cada fila declara un día de semana (`weekday` 0=domingo a
  // 6=sábado), una ventana en minutos desde las 00:00 (`startMinute` a
  // `endMinute`), la duración de cada cupo en minutos (`slotMinutes`, nombre
  // acordado con TI2-81: una ventana de 09:00 a 12:00 con cupos de 30 no es
  // lo mismo que con cupos de 60) y la modalidad; `spaceId` acompaña al
  // bloque presencial y queda ausente en el bloque en línea. `isActive`
  // retira un bloque sin borrarlo. Solo persistencia: la prevención de
  // cruces la aplica la operación atómica de TI2-84 sobre estos índices y
  // las reglas de duración son de TI2-81.
  availabilityBlocks: defineTable({
    professionalId: v.id("users"),
    weekday: v.number(),
    startMinute: v.number(),
    endMinute: v.number(),
    slotMinutes: v.number(),
    modality: modalityUnion,
    spaceId: v.optional(v.id("spaces")),
    isActive: v.boolean(),
  })
    // Bloques del profesional.
    .index("by_professionalId", ["professionalId"])
    // Bloques del profesional en un día de semana: base de la vista diaria
    // y de la detección de cruces entre bloques.
    .index("by_professionalId_and_weekday", ["professionalId", "weekday"])
    // Bloques vigentes del profesional en un día de semana: lo que la vista
    // diaria ofrece y lo que la detección de cruces considera, sin filtrar
    // en memoria.
    .index("by_professionalId_and_weekday_and_isActive", ["professionalId", "weekday", "isActive"])
    // Bloques que usan una sala: base de la detección de cruces por sala.
    .index("by_spaceId", ["spaceId"]),

  // Tabla 'availabilityExceptions': excepciones puntuales a la recurrencia
  // (TI2-83). `date` es el inicio del día afectado en milisegundos de época
  // (00:00 UTC); `kind` cancela disponibilidad (`cancelled`, con `blockId`
  // al bloque recurrente afectado, que aporta ventana, duración, modalidad
  // y lugar) o la agrega (`added`, con su propia ventana completa:
  // `startMinute`/`endMinute`, `slotMinutes`, `modality` y `spaceId` cuando
  // es presencial, ausente en línea). `reason` deja constancia opcional del
  // motivo. Solo persistencia, sin reglas de autorización; las reglas de
  // ventanas y compatibilidad son de TI2-81/TI2-82.
  availabilityExceptions: defineTable({
    professionalId: v.id("users"),
    date: v.number(),
    kind: availabilityExceptionKindUnion,
    blockId: v.optional(v.id("availabilityBlocks")),
    startMinute: v.optional(v.number()),
    endMinute: v.optional(v.number()),
    slotMinutes: v.optional(v.number()),
    modality: v.optional(modalityUnion),
    spaceId: v.optional(v.id("spaces")),
    reason: v.optional(v.string()),
  })
    // Excepciones del profesional en un día: lo que la vista diaria descuenta
    // o agrega sobre los bloques recurrentes.
    .index("by_professionalId_and_date", ["professionalId", "date"])
    // Excepciones de todos los profesionales en un día: barrido operativo
    // de la fecha.
    .index("by_date", ["date"]),

  // Tabla 'appointments': la única atención creada al reservar (TI2-83, no
  // existe otra tabla `reservations`). Cada fila es una ocurrencia concreta
  // (`startsAt` a `endsAt` en milisegundos de época) vinculada a un
  // acompañamiento y a sus usuarios; `studentId` duplica al dueño para
  // listarlo sin uniones, igual que `requests` y `accompaniments`.
  // `spaceId` acompaña a la atención presencial y queda ausente en línea.
  // `originalStartsAt` conserva la fecha original al reagendar y
  // `cancelReason` guarda el motivo (obligatorio para CERETI, opcional para
  // el estudiante; la distinción la aplica la capa de aplicación, no el
  // esquema). La cola de inasistencias por estado (`no_show`) para la
  // justificación con plazo de cinco días hábiles queda para la extensión
  // futura de justificación, no para este esquema. Solo persistencia: la
  // ocupación atómica de cupo es TI2-84 y los repositorios son TI2-95.
  appointments: defineTable({
    accompanimentId: v.id("accompaniments"),
    studentId: v.id("users"),
    professionalId: v.id("users"),
    spaceId: v.optional(v.id("spaces")),
    modality: modalityUnion,
    status: appointmentStatusUnion,
    startsAt: v.number(),
    endsAt: v.number(),
    originalStartsAt: v.optional(v.number()),
    cancelReason: v.optional(v.string()),
    createdAt: v.number(),
  })
    // Atenciones propias del estudiante.
    .index("by_studentId", ["studentId"])
    // Atenciones propias desde un instante: ventana del estudiante sin
    // filtrar en memoria.
    .index("by_studentId_and_startsAt", ["studentId", "startsAt"])
    // Agenda del profesional.
    .index("by_professionalId", ["professionalId"])
    // Agenda del profesional desde un instante: ventana para la vista
    // diaria y para la detección de cruces entre profesionales.
    .index("by_professionalId_and_startsAt", ["professionalId", "startsAt"])
    // Ocupación de la sala.
    .index("by_spaceId", ["spaceId"])
    // Ocupación de la sala desde un instante: ventana para la detección de
    // cruces por sala.
    .index("by_spaceId_and_startsAt", ["spaceId", "startsAt"])
    // Atenciones del acompañamiento.
    .index("by_accompanimentId", ["accompanimentId"]),
});
