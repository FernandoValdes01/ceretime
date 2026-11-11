import { v } from "convex/values";
import { ACCOMPANIMENT_STATUS_VALUES } from "../domain/accompaniments/accompaniment";
import {
  APPOINTMENT_ATTENDANCE_OUTCOME_VALUES,
  APPOINTMENT_STATUS_VALUES,
  JUSTIFICATION_DECISION_VALUES,
  JUSTIFICATION_REVIEW_VALUES,
} from "../domain/appointments/appointment";
import { APPOINTMENT_AUDIT_ACTION_VALUES } from "../domain/appointments/audit";
import {
  AVAILABILITY_EXCEPTION_KIND_VALUES,
  MODALITY_VALUES,
} from "../domain/availability/availability";
import {
  FOLLOW_UP_CONTRACT_VERSION,
  FOLLOW_UP_RESPONSIBLE_VALUES,
  FOLLOW_UP_TASK_STATUS_VALUES,
} from "../domain/follow_up/follow_up";
import {
  NOTIFICATION_CONTRACT_VERSION,
  NOTIFICATION_EVENT_KIND_VALUES,
} from "../domain/notifications/notification";
import {
  ASSIGNMENT_ROLE_VALUES,
  ASSIGNMENT_STATUS_VALUES,
} from "../domain/accompaniments/practitioner_assignment";
import { REQUEST_PROVENANCE_CHANNEL_VALUES } from "../domain/requests/request";
import { PERSISTABLE_REQUEST_STATES, SPRINT_1_REQUEST_STATES } from "../domain/requests/state";
import {
  ACCOUNT_STATUS_VALUES,
  INSTITUTIONAL_STATUS_VALUES,
  ROLE_VALUES,
} from "../domain/identity/roles";

/**
 * Validadores compartidos de identidad y roles.
 *
 * Borde que conecta con la base de datos y la API: convierten a validadores de
 * Convex los literales cuyo contrato singular vive en `convex/domain`. No son
 * una segunda fuente de verdad; si cambia un literal, cambia solo en el
 * dominio y este archivo lo refleja.
 *
 * Operan exclusivamente con DATOS FICTICIOS durante desarrollo y pruebas.
 */
export const roleUnion = v.union(...ROLE_VALUES.map((value) => v.literal(value)));

export const institutionalStatusUnion = v.union(
  ...INSTITUTIONAL_STATUS_VALUES.map((value) => v.literal(value)),
);

export const accountStatusUnion = v.union(
  ...ACCOUNT_STATUS_VALUES.map((value) => v.literal(value)),
);

export const accompanimentStatusUnion = v.union(
  ...ACCOMPANIMENT_STATUS_VALUES.map((value) => v.literal(value)),
);

export const assignmentRoleUnion = v.union(
  ...ASSIGNMENT_ROLE_VALUES.map((value) => v.literal(value)),
);

export const assignmentStatusUnion = v.union(
  ...ASSIGNMENT_STATUS_VALUES.map((value) => v.literal(value)),
);

/**
 * Estados de solicitud del contrato de presentación (Sprint 1, TI2-7): lo que
 * la API pública devuelve hoy. Derivados del dominio para que el esquema no
 * defina nombres por su cuenta. Mantenerlo en 4 estados conserva intactos
 * los tipos que Web y Mobile derivan de `api.presentation.*`. TI2-85 habilitó
 * los cierres en Dominio y Aplicación sin ampliarlo: el mapeo de estados de
 * Mobile es exhaustivo y deja de compilar con 6. Lo amplía, junto con TI4, la
 * tarea que publique cancelar y cerrar.
 */
const requestStatusLiterals = SPRINT_1_REQUEST_STATES.map((state) => v.literal(state));

export const requestStatusUnion = v.union(...requestStatusLiterals);

/**
 * Estados de solicitud persistibles (TI2-83 adapta validadores para TI2-85):
 * operativos de Sprint 1 más `closed_without_accompaniment` y `cancelled`,
 * sin `referred`. Solo esquema (`requests`, `requestTransitions`) y
 * adaptación de lectura; la presentación sigue en 4 estados (ver arriba).
 */
export const persistableRequestStatusUnion = v.union(
  ...PERSISTABLE_REQUEST_STATES.map((state) => v.literal(state)),
);

/**
 * Contenido ampliado de la solicitud (TI2-135): formas persistidas de las
 * condiciones de acceso y de la disponibilidad general del contrato
 * `AccompanimentRequestContent` del dominio. Los campos de `requests` que las
 * usan son todos opcionales para que las filas anteriores sigan siendo
 * válidas; los topes de largo y las reglas de contenido los aplican los casos
 * de uso, no el esquema.
 */
export const accessNeedSelectionValidator = v.object({
  id: v.string(),
  label: v.string(),
});

export const generalAvailabilityValidator = v.object({
  preferredWeekdays: v.array(v.number()),
  preferredTimeRange: v.optional(v.object({ from: v.string(), to: v.string() })),
});

const [studentProvenanceChannel, officialProvenanceChannel] = REQUEST_PROVENANCE_CHANNEL_VALUES;

/**
 * Procedencia de una solicitud (TI2-135): el canal, quién la registró cuando
 * no fue el propio Estudiante y cuándo la recibió CERETI.
 *
 * Un canal oficial exige autor y fecha de recepción: sin esos datos la fila no
 * explica su procedencia. El canal del Estudiante solo necesita la fecha
 * cuando se conoce.
 */
export const requestProvenanceValidator = v.union(
  v.object({
    channel: v.literal(studentProvenanceChannel),
    receivedAt: v.optional(v.number()),
  }),
  v.object({
    channel: v.literal(officialProvenanceChannel),
    registeredBy: v.id("users"),
    receivedAt: v.number(),
  }),
);

/**
 * Derivación de entrada (TI2-135): otra unidad de la Universidad avisa de una
 * posible necesidad. CERETI debe contactar al estudiante y este debe aceptar
 * antes de abrir un acompañamiento (RN-24); el contacto y la aceptación se
 * guardan con su fecha. Dónde se exige ese orden es de los casos de uso.
 */
export const incomingReferralValidator = v.object({
  originUnit: v.string(),
  referredAt: v.number(),
  contactedAt: v.optional(v.number()),
  contactedBy: v.optional(v.id("users")),
  acceptedAt: v.optional(v.number()),
});

/**
 * Derivación de salida (TI2-135): CERETI deriva al estudiante a otra unidad,
 * con la razón comprensible. El estado `referred` sigue sin habilitarse; esto
 * solo da dónde guardar el dato cuando un caso de uso lo habilite.
 */
export const outgoingReferralValidator = v.object({
  destinationUnit: v.string(),
  referredAt: v.number(),
  referredBy: v.id("users"),
  reason: v.string(),
});

/**
 * Modalidades de atención de la agenda (TI2-83), derivadas de los literales
 * del dominio para que el esquema no defina nombres por su cuenta.
 */
export const modalityUnion = v.union(...MODALITY_VALUES.map((value) => v.literal(value)));

/**
 * Clases de excepción de disponibilidad (TI2-83), derivadas del dominio.
 */
export const availabilityExceptionKindUnion = v.union(
  ...AVAILABILITY_EXCEPTION_KIND_VALUES.map((value) => v.literal(value)),
);

/**
 * Estados de la atención reservada (TI2-83), derivados del dominio.
 */
export const appointmentStatusUnion = v.union(
  ...APPOINTMENT_STATUS_VALUES.map((value) => v.literal(value)),
);

/**
 * Resultados que el registro de atención puede declarar (TI2-110),
 * derivados del dominio. Deja fuera la justificación de inasistencia, que
 * pertenece a TI2-119.
 */
export const appointmentAttendanceOutcomeUnion = v.union(
  ...APPOINTMENT_ATTENDANCE_OUTCOME_VALUES.map((value) => v.literal(value)),
);

/**
 * Revisiones de la justificación de inasistencia (TI2-119), derivadas del dominio.
 */
export const justificationReviewUnion = v.union(
  ...JUSTIFICATION_REVIEW_VALUES.map((value) => v.literal(value)),
);

/**
 * Decisiones de revisión de justificación (TI2-119): aceptar o rechazar.
 */
export const justificationDecisionUnion = v.union(
  ...JUSTIFICATION_DECISION_VALUES.map((value) => v.literal(value)),
);

/**
 * Acciones auditadas de la agenda (TI2-128), derivadas del dominio.
 */
export const appointmentAuditActionUnion = v.union(
  ...APPOINTMENT_AUDIT_ACTION_VALUES.map((value) => v.literal(value)),
);

/**
 * Clases de evento de notificación (TI2-105, persistidas por TI2-118),
 * derivadas del dominio, y versión vigente del contrato del evento.
 */
export const notificationEventKindUnion = v.union(
  ...NOTIFICATION_EVENT_KIND_VALUES.map((value) => v.literal(value)),
);

export const notificationContractVersionLiteral = v.literal(NOTIFICATION_CONTRACT_VERSION);

/**
 * Estados y responsables de las tareas de seguimiento (TI2-106, persistidos
 * por TI2-118), derivados del dominio, y versión vigente del registro.
 */
export const followUpTaskStatusUnion = v.union(
  ...FOLLOW_UP_TASK_STATUS_VALUES.map((value) => v.literal(value)),
);

export const followUpResponsibleUnion = v.union(
  ...FOLLOW_UP_RESPONSIBLE_VALUES.map((value) => v.literal(value)),
);

export const followUpContractVersionLiteral = v.literal(FOLLOW_UP_CONTRACT_VERSION);
