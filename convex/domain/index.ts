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
} from "./accompaniments/accompaniment";
export type {
  Accompaniment,
  AccompanimentProjection,
  AccompanimentRow,
  AccompanimentStatus,
  AccompanimentView,
  MinimizedAccompaniment,
} from "./accompaniments/accompaniment";

// Asignaciones de acceso y sus permisos de lectura.
export {
  ASSIGNMENT_ROLE_VALUES,
  ASSIGNMENT_STATUS_VALUES,
  ASSIGNMENT_VIEW_BY_ROLE,
} from "./accompaniments/assignment";
export { toAssignmentReadPermission } from "./accompaniments/assignment";
export type {
  AccompanimentAssignment,
  AssignmentReadPermission,
  AssignmentRole,
  AssignmentStatus,
} from "./accompaniments/assignment";

// Concesión y revocación de acceso de Practicante (`intern`).
export {
  checkGrantInternAccess,
  checkRevokeInternAccess,
  isAuthorizedProfessionalCaller,
} from "./accompaniments/intern_access";
export type {
  InternAccessAccountStatus,
  InternAccessCaller,
  InternAccessCheck,
  InternAccessInstitutionalStatus,
  InternAccessRejectionReason,
  InternAccessRole,
  InternAccessTarget,
  InternRevokeCheck,
  InternRevokeRejectionReason,
} from "./accompaniments/intern_access";

// Errores públicos y estados de respuesta.
export type { ApiResult, PublicApiError } from "./errors/api_error";
