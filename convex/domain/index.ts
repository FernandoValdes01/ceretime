/**
 * Barrel de contratos compartidos de dominio (TI2-8, TI2-87).
 *
 * Punto único de importación para Web y Mobile: evita que cada consumidor
 * navegue archivo por archivo dentro de `convex/domain` y que aparezca otra
 * representación de los mismos conceptos. Todos los contratos son puros: no
 * dependen de Convex ni de `convex/_generated`.
 */

// Identidad, roles y habilitación institucional.
export { ACCOUNT_STATUS_VALUES, INSTITUTIONAL_STATUS_VALUES, ROLE_VALUES } from "./identity/roles";
export type {
  AccountEnablement,
  AccountStatus,
  AuthenticatedProfile,
  InstitutionalStatus,
  Role,
} from "./identity/roles";

// Inicio institucional con Google: proveedor de cada población (TI2-131).
export { GOOGLE_PROVIDER_ID_BY_POPULATION } from "./auth/institutional_domain";
export type { InstitutionalPopulation } from "./auth/institutional_domain";

// Solicitud de acompañamiento y sus estados.
export {
  ACCESS_NEEDS_MAX_LENGTH,
  isAccessNeedsWithinLimit,
  LEGACY_REQUEST_PROVENANCE_CHANNEL,
  REQUEST_PROVENANCE_CHANNEL_VALUES,
  requestProvenanceChannelOf,
  toAccessNeedsText,
  toAccompanimentRequest,
  toStoredAccessNeeds,
  toStoredRequestFields,
} from "./requests/request";
export type {
  AccessNeed,
  AccompanimentRequest,
  AccompanimentRequestContent,
  GeneralAvailability,
  ModalityPreference,
  RequestProvenanceChannel,
  StoredRequestFields,
} from "./requests/request";
export {
  FUTURE_REQUEST_STATES,
  INITIAL_REQUEST_STATE,
  isSprint1RequestState,
  PERSISTABLE_REQUEST_STATES,
  REQUEST_STATES,
  REQUEST_STATE_LABELS,
  SPRINT_1_REQUEST_STATES,
} from "./requests/state";
export type {
  FutureRequestState,
  PersistableRequestState,
  RequestState,
  Sprint1RequestState,
} from "./requests/state";

// Acompañamiento y sus vistas de lectura.
export {
  ACCOMPANIMENT_STATUS_VALUES,
  ACCOMPANIMENT_VIEW_VALUES,
  toAccompanimentProjection,
} from "./accompaniments/accompaniment";
export type {
  Accompaniment,
  AccompanimentProjection,
  AccompanimentRow,
  AccompanimentStatus,
  AccompanimentView,
  MinimizedAccompaniment,
} from "./accompaniments/accompaniment";

// Vocabulario persistido de disponibilidad (TI2-83): la única fuente en
// valores de modalidad para los validadores del borde. El resto de los
// símbolos de este módulo (versión, clases de excepción, ventanas y
// proyecciones) los exporta la sección TI2-87 de abajo sin duplicarlos.
export { MODALITY_VALUES } from "./availability/availability";

// Asignaciones de acceso y sus permisos de lectura.
export {
  ASSIGNMENT_ROLE_VALUES,
  ASSIGNMENT_STATUS_VALUES,
  ASSIGNMENT_VIEW_BY_ROLE,
} from "./accompaniments/practitioner_assignment";
export { toAssignmentReadPermission } from "./accompaniments/practitioner_assignment";
export type {
  AssignmentReadPermission,
  AssignmentRole,
  AssignmentStatus,
  PractitionerAssignment,
} from "./accompaniments/practitioner_assignment";

// Errores públicos y estados de respuesta (TI2-8, TI2-88).
export {
  API_ERROR_CODE_VALUES,
  API_ERROR_MESSAGES,
  CONFLICT_ERROR_CODE,
  CONFLICT_ERROR_MESSAGE,
  NO_AVAILABILITY_ERROR_CODE,
  NO_AVAILABILITY_ERROR_MESSAGE,
  SPACE_FIELDS_INVALID_ERROR_CODE,
  SPACE_FIELDS_INVALID_ERROR_MESSAGE,
  UNAUTHORIZED_ERROR_CODE,
  UNAUTHORIZED_ERROR_MESSAGE,
  conflictError,
  errResult,
  isApiErrorCode,
  isErrorResult,
  isOkResult,
  noAvailabilityError,
  okResult,
  unauthorizedError,
} from "./errors/api_error";
export type { ApiErrorCode, ApiResult, PublicApiError } from "./errors/api_error";

// Disponibilidad: entradas y salidas mínimas con identificadores genéricos (TI2-87).
export {
  AGENDA_TIME_ZONE,
  AVAILABILITY_CONTRACT_VERSION,
  AVAILABILITY_EXCEPTION_KIND_VALUES,
} from "./availability/availability";
export type {
  AvailabilityBlock,
  AvailabilityContractVersion,
  AvailabilityException,
  AvailabilityExceptionKind,
  AvailabilitySlot,
  AvailabilitySlotPage,
  AvailabilityWindow,
  ListAvailabilityInput,
} from "./availability/availability";

// Espacios de atención: catálogo con acceso e instrucciones (TI2-87).
export { SPACE_CATALOG_CONTRACT_VERSION, toSpaceLabel } from "./spaces/space";
export type {
  ListSpacesInput,
  Space,
  SpaceCatalogContractVersion,
  SpaceCatalogPage,
} from "./spaces/space";

// Compatibilidad de modalidad y espacio con necesidades de acceso (TI2-82).
export {
  COMPATIBILITY_ISSUE_VALUES,
  assessCompatibility,
  selectCompatibleOptions,
} from "./spaces/compatibility";
export type {
  CompatibilityDecision,
  CompatibilityIssue,
  CompatibilityIssueCode,
  CompatibilityOption,
  CompatibilitySpace,
} from "./spaces/compatibility";

// Atención reservada: reserva y atención en una sola entidad (TI2-87, TI2-93, plazo TI2-94).
export {
  APPOINTMENT_ATTENDANCE_OUTCOME_VALUES,
  APPOINTMENT_CONTRACT_VERSION,
  APPOINTMENT_REJECTION_CAUSES,
  APPOINTMENT_STATUS_VALUES,
  APPOINTMENT_TRANSITIONS,
  APPOINTMENT_VIEW_VALUES,
  findAppointmentTransition,
  INITIAL_APPOINTMENT_STATUS,
  isCalendarActionableStatus,
  isJustificationDecision,
  isJustificationReview,
  JUSTIFICATION_BUSINESS_DAYS,
  JUSTIFICATION_DECISION_VALUES,
  JUSTIFICATION_REVIEW_VALUES,
  NO_SHOW_PENDING_STATE,
  calculateJustificationDeadline,
  decideJustificationTimeliness,
  toAppointmentProjection,
  transitionAppointment,
} from "./appointments/appointment";
export type {
  Appointment,
  AppointmentAttendanceOutcome,
  AppointmentContractVersion,
  AppointmentPage,
  AppointmentProjection,
  AppointmentRejectionCause,
  AppointmentStateChange,
  AppointmentStateTransition,
  AppointmentStatus,
  AppointmentTransitionAttempt,
  AppointmentTransitionResult,
  AppointmentView,
  CalculateJustificationDeadlineInput,
  DecideJustificationTimelinessInput,
  JustificationDeadline,
  JustificationDecision,
  JustificationReceipt,
  JustificationReview,
  JustificationTimeliness,
  ListAppointmentsInput,
  MinimizedAppointment,
} from "./appointments/appointment";

// Evento de calendario por atención y alternativa .ics (TI2-122).
export {
  buildCalendarEvent,
  CALENDAR_EVENT_CONTRACT_VERSION,
  CALENDAR_EVENT_FALLBACK_REASON_VALUES,
  CALENDAR_EVENT_OUTCOME_VALUES,
  CALENDAR_EVENT_TITLE,
  CALENDAR_EVENTS_SCOPE,
  CALENDAR_FILE_NAME,
  deriveCalendarEventKey,
  escapeIcsText,
  foldIcsLine,
  serializeCalendarEventIcs,
  toCalendarFile,
} from "./calendar/calendar_event";
export type {
  CalendarEventContractVersion,
  CalendarEventDraft,
  CalendarEventFallbackReason,
  CalendarEventOutcome,
  CalendarFile,
} from "./calendar/calendar_event";

// Evento de notificación: forma mínima, emisión y clave de reintento (TI2-100, TI2-105).
export {
  NOTIFICATION_CONTRACT_VERSION,
  NOTIFICATION_EVENT_KIND_VALUES,
  isNotificationEventKind,
  notificationEventsForCreation,
  notificationEventsForTransition,
  notificationIdempotencyKey,
  toExternalNotification,
  toNotificationEvent,
} from "./notifications/notification";
export type {
  ExternalNotification,
  NotificationAudience,
  NotificationContractVersion,
  NotificationEvent,
  NotificationEventInput,
  NotificationEventKind,
  NotificationReference,
  NotificationSubject,
} from "./notifications/notification";

// Registro de seguimiento: acuerdos, tareas y proyección compartida (TI2-106).
export {
  FOLLOW_UP_CONTRACT_VERSION,
  FOLLOW_UP_ENTRIES_MAX,
  FOLLOW_UP_REJECTION_CAUSES,
  FOLLOW_UP_RESPONSIBLE_VALUES,
  FOLLOW_UP_TASK_STATUS_VALUES,
  FOLLOW_UP_TEXT_MAX_LENGTH,
  FOLLOW_UP_VIEW_VALUES,
  isFollowUpResponsible,
  isFollowUpRetry,
  isFollowUpTaskStatus,
  toFollowUpProjection,
  toSharedFollowUpProjection,
  validateFollowUpRecord,
} from "./follow_up/follow_up";
export type {
  FollowUpAgreement,
  FollowUpAgreementInput,
  FollowUpContractVersion,
  FollowUpProjection,
  FollowUpRecord,
  FollowUpRecordInput,
  FollowUpRejectionCause,
  FollowUpResponsible,
  FollowUpTask,
  FollowUpTaskInput,
  FollowUpTaskStatus,
  FollowUpValidationResult,
  FollowUpView,
  MinimizedFollowUpProjection,
  SharedFollowUpProjection,
} from "./follow_up/follow_up";
