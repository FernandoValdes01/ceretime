import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  accessNeedSelectionValidator,
  accompanimentStatusUnion,
  accountStatusUnion,
  appointmentAuditActionUnion,
  appointmentStatusUnion,
  assignmentRoleUnion,
  assignmentStatusUnion,
  availabilityExceptionKindUnion,
  calendarSyncErrorCodeUnion,
  calendarSyncStatusUnion,
  followUpResponsibleUnion,
  followUpTaskStatusUnion,
  generalAvailabilityValidator,
  incomingReferralValidator,
  institutionalStatusUnion,
  justificationReviewUnion,
  modalityUnion,
  notificationContractVersionLiteral,
  notificationDeliveryChannelUnion,
  notificationDeliveryErrorUnion,
  notificationDeliveryStatusUnion,
  notificationEventKindUnion,
  outgoingReferralValidator,
  privacyBlockScopeUnion,
  privacyDataCategoryUnion,
  privacyRequestChannelUnion,
  privacyRequestContractVersionLiteral,
  privacyRequestKindUnion,
  privacyRequestResponseValidator,
  privacyRequestStatusUnion,
  privacyResponseDeliveryReceiptValidator,
  privacyResponseExtensionValidator,
  privacyResponseRuleUnion,
  privacyRetentionDispositionUnion,
  privacyRetentionExceptionKindUnion,
  requestStatusUnion,
  requestTakeStatusUnion,
  requestProvenanceValidator,
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
    // Auditoría de revocación (TI2-137): actor administrador y fecha de la
    // revocación de cuentas profesionales y administrativas. La revoca la vía
    // guardada de cuentas y deja `institutionalStatus` en `disabled`; la
    // habilitación posterior sobrescribe `enabledBy`/`enabledAt` sin borrar
    // este historial.
    revokedBy: v.optional(v.id("users")),
    revokedAt: v.optional(v.number()),
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
  // `closedById`, `closedAt` y `closureReason` son `cerradoPorId?`,
  // `cerradoEn?` y `motivoCierre?` del MER: los escribe una sola vez
  // `accompanimentStatusWriter` al cerrar (TI2-152), y ninguna lectura pública
  // los entrega. Pausar y reactivar solo cambian `status`.
  accompaniments: defineTable({
    studentId: v.id("users"),
    status: accompanimentStatusUnion,
    objective: v.string(),
    accessNeeds: v.string(),
    requestId: v.optional(v.id("requests")),
    closedById: v.optional(v.id("users")),
    closedAt: v.optional(v.number()),
    closureReason: v.optional(v.string()),
  })
    .index("by_student", ["studentId"])
    .index("by_request", ["requestId"]),

  // Tabla 'accompanimentTransitions', retirada (TI2-165): el historial de
  // TI2-152 no está en el MER. Se conserva solo para que sus filas sigan
  // siendo válidas hasta que `migrateRetiredFields` copie cada cierre a su
  // acompañamiento y las borre; nada nuevo la escribe ni la lee. Se quita del
  // esquema cuando `auditRetiredFields` dé cero en cada deployment.
  accompanimentTransitions: defineTable({
    accompanimentId: v.id("accompaniments"),
    from: accompanimentStatusUnion,
    to: accompanimentStatusUnion,
    actorId: v.id("users"),
    reason: v.optional(v.string()),
    occurredAt: v.number(),
  }).index("by_accompanimentId_and_occurredAt", ["accompanimentId", "occurredAt"]),

  // Tabla 'accompanimentAssignments': asignaciones revocables por
  // acompañamiento. Separa habilitación de cuenta y asignación explícita.
  // Invariante: como máximo una fila activa por cada combinación de
  // acompañamiento, usuario y rol; la única vía de escritura son las
  // mutaciones internas guardadas `internal.operations.assignments.assign` y
  // `internal.operations.assignments.revoke`. La trazabilidad de filas legacy
  // vive en `convex/operations/migrations.ts` (TI2-17): la auditoría
  // `internal.operations.migrations.auditAssignmentTraceability` las detecta
  // sin inventar actor ni fecha y la migración
  // `internal.operations.migrations.migrateLegacyAssignments` revoca las
  // activas sin concesión con la revocación real del operador.
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
    // Vigencia opcional de la asignación (TI2-138): desde y hasta cuándo vale
    // el acceso. Ausentes en las filas anteriores y cuando la asignación no
    // declara límites. La vigencia efectiva la sigue decidiendo `status`; estas
    // fechas solo permiten expresar una ventana sin inventar revocaciones.
    validFrom: v.optional(v.number()),
    validUntil: v.optional(v.number()),
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

  // Tabla 'requests': solicitudes de acompañamiento. El estado usa los siete
  // literales del dominio (`requestStatusUnion`): Sprint 1 de TI2-7, la
  // cancelación y el cierre de TI2-85 y, desde TI2-143, la derivación
  // `referred`. Es la misma unión que declara el contrato de presentación.
  // `createdAt` es la fecha de creación como número. Solo persistencia: las
  // transiciones las aplica TI2-21 y las reglas de cancelación y cierre son
  // de TI2-85. TI2-135 suma el contenido completo de la solicitud, su
  // procedencia y las derivaciones como campos opcionales: las filas
  // anteriores no los tienen y se leen igual (ver
  // `domain/database/integrity.md`).
  requests: defineTable({
    studentId: v.id("users"),
    status: requestStatusUnion,
    accessNeeds: v.string(),
    createdAt: v.number(),
    // Profesional que la tomó para revisión, si alguien la tomó. Puntero de
    // lectura para el listado autorizado: cada solicitud aparece una sola
    // vez por construcción. Lo fija `takeRequest` junto a la toma.
    takenBy: v.optional(v.id("users")),
    // Contenido completo que el estudiante entrega al solicitar (TI2-135),
    // con los nombres del contrato `AccompanimentRequestContent`. `accessNeeds`
    // sigue siendo el texto unido que entrega la API vigente; la lista
    // `accessNeedSelections` es la fuente estructurada de las mismas
    // condiciones y `otherAccessNeed` el texto libre adicional. Sin RUT,
    // diagnóstico, certificados ni área interna.
    needSummary: v.optional(v.string()),
    expectedOutcome: v.optional(v.string()),
    accessNeedSelections: v.optional(v.array(accessNeedSelectionValidator)),
    otherAccessNeed: v.optional(v.string()),
    modalityPreference: v.optional(modalityUnion),
    generalAvailability: v.optional(generalAvailabilityValidator),
    preferredAccessibleInformationChannel: v.optional(v.string()),
    // Procedencia (TI2-135): canal por el que llegó la solicitud. Una fila sin
    // ella nació por el canal del Estudiante (ver `requestProvenanceChannelOf`).
    provenance: v.optional(requestProvenanceValidator),
    // Derivación de entrada y de salida (TI2-135). Desde TI2-143 la de salida
    // se escribe junto con el estado `referred`.
    incomingReferral: v.optional(incomingReferralValidator),
    outgoingReferral: v.optional(outgoingReferralValidator),
    // Retirado (TI2-165): solo para que las filas anteriores sigan siendo válidas;
    // nada lo escribe ni lo lee. Lo vacía `operations/migrations:migrateRetiredFields`
    // y se quita del esquema cuando `auditRetiredFields` dé cero en cada deployment.
    closureReason: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
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
    from: requestStatusUnion,
    to: requestStatusUnion,
    actorId: v.id("users"),
    reason: v.optional(v.string()),
    occurredAt: v.number(),
  }).index("by_request", ["requestId"]),

  // Tabla 'requestAssignments': tomas de solicitudes por Profesionales
  // (TOMAS_SOLICITUD del MER). Relación explícita que autoriza a operar una
  // solicitud: como máximo una fila activa por solicitud y usuario. Solo el
  // propio Profesional toma (nadie asigna a otro); queda auditado quién y
  // cuándo. Desde TI4-84 tiene su propia unión de estados: liberar deja
  // `revoked` con quién y cuándo (`liberadaEn` del MER) y el fin de la
  // solicitud deja `finished` con `finishedAt`.
  requestAssignments: defineTable({
    requestId: v.id("requests"),
    userId: v.id("users"),
    grantedBy: v.id("users"),
    grantedAt: v.number(),
    status: requestTakeStatusUnion,
    revokedBy: v.optional(v.id("users")),
    revokedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
  })
    .index("by_request_and_user_and_status", ["requestId", "userId", "status"])
    .index("by_user_and_status", ["userId", "status"])
    // Barrido de «mis tomadas» con duplicadas adyacentes: ordena por
    // solicitud para que las filas de la misma solicitud queden contiguas y
    // el cursor solo recuerde la última emitida (O(1)). Sin estado en el
    // índice, porque el listado trae las activas y las terminadas (TI4-84).
    .index("by_user_and_request", ["userId", "requestId"]),

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
  // es presencial, ausente en línea). No guarda motivo, porque
  // EXCEPCIONES_DISPONIBILIDAD del MER no lo tiene (TI2-165). Solo
  // persistencia, sin reglas de autorización; las reglas de ventanas y
  // compatibilidad son de TI2-81/TI2-82.
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
    // Retirado (TI2-165): solo para que las filas anteriores sigan siendo válidas;
    // nada lo escribe ni lo lee. Lo vacía `operations/migrations:migrateRetiredFields`
    // y se quita del esquema cuando `auditRetiredFields` dé cero en cada deployment.
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
  // esquema). La justificación de inasistencia (TI2-119) vive en la misma
  // fila: la explicación, el instante de entrega, la recepción del respaldo
  // por canal institucional (solo constancia, sin archivo) y la revisión
  // `pending`/`accepted`/`rejected` que resuelve el Profesional asignado.
  // `calendarEventId` y `calendarEventAddedAt` guardan la referencia del
  // evento creado por TI2-122; el identificador es determinista y ausente
  // hasta la primera creación exitosa, así un reintento no duplica el evento.
  // `calendarEventStartsAt` y `calendarEventEndsAt` guardan el horario con el
  // que se sincronizó ese evento: si difieren de `startsAt`/`endsAt`, la
  // referencia quedó obsoleta y hay que actualizarla. Desde TI2-145 la misma
  // fila guarda el estado de sincronización automática (`pending`, `synced` o
  // `error`), sus intentos, el último intento y el código genérico del fallo;
  // no se crea una tabla paralela de estado por atención. Solo persistencia:
  // la ocupación atómica de cupo es TI2-84 y los repositorios son TI2-95.
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
    calendarEventId: v.optional(v.string()),
    calendarEventAddedAt: v.optional(v.number()),
    calendarEventStartsAt: v.optional(v.number()),
    calendarEventEndsAt: v.optional(v.number()),
    // Estado de la sincronización automática (TI2-145, TI2-162): las filas anteriores
    // no lo tienen y se leen sin error; `calendarSyncStateOf` las devuelve como
    // ausentes, no como pendientes inventadas. `calendarSyncErrorCode` reutiliza
    // los motivos genéricos del respaldo `.ics` y nunca copia respuestas del
    // proveedor. `calendarSyncScheduledAt` marca cuándo se programó el último
    // despacho para no programar otro mientras uno sigue en curso; `calendarEventOwnerId` guarda
    // de qué calendario es el evento (el `subject` de Better Auth que lo
    // creó), así actualizar y eliminar usan siempre ese calendario.
    calendarSyncStatus: v.optional(calendarSyncStatusUnion),
    calendarSyncAttempts: v.optional(v.number()),
    calendarSyncLastAttemptAt: v.optional(v.number()),
    calendarSyncErrorCode: v.optional(calendarSyncErrorCodeUnion),
    calendarSyncScheduledAt: v.optional(v.number()),
    calendarEventOwnerId: v.optional(v.string()),
    // Fallos seguidos sin éxito: el reintento los acota y los espera con
    // backoff. Se reinicia con cada éxito y con cada cambio nuevo.
    calendarSyncFailures: v.optional(v.number()),
    justificationExplanation: v.optional(v.string()),
    justificationSubmittedAt: v.optional(v.number()),
    justificationReview: v.optional(justificationReviewUnion),
    justificationReviewExplanation: v.optional(v.string()),
    supportingDocumentReceived: v.optional(v.boolean()),
    // Referencia del acceso privado de la atención en línea (TI2-138),
    // `urlPrivada?` de ATENCIONES. Opcional porque las atenciones presenciales
    // no la usan y las filas anteriores no la tienen. La atención no guarda
    // apoyos en línea: el MER no los tiene (TI2-165).
    privateAccessReference: v.optional(v.string()),
    createdAt: v.number(),
    // Retirado (TI2-165): solo para que las filas anteriores sigan siendo válidas;
    // nada lo escribe ni lo lee. Lo vacía `operations/migrations:migrateRetiredFields`
    // y se quita del esquema cuando `auditRetiredFields` dé cero en cada deployment.
    appliedAccessNeeds: v.optional(v.array(accessNeedSelectionValidator)),
    onlineSupports: v.optional(v.array(accessNeedSelectionValidator)),
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
    .index("by_accompanimentId", ["accompanimentId"])
    // Atenciones del acompañamiento por rango de inicio, sin filtrar en
    // memoria; también ordena el listado acotado del detalle (TI2-122).
    .index("by_accompanimentId_and_startsAt", ["accompanimentId", "startsAt"])
    // Atención que ya guarda un enlace privado (TI2-142): un enlace por
    // atención, así el mismo enlace no se reutiliza como sala fija.
    .index("by_privateAccessReference", ["privateAccessReference"])
    // Atenciones del centro por estado desde un instante: confirma los cruces
    // de un profesional adicional, porque su fila de participante no guarda
    // horario (TI2-165), sin leer las canceladas.
    .index("by_status_and_startsAt", ["status", "startsAt"])
    // Sincronización automática con Calendar (TI2-162): reintento de
    // pendientes no despachadas y de fallos recuperables, por el intento más
    // antiguo y sin barrer la tabla. `not_connected` pide volver a vincular y
    // no se reintenta solo.
    .index("by_calendarSyncStatus_and_scheduledAt", [
      "calendarSyncStatus",
      "calendarSyncScheduledAt",
    ])
    .index("by_calendarSyncStatus_and_lastAttemptAt", [
      "calendarSyncStatus",
      "calendarSyncLastAttemptAt",
    ]),

  // Tabla 'appointmentProfessionals': profesionales que participan en una
  // atención (TI2-138), ATENCION_PROFESIONALES del MER.
  // `appointments.professionalId` sigue siendo el profesional responsable
  // principal para conservar la compatibilidad; esta tabla registra el
  // conjunto completo sin crear otra atención ni otra asignación. No copia el
  // horario de la atención, porque el MER no lo tiene (TI2-165): los cruces se
  // leen de `appointments`. Como máximo una fila por atención y profesional;
  // la garantía la da la vía de escritura, porque Convex no impone unicidad.
  // El repositorio la mantiene al crear o mover la atención y la migración la
  // completa para las filas anteriores.
  appointmentProfessionals: defineTable({
    appointmentId: v.id("appointments"),
    professionalId: v.id("users"),
    // Retirado (TI2-165): solo para que las filas anteriores sigan siendo válidas;
    // nada lo escribe ni lo lee. Lo vacía `operations/migrations:migrateRetiredFields`
    // y se quita del esquema cuando `auditRetiredFields` dé cero en cada deployment.
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
  })
    // Participantes de la atención: una fila basta para decidir y el conjunto
    // se lee sin filtrar en memoria.
    .index("by_appointmentId_and_professionalId", ["appointmentId", "professionalId"])
    // Futuras donde el profesional participa (TI2-156, TI2-142): responsable o
    // adicional, para avisarle cuando su disponibilidad deja de cubrirlas.
    .index("by_professionalId", ["professionalId"]),

  // Tabla 'accompanimentNeeds': versiones de necesidades de acceso (TI2-156).
  // NECESIDADES_ACCESO del MER (`vigenteDesde`, `vigenteHasta?`): cada fila es
  // la versión vigente desde `validFrom` hasta `validUntil` (exclusivo;
  // ausente en la vigente). Actualizar cierra la vigente y crea una nueva con
  // `validFrom` en el instante del cambio, sin tocar `accompaniments`, que
  // conserva solo la copia vigente como caché. Las atenciones se evalúan con
  // la versión vigente a su `startsAt`, así las anteriores no cambian.
  accompanimentNeeds: defineTable({
    accompanimentId: v.id("accompaniments"),
    accessNeeds: v.string(),
    validFrom: v.number(),
    validUntil: v.optional(v.number()),
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
  }).index("by_accompanimentId_and_validFrom", ["accompanimentId", "validFrom"]),

  // Tabla 'notificationEvents': eventos de aviso con un único recurso
  // (atención o solicitud) y su destinatario (TI2-118, ampliada por TI2-145).
  // Cada fila guarda solo las referencias mínimas, la clase, el instante
  // persistido del cambio y la versión del contrato: no hay títulos, motivos,
  // notas ni datos del acompañamiento. `appointmentId` y `requestId` son
  // opcionales para que las filas anteriores sigan leyéndose; la vía de
  // escritura exige exactamente uno. Una justificación no tiene tabla propia:
  // referencia su atención, donde vive la explicación. `readAt` marca la
  // lectura de ese destinatario; ausente significa pendiente. Las entregas por
  // canal viven en `notificationDeliveries`, no en esta fila ni en otra tabla
  // de eventos. `idempotencyKey` es la clave de `notificationIdempotencyKey`;
  // un reintento del mismo cambio la repite y el repositorio devuelve la fila
  // existente en vez de crear otra.
  notificationEvents: defineTable({
    kind: notificationEventKindUnion,
    appointmentId: v.optional(v.id("appointments")),
    requestId: v.optional(v.id("requests")),
    // TI2-168: comunicación de una resolución de privacidad. Su recurso es una
    // solicitud de privacidad, no una solicitud de acompañamiento.
    privacyRequestId: v.optional(v.id("privacyRequests")),
    recipientId: v.id("users"),
    occurredAt: v.number(),
    version: notificationContractVersionLiteral,
    idempotencyKey: v.string(),
    readAt: v.optional(v.number()),
  })
    // Reintento del mismo cambio: una fila basta para decidir.
    .index("by_idempotencyKey", ["idempotencyKey"])
    // Eventos del destinatario, del más reciente al más antiguo.
    .index("by_recipientId_and_occurredAt", ["recipientId", "occurredAt"])
    // Pendientes del destinatario: `readAt` ausente se consulta como rango
    // nulo, sin recorrer los avisos ya leídos.
    .index("by_recipientId_and_readAt_and_occurredAt", ["recipientId", "readAt", "occurredAt"])
    // Eventos de la atención en orden de ocurrencia.
    .index("by_appointmentId_and_occurredAt", ["appointmentId", "occurredAt"])
    // Eventos de la solicitud en orden de ocurrencia.
    .index("by_requestId_and_occurredAt", ["requestId", "occurredAt"]),

  // Tabla 'notificationDeliveries': resultado del envío de un aviso por canal
  // (TI2-145). Una fila por evento y canal; los reintentos actualizan
  // `attempts`, `lastAttemptAt` y el resultado, sin crear otro aviso ni otra
  // fila. `errorCode` es un código estable y genérico: no guarda respuestas,
  // encabezados ni credenciales del proveedor. El envío real es TI2-159
  // (correo) y TI2-160 (push). `nextAttemptAt` es el instante desde el que
  // un despacho puede intentar la entrega (TI2-159): lo fija la política de
  // reintento al registrar cada resultado y se elimina al reservar la entrega
  // antes de invocar al proveedor, dejando la fila provisionalmente en
  // `delivery_uncertain` para que el cron no la vuelva a recoger si la acción
  // se interrumpe antes de confirmar el resultado. Ausente significa que no
  // queda intento automático pendiente.
  notificationDeliveries: defineTable({
    eventId: v.id("notificationEvents"),
    channel: notificationDeliveryChannelUnion,
    status: notificationDeliveryStatusUnion,
    attempts: v.number(),
    providerFailureAttempts: v.optional(v.number()),
    lastAttemptAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    errorCode: v.optional(notificationDeliveryErrorUnion),
    nextAttemptAt: v.optional(v.number()),
  })
    // Entrega del evento por canal: una fila basta para decidir y actualizar.
    .index("by_eventId_and_channel", ["eventId", "channel"])
    // Despacho pendiente por canal, sin barrer todas las entregas.
    .index("by_channel_and_status", ["channel", "status"])
    // Barrido de reintentos: entregas del canal cuyo próximo intento ya venció.
    .index("by_channel_and_nextAttemptAt", ["channel", "nextAttemptAt"]),

  // Tabla 'pushSubscriptions': suscripciones Web Push opcionales de cada
  // persona (TI2-145). Guarda el endpoint y las claves públicas del navegador
  // necesarias para que el servidor firme el envío; no hay tokens de sesión ni
  // datos del acompañamiento. Una suscripción pertenece a una sola persona: la
  // vía de escritura reasigna el endpoint al usuario vigente en vez de
  // duplicarlo. Solo la lee el adaptador de envío (TI2-160); ninguna función
  // pública la devuelve.
  pushSubscriptions: defineTable({
    userId: v.id("users"),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    expirationTime: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    // Suscripciones propias: activar, listar para enviar y desactivar.
    .index("by_userId", ["userId"])
    // Endpoint único por navegador: la vía de escritura lo reutiliza.
    .index("by_endpoint", ["endpoint"]),

  // Tabla 'calendarConnections': metadatos locales del vínculo de una persona
  // con su cuenta de Google Calendar (TI2-145). No guarda un estado de
  // conexión: «conectado» se deriva solo de los alcances OAuth que Better Auth
  // conserva para la cuenta de Google (`getCalendarConnection`), así que no
  // hay dos fuentes para el mismo concepto. Acá vive únicamente lo que Better
  // Auth no tiene: `accountReference`, una referencia opaca a la cuenta
  // cifrada, y las fechas de vínculo y desconexión. Los tokens OAuth no se
  // copian ni se devuelven al cliente. Una fila no afirma que la cuenta siga
  // conectada. Desconectar conserva la referencia y las fechas como
  // trazabilidad para TI2-161; los eventos ya creados pueden quedar sin
  // actualizar, como avisa esa misma tarea.
  calendarConnections: defineTable({
    userId: v.id("users"),
    accountReference: v.string(),
    linkedAt: v.number(),
    revokedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    // Metadatos del vínculo de la persona: una fila basta.
    .index("by_userId", ["userId"]),

  // Tabla 'appointmentAuditEvents': bitácora append-only de cambios de agenda
  // (TI2-128). Cada fila guarda solo la acción, el actor resuelto desde la
  // identidad de la sesión, la atención, el estado resultante y el instante
  // del servidor, en la misma transacción del cambio. No guarda motivos,
  // notas ni nombres: `requestTransitions` no equivale porque contiene
  // `reason`. Solo la escribe `convex/infrastructure/audit/repository.ts`, no
  // existe entrada pública para leerla, editarla ni borrarla y los rechazos
  // no se registran porque abortan la mutation.
  appointmentAuditEvents: defineTable({
    action: appointmentAuditActionUnion,
    actorId: v.id("users"),
    appointmentId: v.id("appointments"),
    result: appointmentStatusUnion,
    occurredAt: v.number(),
  })
    // Historial de la atención en orden de ocurrencia.
    .index("by_appointmentId_and_occurredAt", ["appointmentId", "occurredAt"])
    // Cambios hechos por un actor en orden de ocurrencia.
    .index("by_actorId_and_occurredAt", ["actorId", "occurredAt"]),

  // Tabla 'followUpRecords': registro de seguimiento posterior a una atención
  // (forma de TI2-106, persistida por TI2-118), como máximo uno por atención.
  // Guarda los próximos pasos y la fecha civil sugerida; acuerdos y tareas
  // viven en sus propias tablas para no crecer como arrays del documento. El
  // estado y el acompañamiento de la atención no se copian: se leen de
  // `appointments`. La nota interna no se copia: `internalNoteId` apunta a la
  // fila de `followUpNotes`, la única tabla de notas internas. Sin
  // diagnósticos ni datos clínicos.
  followUpRecords: defineTable({
    appointmentId: v.id("appointments"),
    authorId: v.id("users"),
    nextSteps: v.string(),
    suggestedNextAppointmentDate: v.optional(v.string()),
    internalNoteId: v.optional(v.id("followUpNotes")),
    updatedAt: v.number(),
    // Retirado (TI2-165): solo para que las filas anteriores sigan siendo válidas;
    // nada lo escribe ni lo lee. Lo vacía `operations/migrations:migrateRetiredFields`
    // y se quita del esquema cuando `auditRetiredFields` dé cero en cada deployment.
    version: v.optional(v.string()),
  })
    // El registro de la atención: una fila basta para decidir.
    .index("by_appointmentId", ["appointmentId"]),

  // Tabla 'followUpAgreements': acuerdos de un registro de seguimiento. Ni
  // los acuerdos ni las tareas guardan un identificador del cliente, porque
  // el MER no lo tiene (TI2-165): se leen en el orden en que se guardaron.
  followUpAgreements: defineTable({
    recordId: v.id("followUpRecords"),
    description: v.string(),
    // Retirado (TI2-165): solo para que las filas anteriores sigan siendo válidas;
    // nada lo escribe ni lo lee. Lo vacía `operations/migrations:migrateRetiredFields`
    // y se quita del esquema cuando `auditRetiredFields` dé cero en cada deployment.
    entryId: v.optional(v.string()),
  }).index("by_recordId", ["recordId"]),

  // Tabla 'followUpTasks': tareas de un registro de seguimiento, con
  // responsable por vínculo (estudiante, profesional o CERETI, sin identidad)
  // y estado operativo.
  followUpTasks: defineTable({
    recordId: v.id("followUpRecords"),
    description: v.string(),
    responsible: followUpResponsibleUnion,
    status: followUpTaskStatusUnion,
    // Retirado (TI2-165): solo para que las filas anteriores sigan siendo válidas;
    // nada lo escribe ni lo lee. Lo vacía `operations/migrations:migrateRetiredFields`
    // y se quita del esquema cuando `auditRetiredFields` dé cero en cada deployment.
    entryId: v.optional(v.string()),
  }).index("by_recordId", ["recordId"]),

  // Tabla 'privacyRequests': solicitudes de derechos de privacidad (modelo de
  // TI2-136, persistido por TI2-151). Guarda identificador (`_id`), tipo,
  // fechas, plazo inicial y efectivo (`dueAt`), responsable, estado, prórroga
  // única, respuesta fundada y constancia inmutable de envío. No crea una
  // bitácora paralela a TI2-128 ni copia contenido sensible (necesidades de
  // acceso, notas clínicas ni datos de acompañamiento) a campos de control.
  privacyRequests: defineTable({
    kind: privacyRequestKindUnion,
    status: privacyRequestStatusUnion,
    requesterId: v.id("users"),
    requesterRole: roleUnion,
    channel: privacyRequestChannelUnion,
    receivedAt: v.number(),
    version: privacyRequestContractVersionLiteral,
    responseRule: privacyResponseRuleUnion,
    receivedDate: v.string(),
    initialDueDate: v.string(),
    initialDueAt: v.number(),
    dueAt: v.number(),
    deadlineTimeZone: v.string(),
    deadlineHolidays: v.array(v.string()),
    responsibleId: v.optional(v.id("users")),
    extension: v.optional(privacyResponseExtensionValidator),
    statusReason: v.optional(v.string()),
    withdrawnAt: v.optional(v.number()),
    response: v.optional(privacyRequestResponseValidator),
    deliveryReceipt: v.optional(privacyResponseDeliveryReceiptValidator),
    updatedAt: v.number(),
  })
    // Solicitudes propias del titular en orden de recepción.
    .index("by_requesterId_and_receivedAt", ["requesterId", "receivedAt"])
    // Cola operativa por estado ordenada por vencimiento efectivo.
    .index("by_status_and_dueAt", ["status", "dueAt"])
    // Seguimiento global de vencimientos sin barrer la tabla.
    .index("by_dueAt", ["dueAt"]),

  // Tabla 'privacyBlocks': bloqueos temporales de tratamiento y su alcance
  // (TI2-151). No guarda una columna `status` paralela: programado, vigente,
  // vencido o levantado se derivan de `startsAt`, `endsAt` y `liftedAt`
  // (`privacyBlockStateAt`). Cuando se vincula a una solicitud de bloqueo
  // (`requestId`), solo se acepta si esa solicitud ya está resuelta como
  // concedida total o parcialmente y `endsAt` coincide con
  // `response.temporaryBlockUntil`. Sin contenido sensible en `reason` ni en
  // `liftReason`.
  privacyBlocks: defineTable({
    subjectId: v.id("users"),
    requestId: v.optional(v.id("privacyRequests")),
    scope: privacyBlockScopeUnion,
    startsAt: v.number(),
    endsAt: v.number(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    reason: v.string(),
    liftedAt: v.optional(v.number()),
    liftedBy: v.optional(v.id("users")),
    liftReason: v.optional(v.string()),
  })
    // Bloqueos no levantados del titular ordenados por vencimiento.
    .index("by_subjectId_and_liftedAt_and_endsAt", ["subjectId", "liftedAt", "endsAt"])
    // Bloqueos asociados a una solicitud de privacidad concreta.
    .index("by_requestId", ["requestId"])
    // Bloqueos activos o próximos a vencer en todo el sistema.
    .index("by_liftedAt_and_endsAt", ["liftedAt", "endsAt"]),

  // Tabla 'privacyRetentionRules': reglas de conservación configurable por
  // categoría de datos (ADR-0003 y TI2-151). Una fila por categoría,
  // garantizada por la vía de escritura. `retentionDays` es opcional porque el
  // código no inventa plazos: ausente significa pendiente de definición por la
  // UCT. `legalBasisNote` guarda solo una referencia institucional acotada.
  privacyRetentionRules: defineTable({
    category: privacyDataCategoryUnion,
    retentionDays: v.optional(v.number()),
    disposition: privacyRetentionDispositionUnion,
    legalBasisNote: v.optional(v.string()),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  })
    // Regla única por categoría de datos.
    .index("by_category", ["category"]),

  // Tabla 'privacyRetentionExceptions': excepciones que suspenden la
  // eliminación o anonimización por obligación legal o procedimiento abierto
  // (ADR-0003 y TI2-151). Pueden acotarse a una categoría completa o a un
  // titular concreto (`subjectId`) y vincularse a una solicitud de privacidad
  // abierta (`privacyRequestId`). `reference` guarda solo el código o folio de
  // control, nunca contenido sensible.
  privacyRetentionExceptions: defineTable({
    kind: privacyRetentionExceptionKindUnion,
    category: privacyDataCategoryUnion,
    subjectId: v.optional(v.id("users")),
    privacyRequestId: v.optional(v.id("privacyRequests")),
    reference: v.string(),
    startsAt: v.number(),
    expiresAt: v.optional(v.number()),
    liftedAt: v.optional(v.number()),
    liftedBy: v.optional(v.id("users")),
    liftReason: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    // Excepciones vigentes por categoría (`liftedAt` ausente; `expiresAt`
    // ausente o mayor a `now` en dos rangos para que las vencidas no oculten
    // las activas).
    .index("by_category_and_liftedAt_and_expiresAt", ["category", "liftedAt", "expiresAt"])
    // Excepciones vigentes de un titular (`liftedAt` ausente; `expiresAt`
    // ausente o mayor a `now` en dos rangos).
    .index("by_subjectId_and_liftedAt_and_expiresAt", ["subjectId", "liftedAt", "expiresAt"])
    // Excepciones originadas por una solicitud de privacidad.
    .index("by_privacyRequestId", ["privacyRequestId"]),
});
