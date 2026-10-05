import { v } from "convex/values";
import { ACCOMPANIMENT_STATUS_VALUES } from "./domain/accompaniment/accompaniment";
import { APPOINTMENT_STATUS_VALUES } from "./domain/appointments/appointment";
import {
  AVAILABILITY_EXCEPTION_KIND_VALUES,
  MODALITY_VALUES,
} from "./domain/availability/availability";
import {
  ASSIGNMENT_ROLE_VALUES,
  ASSIGNMENT_STATUS_VALUES,
} from "./domain/accompaniment/practitioner_assignment";
import { PERSISTABLE_REQUEST_STATES, SPRINT_1_REQUEST_STATES } from "./domain/request/state";
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
 * Estados de solicitud del contrato de presentación (Sprint 1, TI2-7): lo que
 * la API pública devuelve hoy. Derivados del dominio para que el esquema no
 * defina nombres por su cuenta. Mantenerlo en 4 estados conserva intactos
 * los tipos que Web y Mobile derivan de `api.presentation.*`; TI2-85 lo
 * ampliará con su mapping y coordinación TI4.
 */
const requestStatusLiterals = SPRINT_1_REQUEST_STATES.map((state) => v.literal(state));

export const requestStatusUnion = v.union(...requestStatusLiterals);

/**
 * Estados de solicitud persistibles (TI2-83 adapta validadores para TI2-85):
 * operativos de Sprint 1 más `closed_without_accompaniment` y `cancelled`,
 * sin `referred`. Solo esquema (`requests`, `requestTransitions`) y
 * adaptación de lectura; la presentación sigue en 4 estados hasta el
 * mapping de TI2-85.
 */
export const persistableRequestStatusUnion = v.union(
  ...PERSISTABLE_REQUEST_STATES.map((state) => v.literal(state)),
);

/**
 * Modalidades de atención de la agenda (TI2-83), derivadas de los literales
 * del dominio para que el esquema no defina nombres por su cuenta.
 */
export const modalityUnion = v.union(...MODALITY_VALUES.map((value) => v.literal(value)));

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
