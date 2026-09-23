import { v } from "convex/values";
import { ACCOMPANIMENT_STATUS_VALUES } from "./domain/accompaniment/accompaniment";
import {
  ASSIGNMENT_ROLE_VALUES,
  ASSIGNMENT_STATUS_VALUES,
} from "./domain/accompaniment/practitioner_assignment";
import { SPRINT_1_REQUEST_STATES } from "./domain/request/state";
import {
  ACCOUNT_STATUS_VALUES,
  INSTITUTIONAL_STATUS_VALUES,
  ROLE_VALUES,
} from "./domain/identity/roles";

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
 * Estados de solicitud habilitados en Sprint 1, derivados de los literales
 * del dominio (TI2-7) para que el esquema no defina nombres por su cuenta.
 */
const requestStatusLiterals = SPRINT_1_REQUEST_STATES.map((state) => v.literal(state));

export const requestStatusUnion = v.union(...requestStatusLiterals);
