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
  ACCESS_NEED_OPTIONS,
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
  INITIAL_REQUEST_STATE,
  isRequestState,
  REFERRAL_REQUEST_STATES,
  REQUEST_STATES,
  REQUEST_STATE_LABELS,
  SPRINT_1_REQUEST_STATES,
} from "./requests/state";
export type { ReferralRequestState, RequestState, Sprint1RequestState } from "./requests/state";
export { isOpenRequestState, isRequestTransitionDeclared } from "./requests/transitions";

// Acompañamiento y sus vistas de lectura.
export {
  ACCOMPANIMENT_CLOSURE_REASON_MAX_LENGTH,
  ACCOMPANIMENT_STATUS_VALUES,
  ACCOMPANIMENT_TRANSITIONS,
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
  REQUEST_FIELDS_INVALID_ERROR_CODE,
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
  AvailabilitySearchResult,
  AvailabilitySlot,
  AvailabilitySlotPage,
  AvailabilityWindow,
  ListAvailabilityInput,
  SearchedAvailabilitySlot,
} from "./availability/availability";

// Coordinación por canal oficial sin horario compatible (TI2-144).
export {
  NO_COMPATIBLE_SLOT_REASON_VALUES,
  OFFICIAL_CHANNELS,
  combineNoCompatibleSlotReasons,
  toOfficialChannelCoordination,
} from "./availability/official_channel";
export type {
  EmailOfficialChannel,
  InPersonOfficialChannel,
  NoCompatibleSlotReason,
  OfficialChannel,
  OfficialChannelCoordination,
  PhoneOfficialChannel,
} from "./availability/official_channel";

// Espacios de atención: catálogo con acceso e instrucciones (TI2-87).
export { SPACE_CATALOG_CONTRACT_VERSION, toSpaceFields, toSpaceLabel } from "./spaces/space";
export type {
  ListSpacesInput,
  Space,
  SpaceCatalogContractVersion,
  SpaceCatalogPage,
  SpaceFields,
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

// Participantes de la atención: varios profesionales (TI2-142).
export {
  APPOINTMENT_PROFESSIONALS_REJECTION_CAUSES,
  MAX_APPOINTMENT_PROFESSIONALS,
  appointmentProfessionalIds,
  isAppointmentParticipant,
  isAppointmentProfessional,
  normalizeAppointmentProfessionals,
} from "./appointments/participants";
export type {
  AppointmentParticipants,
  AppointmentProfessionals,
  AppointmentProfessionalsRejectionCause,
  AppointmentProfessionalsResult,
} from "./appointments/participants";

// Acceso privado de la atención en línea (TI2-142).
export {
  ONLINE_ACCESS_ALLOWED_HOSTS,
  ONLINE_ACCESS_LINK_MAX_LENGTH,
  ONLINE_ACCESS_LINK_REJECTION_CAUSES,
  ONLINE_ACCESS_STATUS_VALUES,
  ONLINE_ACCESS_UPDATE_REJECTION_CAUSES,
  decideOnlineAccessUpdate,
  normalizeOnlineAccessLink,
  toOnlineAccessView,
} from "./appointments/online_access";
export type {
  OnlineAccessChange,
  OnlineAccessLinkRejectionCause,
  OnlineAccessLinkResult,
  OnlineAccessStatus,
  OnlineAccessSubject,
  OnlineAccessUpdateRejectionCause,
  OnlineAccessUpdateResult,
  OnlineAccessView,
} from "./appointments/online_access";

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

// Vínculo con Calendar y estado de sincronización por atención (TI2-145).
export {
  CALENDAR_LINK_ROLE_VALUES,
  CALENDAR_SYNC_ERROR_CODE_VALUES,
  CALENDAR_SYNC_STATUS_VALUES,
  calendarSyncStateOf,
  canManageCalendarLink,
  initialCalendarSyncState,
  isCalendarSyncErrorCode,
  isCalendarSyncStatus,
} from "./calendar/calendar_link";
export type {
  CalendarConnectionMetadata,
  CalendarLinkRole,
  CalendarSyncErrorCode,
  CalendarSyncState,
  CalendarSyncStatus,
} from "./calendar/calendar_link";

// Evento de notificación: forma mínima, emisión y clave de reintento (TI2-100, TI2-105, TI2-150).
export {
  APPOINTMENT_NOTIFICATION_EVENT_KIND_VALUES,
  NOTIFICATION_CONTRACT_VERSION,
  NOTIFICATION_EVENT_KIND_VALUES,
  NOTIFICATION_READ_STATUS_VALUES,
  REQUEST_NOTIFICATION_EVENT_KIND_VALUES,
  isAppointmentNotificationEventKind,
  isNotificationEventKind,
  isNotificationReadStatus,
  isRequestNotificationEventKind,
  notificationEventsForCreation,
  notificationEventsForJustificationSubmitted,
  notificationEventsForOnlineAccess,
  notificationEventsForRequestReceived,
  notificationEventsForRequestTransition,
  notificationEventsForTransition,
  notificationIdempotencyKey,
  toExternalNotification,
  toNotificationEvent,
} from "./notifications/notification";
export type {
  AppointmentNotificationEvent,
  AppointmentNotificationEventKind,
  ExternalNotification,
  NotificationAudience,
  NotificationContractVersion,
  NotificationEvent,
  NotificationEventInput,
  NotificationEventKind,
  NotificationReadStatus,
  NotificationReference,
  NotificationSubject,
  RequestNotificationAudience,
  RequestNotificationEvent,
  RequestNotificationEventKind,
  RequestNotificationReference,
  RequestNotificationSubject,
} from "./notifications/notification";

// Entrega de avisos por canal: estados, errores, intentos y reintentos (TI2-145, TI2-159).
export {
  MAX_PROVIDER_UNAVAILABLE_ATTEMPTS,
  NOTIFICATION_DELIVERY_CHANNEL_VALUES,
  NOTIFICATION_DELIVERY_ERROR_VALUES,
  NOTIFICATION_DELIVERY_STATUS_VALUES,
  SENDER_SETUP_RETRY_DELAY_MS,
  deliveryRetryAt,
  isNotificationDeliveryChannel,
  isNotificationDeliveryError,
  isNotificationDeliveryStatus,
} from "./notifications/delivery";
export type {
  NotificationDeliveryChannel,
  NotificationDeliveryError,
  NotificationDeliveryState,
  NotificationDeliveryStatus,
} from "./notifications/delivery";

// Registro de seguimiento: acuerdos, tareas y proyección compartida (TI2-106).
export {
  FOLLOW_UP_CONTRACT_VERSION,
  FOLLOW_UP_ENTRIES_MAX,
  FOLLOW_UP_REJECTION_CAUSES,
  FOLLOW_UP_RESPONSIBLE_VALUES,
  FOLLOW_UP_TASK_STATUS_VALUES,
  FOLLOW_UP_TEXT_MAX_LENGTH,
  FOLLOW_UP_VIEW_VALUES,
  admitsFollowUp,
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

// Solicitud de privacidad: derechos, estados, responsable y respuesta fundada (TI2-136).
export {
  INITIAL_PRIVACY_REQUEST_STATUS,
  PENDING_INSTITUTIONAL_DECISIONS,
  PRIVACY_DATA_CONTROLLER,
  PRIVACY_REQUEST_CHANNEL_VALUES,
  PRIVACY_REQUEST_CONTRACT_VERSION,
  PRIVACY_REQUEST_KIND_LABELS,
  PRIVACY_REQUEST_KIND_VALUES,
  PRIVACY_REQUEST_REASON_MAX_LENGTH,
  PRIVACY_REQUEST_REJECTION_CAUSES,
  PRIVACY_REQUEST_RESPONSIBLE_ROLE_VALUES,
  PRIVACY_REQUEST_STATUS_LABELS,
  PRIVACY_REQUEST_STATUS_VALUES,
  PRIVACY_REQUEST_TRANSITIONS,
  PRIVACY_RESPONSE_OUTCOME_VALUES,
  TERMINAL_PRIVACY_REQUEST_STATUSES,
  findPrivacyRequestTransition,
  isPrivacyRequestKind,
  isPrivacyRequestResponsibleRole,
  isPrivacyRequestStatus,
  isPrivacyResponseOutcome,
  isTerminalPrivacyRequestStatus,
  privacyRequestChannelForRole,
  transitionPrivacyRequest,
} from "./privacy/privacy_request";
export type {
  PendingInstitutionalDecision,
  PrivacyDataController,
  PrivacyRequest,
  PrivacyRequestChannel,
  PrivacyRequestContractVersion,
  PrivacyRequestKind,
  PrivacyRequestRejectionCause,
  PrivacyRequestResponse,
  PrivacyRequestResponsibleRole,
  PrivacyRequestStateChange,
  PrivacyRequestStatus,
  PrivacyRequestTransition,
  PrivacyRequestTransitionAttempt,
  PrivacyRequestTransitionResult,
  PrivacyResponseInput,
  PrivacyResponseOutcome,
  TerminalPrivacyRequestStatus,
} from "./privacy/privacy_request";

// Plazos del procedimiento de privacidad: 30 corridos, prórroga, bloqueo y reclamo (TI2-136).
export {
  PRIVACY_AGENCY_CLAIM_BUSINESS_DAYS,
  PRIVACY_EXTENSION_REJECTION_CAUSES,
  PRIVACY_RESPONSE_CALENDAR_DAYS,
  PRIVACY_RESPONSE_EXTENSION_CALENDAR_DAYS,
  PRIVACY_RESPONSE_RULE_VALUES,
  PRIVACY_TEMPORARY_BLOCK_BUSINESS_DAYS,
  applyPrivacyResponseExtension,
  calculatePrivacyAgencyClaimDeadline,
  calculatePrivacyBlockingResponseDeadline,
  calculatePrivacyResponseDeadline,
  isWithinPrivacyDeadline,
} from "./privacy/privacy_deadlines";
export type {
  ExtendedPrivacyResponseDeadline,
  PrivacyAgencyClaimDeadline,
  PrivacyAgencyClaimDeadlineInput,
  PrivacyDeadlineInput,
  PrivacyExtensionRejectionCause,
  PrivacyExtensionResult,
  PrivacyResponseDeadline,
  PrivacyResponseDeadlineInput,
  PrivacyResponseExtension,
  PrivacyResponseRule,
} from "./privacy/privacy_deadlines";

// Controles de privacidad: constancia de envío, bloqueos temporales y conservación (TI2-151).
export {
  PRIVACY_BLOCK_SCOPE_VALUES,
  PRIVACY_BLOCK_STATE_VALUES,
  PRIVACY_CONTROL_REFERENCE_MAX_LENGTH,
  PRIVACY_DATA_CATEGORY_VALUES,
  PRIVACY_RESPONSE_DELIVERY_CHANNEL_VALUES,
  PRIVACY_RETENTION_DISPOSITION_VALUES,
  PRIVACY_RETENTION_EXCEPTION_KIND_VALUES,
  doesPrivacyBlockCoverCategory,
  isPrivacyBlockScope,
  isPrivacyDataCategory,
  isPrivacyResponseDeliveryChannel,
  isPrivacyRetentionDisposition,
  isPrivacyRetentionExceptionActive,
  isPrivacyRetentionExceptionKind,
  isValidPrivacyRetentionDays,
  privacyBlockStateAt,
} from "./privacy/privacy_controls";
export type {
  PrivacyBlockScope,
  PrivacyBlockState,
  PrivacyBlockWindow,
  PrivacyDataCategory,
  PrivacyResponseDeliveryChannel,
  PrivacyResponseDeliveryReceipt,
  PrivacyRetentionDisposition,
  PrivacyRetentionExceptionKind,
  PrivacyRetentionExceptionWindow,
} from "./privacy/privacy_controls";
