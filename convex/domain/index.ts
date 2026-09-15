/**
 * Barrel de contratos compartidos de dominio (TI2-8).
 *
 * Punto único de importación para Web y Mobile: evita que cada consumidor
 * navegue archivo por archivo dentro de `convex/domain`.
 */

// Identidad, roles y habilitación institucional.
export type {
  AccountEnablement,
  AccountStatus,
  AuthenticatedProfile,
  InstitutionalStatus,
  Role,
} from "./identity/roles";

// Solicitud de acompañamiento y sus estados.
export type { AccompanimentRequest } from "./request/request";
export {
  FUTURE_REQUEST_STATES,
  INITIAL_REQUEST_STATE,
  isSprint1RequestState,
  REQUEST_STATES,
  SPRINT_1_REQUEST_STATES,
} from "./request/state";
export type { FutureRequestState, RequestState, Sprint1RequestState } from "./request/state";

// Acompañamiento y asignaciones de acceso.
export type { Accompaniment, AccompanimentStatus } from "./accompaniment/accompaniment";
export type {
  AssignmentRole,
  AssignmentStatus,
  PractitionerAssignment,
} from "./accompaniment/practitioner-assignment";

// Errores públicos y estados de respuesta.
export type { ApiResult, PublicApiError } from "./errors/api-error";
