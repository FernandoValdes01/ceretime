/**
 * Barrel de contratos compartidos de dominio (TI2-8).
 *
 * Punto Ãºnico de importaciÃ³n para Web y Mobile: evita que cada consumidor
 * navegue archivo por archivo dentro de `convex/domain`. Todos los contratos
 * son puros: no dependen de Convex ni de `convex/_generated`.
 */

// Identidad, roles y habilitaciÃ³n institucional.
export { ACCOUNT_STATUS_VALUES, INSTITUTIONAL_STATUS_VALUES, ROLE_VALUES } from "./identity/roles";
export type {
  AccountEnablement,
  AccountStatus,
  AuthenticatedProfile,
  InstitutionalStatus,
  Role,
} from "./identity/roles";

// Solicitud de acompaÃ±amiento y sus estados.
export { toAccompanimentRequest } from "./request/request";
export type {
  AccessNeed,
  AccompanimentRequest,
  AccompanimentRequestContent,
  GeneralAvailability,
  ModalityPreference,
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

// AcompaÃ±amiento y sus vistas de lectura.
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

// Errores pÃºblicos y estados de respuesta.
export type { ApiResult, PublicApiError } from "./errors/api_error";
