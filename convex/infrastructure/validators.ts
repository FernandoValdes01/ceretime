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
import { NO_COMPATIBLE_SLOT_REASON_VALUES } from "../domain/availability/official_channel";
import {
  CALENDAR_SYNC_ERROR_CODE_VALUES,
  CALENDAR_SYNC_STATUS_VALUES,
} from "../domain/calendar/calendar_link";
import {
  FOLLOW_UP_CONTRACT_VERSION,
  FOLLOW_UP_RESPONSIBLE_VALUES,
  FOLLOW_UP_TASK_STATUS_VALUES,
} from "../domain/follow_up/follow_up";
import {
  APPOINTMENT_NOTIFICATION_EVENT_KIND_VALUES,
  NOTIFICATION_CONTRACT_VERSION,
  NOTIFICATION_EVENT_KIND_VALUES,
  NOTIFICATION_READ_STATUS_VALUES,
  PRIVACY_NOTIFICATION_EVENT_KIND_VALUES,
  REQUEST_NOTIFICATION_EVENT_KIND_VALUES,
} from "../domain/notifications/notification";
import {
  NOTIFICATION_DELIVERY_CHANNEL_VALUES,
  NOTIFICATION_DELIVERY_ERROR_VALUES,
  NOTIFICATION_DELIVERY_STATUS_VALUES,
} from "../domain/notifications/delivery";
import {
  ASSIGNMENT_ROLE_VALUES,
  ASSIGNMENT_STATUS_VALUES,
} from "../domain/accompaniments/practitioner_assignment";
import { REQUEST_TAKE_STATUS_VALUES } from "../domain/requests/take";
import {
  PRIVACY_BLOCK_SCOPE_VALUES,
  PRIVACY_DATA_CATEGORY_VALUES,
  PRIVACY_RESPONSE_DELIVERY_CHANNEL_VALUES,
  PRIVACY_RETENTION_DISPOSITION_VALUES,
  PRIVACY_RETENTION_EXCEPTION_KIND_VALUES,
} from "../domain/privacy/privacy_controls";
import { PRIVACY_RESPONSE_RULE_VALUES } from "../domain/privacy/privacy_deadlines";
import {
  PRIVACY_REQUEST_CHANNEL_VALUES,
  PRIVACY_REQUEST_CONTRACT_VERSION,
  PRIVACY_REQUEST_KIND_VALUES,
  PRIVACY_REQUEST_STATUS_VALUES,
  PRIVACY_RESPONSE_OUTCOME_VALUES,
} from "../domain/privacy/privacy_request";
import { REQUEST_PROVENANCE_CHANNEL_VALUES } from "../domain/requests/request";
import { REQUEST_STATES } from "../domain/requests/state";
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

/** Estado de la toma de una solicitud (TI4-84), propio y no el de las asignaciones. */
export const requestTakeStatusUnion = v.union(
  ...REQUEST_TAKE_STATUS_VALUES.map((value) => v.literal(value)),
);

/**
 * Estados de solicitud (TI2-141, TI2-143): los siete que declara el dominio,
 * derivados de `REQUEST_STATES` para que el borde no defina nombres por su
 * cuenta. Los usan el contrato de presentación y, desde TI2-143, las tablas
 * `requests` y `requestTransitions`: una sola unión para lo que se publica y
 * lo que se guarda.
 */
export const requestStatusUnion = v.union(...REQUEST_STATES.map((state) => v.literal(state)));

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

/** Canal de procedencia que entrega el detalle de la solicitud (TI2-143). */
export const requestProvenanceChannelUnion = v.union(
  ...REQUEST_PROVENANCE_CHANNEL_VALUES.map((channel) => v.literal(channel)),
);

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
 * con la razón comprensible. Desde TI2-143 se escribe junto con el estado
 * `referred`, en la misma operación.
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
 * Ubicación y acceso de un espacio (`SpaceFields`): la comparten el catálogo de
 * espacios, los cupos de la búsqueda y el canal oficial presencial (TI2-144).
 */
export const spaceFieldsShape = {
  campus: v.string(),
  building: v.string(),
  floor: v.string(),
  room: v.string(),
  accessConditions: v.string(),
  arrivalInstructions: v.string(),
};

/** Motivos de la ausencia de horario compatible (TI2-144), derivados del dominio. */
export const noCompatibleSlotReasonUnion = v.union(
  ...NO_COMPATIBLE_SLOT_REASON_VALUES.map((value) => v.literal(value)),
);

/** Canal oficial de CERETI (TI2-144), discriminado por `kind` como en el dominio. */
export const officialChannelValidator = v.union(
  v.object({
    id: v.string(),
    kind: v.literal("inPerson"),
    name: v.string(),
    hours: v.string(),
    location: v.object(spaceFieldsShape),
  }),
  v.object({
    id: v.string(),
    kind: v.literal("email"),
    name: v.string(),
    hours: v.string(),
    address: v.string(),
  }),
  v.object({
    id: v.string(),
    kind: v.literal("phone"),
    name: v.string(),
    hours: v.string(),
    phoneNumber: v.string(),
  }),
);

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
 * Clases por recurso y estado de lectura de la bandeja (TI2-154), derivados
 * de las mismas listas del dominio: la API pública declara que una clase de
 * atención solo viaja con una atención y una de solicitud con una solicitud.
 */
export const appointmentNotificationEventKindUnion = v.union(
  ...APPOINTMENT_NOTIFICATION_EVENT_KIND_VALUES.map((value) => v.literal(value)),
);

export const requestNotificationEventKindUnion = v.union(
  ...REQUEST_NOTIFICATION_EVENT_KIND_VALUES.map((value) => v.literal(value)),
);

export const privacyNotificationEventKindUnion = v.union(
  ...PRIVACY_NOTIFICATION_EVENT_KIND_VALUES.map((value) => v.literal(value)),
);

export const notificationReadStatusUnion = v.union(
  ...NOTIFICATION_READ_STATUS_VALUES.map((value) => v.literal(value)),
);

/**
 * Canales, estados y errores de entrega de avisos (TI2-145), derivados del
 * dominio. La entrega vive por evento y canal en `notificationDeliveries`.
 */
export const notificationDeliveryChannelUnion = v.union(
  ...NOTIFICATION_DELIVERY_CHANNEL_VALUES.map((value) => v.literal(value)),
);

export const notificationDeliveryStatusUnion = v.union(
  ...NOTIFICATION_DELIVERY_STATUS_VALUES.map((value) => v.literal(value)),
);

export const notificationDeliveryErrorUnion = v.union(
  ...NOTIFICATION_DELIVERY_ERROR_VALUES.map((value) => v.literal(value)),
);

/**
 * Estados de la sincronización por atención (TI2-145), derivados del dominio.
 * El código de error reutiliza los motivos genéricos del respaldo `.ics`, sin
 * detalles del proveedor. El vínculo de Calendar no tiene un estado propio:
 * los alcances de Better Auth son su única fuente de verdad.
 */
export const calendarSyncStatusUnion = v.union(
  ...CALENDAR_SYNC_STATUS_VALUES.map((value) => v.literal(value)),
);

export const calendarSyncErrorCodeUnion = v.union(
  ...CALENDAR_SYNC_ERROR_CODE_VALUES.map((value) => v.literal(value)),
);

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

/**
 * Validadores del procedimiento de privacidad, bloqueos temporales y reglas
 * de conservación (TI2-136, persistidos por TI2-151), derivados del dominio.
 */
export const privacyRequestKindUnion = v.union(
  ...PRIVACY_REQUEST_KIND_VALUES.map((value) => v.literal(value)),
);

export const privacyRequestStatusUnion = v.union(
  ...PRIVACY_REQUEST_STATUS_VALUES.map((value) => v.literal(value)),
);

export const privacyRequestChannelUnion = v.union(
  ...PRIVACY_REQUEST_CHANNEL_VALUES.map((value) => v.literal(value)),
);

export const privacyResponseOutcomeUnion = v.union(
  ...PRIVACY_RESPONSE_OUTCOME_VALUES.map((value) => v.literal(value)),
);

export const privacyResponseRuleUnion = v.union(
  ...PRIVACY_RESPONSE_RULE_VALUES.map((value) => v.literal(value)),
);

export const privacyRequestContractVersionLiteral = v.literal(PRIVACY_REQUEST_CONTRACT_VERSION);

export const privacyResponseDeliveryChannelUnion = v.union(
  ...PRIVACY_RESPONSE_DELIVERY_CHANNEL_VALUES.map((value) => v.literal(value)),
);

export const privacyDataCategoryUnion = v.union(
  ...PRIVACY_DATA_CATEGORY_VALUES.map((value) => v.literal(value)),
);

export const privacyBlockScopeUnion = v.union(
  ...PRIVACY_BLOCK_SCOPE_VALUES.map((value) => v.literal(value)),
);

export const privacyRetentionDispositionUnion = v.union(
  ...PRIVACY_RETENTION_DISPOSITION_VALUES.map((value) => v.literal(value)),
);

export const privacyRetentionExceptionKindUnion = v.union(
  ...PRIVACY_RETENTION_EXCEPTION_KIND_VALUES.map((value) => v.literal(value)),
);

export const privacyResponseExtensionValidator = v.object({
  days: v.number(),
  extendedUntilDate: v.string(),
  extendedUntilAt: v.number(),
  extendedAt: v.number(),
  extendedBy: v.id("users"),
  reason: v.string(),
});

export const privacyRequestResponseValidator = v.object({
  outcome: privacyResponseOutcomeUnion,
  reasons: v.string(),
  responsibleId: v.id("users"),
  respondedAt: v.number(),
  temporaryBlockUntil: v.optional(v.number()),
});

export const privacyResponseDeliveryReceiptValidator = v.object({
  channel: privacyResponseDeliveryChannelUnion,
  sentAt: v.number(),
  recordedBy: v.id("users"),
  reference: v.string(),
  agencyClaimDueDate: v.string(),
  agencyClaimDueAt: v.number(),
});
