/**
 * Barrel de contratos compartidos de dominio (TI2-8, TI2-87).
 *
 * Punto único de importación para Web y Mobile: evita que cada consumidor
 * navegue archivo por archivo dentro de `convex/domain`. Todos los contratos
 * son puros: no dependen de Convex ni de `convex/_generated`. TI2-87 suma la
 * agenda versionada sin duplicar la API Convex: la superficie sigue siendo
 * `api.presentation.*` y este barrel solo fija la forma v1.
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

// Solicitud de acompañamiento y sus estados.
export {
  ACCESS_NEEDS_MAX_LENGTH,
  isAccessNeedsWithinLimit,
  toAccessNeedsText,
  toAccompanimentRequest,
  toStoredRequestFields,
} from "./request/request";
export type {
  AccessNeed,
  AccompanimentRequest,
  AccompanimentRequestContent,
  GeneralAvailability,
  ModalityPreference,
  StoredRequestFields,
} from "./request/request";
export {
  FUTURE_REQUEST_STATES,
  INITIAL_REQUEST_STATE,
  isSprint1RequestState,
  REQUEST_STATES,
  REQUEST_STATE_LABELS,
  SPRINT_1_REQUEST_STATES,
} from "./request/state";
export type { FutureRequestState, RequestState, Sprint1RequestState } from "./request/state";

// Acompañamiento y sus vistas de lectura.
export {
  ACCOMPANIMENT_STATUS_VALUES,
  ACCOMPANIMENT_VIEW_VALUES,
  toAccompanimentProjection,
} from "./accompaniment/accompaniment";
export type {
  Accompaniment,
  AccompanimentProjection,
  AccompanimentRow,
  AccompanimentStatus,
  AccompanimentView,
  MinimizedAccompaniment,
} from "./accompaniment/accompaniment";

// Asignaciones de acceso y sus permisos de lectura.
export {
  ASSIGNMENT_ROLE_VALUES,
  ASSIGNMENT_STATUS_VALUES,
  ASSIGNMENT_VIEW_BY_ROLE,
} from "./accompaniment/practitioner_assignment";
export { toAssignmentReadPermission } from "./accompaniment/practitioner_assignment";
export type {
  AssignmentReadPermission,
  AssignmentRole,
  AssignmentStatus,
  PractitionerAssignment,
} from "./accompaniment/practitioner_assignment";

// Errores públicos y estados de respuesta.
export {
  API_CONTRACT_VERSION,
  AVAILABILITY_ERROR_CODES,
  PUBLIC_ERROR_CODES,
  PUBLIC_ERROR_MESSAGES,
  RESERVATION_ERROR_CODES,
  SPACE_ERROR_CODES,
  SPRINT_1_ERROR_CODES,
  toPublicApiError,
  withContractVersion,
} from "./errors/api_error";
export type {
  ApiContractVersion,
  ApiResult,
  PublicApiError,
  PublicErrorCode,
  VersionedApiResult,
} from "./errors/api_error";

// Disponibilidad de agenda versionada (TI2-87): bloques, excepciones y franjas.
export {
  AGENDA_CONTRACT_VERSION,
  AVAILABILITY_MAX_ITEMS_PER_READ,
  AVAILABILITY_MODALITY_VALUES,
  AVAILABILITY_SLOT_MINUTES_MAX,
  AVAILABILITY_SLOT_MINUTES_MIN,
  isAvailabilityModality,
  isDurationWithinLimit,
  isTimeRangeOrdered,
  isValidDateLabel,
  isValidTimeLabel,
  isValidWeekday,
  toVersionedAvailabilityBlock,
} from "./agenda/availability";
export type {
  AgendaContractVersion,
  AvailabilityException,
  AvailabilityModality,
  AvailabilitySlot,
  RecurringAvailabilityBlock,
} from "./agenda/availability";

// Catálogo de espacios versionado (TI2-87): lectura propia sin reglas de negocio.
export {
  isSpaceLimitWithinCatalog,
  SPACE_CATALOG_CONTRACT_VERSION,
  SPACE_CATALOG_MAX_ITEMS,
  toSpaceLabel,
  toVersionedSpace,
} from "./spaces/space";
export type { Space, SpaceCatalogContractVersion } from "./spaces/space";

// Reserva de atención versionada (TI2-87): estados y forma sin transiciones.
export {
  isReservationRangeOrdered,
  isReservationStatus,
  JUSTIFICATION_WINDOW_BUSINESS_DAYS,
  RESERVATION_CONTRACT_VERSION,
  RESERVATION_STATUS_LABELS,
  RESERVATION_STATUS_VALUES,
  toReservation,
} from "./reservations/reservation";
export type {
  Reservation,
  ReservationContractVersion,
  ReservationStatus,
} from "./reservations/reservation";
