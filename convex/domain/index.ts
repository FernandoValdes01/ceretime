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

// Solicitud de acompañamiento y sus estados.
export {
  ACCESS_NEEDS_MAX_LENGTH,
  isAccessNeedsWithinLimit,
  toAccessNeedsText,
  toAccompanimentRequest,
  toStoredRequestFields,
} from "./requests/request";
export type {
  AccessNeed,
  AccompanimentRequest,
  AccompanimentRequestContent,
  GeneralAvailability,
  ModalityPreference,
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

// Atención reservada: reserva y atención en una sola entidad (TI2-87).
export {
  APPOINTMENT_CONTRACT_VERSION,
  APPOINTMENT_STATUS_VALUES,
  INITIAL_APPOINTMENT_STATUS,
} from "./appointments/appointment";
export type {
  Appointment,
  AppointmentContractVersion,
  AppointmentPage,
  AppointmentStatus,
  ListAppointmentsInput,
} from "./appointments/appointment";
