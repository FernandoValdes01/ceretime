/**
 * Barrel de contratos compartidos de dominio (TI2-8).
 *
 * Punto único de importación para Web y Mobile: evita que cada consumidor
 * navegue archivo por archivo dentro de `convex/domain`. Todos los contratos
 * son puros: no dependen de Convex ni de `convex/_generated`.
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
  PERSISTABLE_REQUEST_STATES,
  REQUEST_STATES,
  REQUEST_STATE_LABELS,
  SPRINT_1_REQUEST_STATES,
} from "./request/state";
export type {
  FutureRequestState,
  PersistableRequestState,
  RequestState,
  Sprint1RequestState,
} from "./request/state";

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

// Vocabulario persistido de disponibilidad (TI2-83): literales para los
// validadores del borde, sin reglas (TI2-81/TI2-82).
export {
  AVAILABILITY_EXCEPTION_KIND_VALUES,
  DAY_END_MINUTE,
  DAY_START_MINUTE,
  MODALITY_VALUES,
  WEEKDAY_MAX,
  WEEKDAY_MIN,
} from "./availability/availability";
export type { AvailabilityExceptionKind, Modality } from "./availability/availability";

// Vocabulario persistido de la atención reservada (TI2-83): literales para
// los validadores del borde, sin transiciones (TI2-93).
export { APPOINTMENT_STATUS_VALUES, INITIAL_APPOINTMENT_STATUS } from "./appointments/appointment";
export type { AppointmentStatus } from "./appointments/appointment";

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
export type { ApiResult, PublicApiError } from "./errors/api_error";
