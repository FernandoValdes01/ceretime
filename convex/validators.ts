import { v } from "convex/values";
import { ACCOMPANIMENT_STATUS_VALUES } from "./domain/accompaniment/accompaniment";
import {
  ASSIGNMENT_ROLE_VALUES,
  ASSIGNMENT_STATUS_VALUES,
} from "./domain/accompaniment/practitioner_assignment";
import {
  AGENDA_CONTRACT_VERSION,
  AVAILABILITY_MODALITY_VALUES,
} from "./domain/agenda/availability";
import { API_CONTRACT_VERSION } from "./domain/errors/api_error";
import { RESERVATION_STATUS_VALUES } from "./domain/reservations/reservation";
import { SPRINT_1_REQUEST_STATES } from "./domain/request/state";
import {
  ACCOUNT_STATUS_VALUES,
  INSTITUTIONAL_STATUS_VALUES,
  ROLE_VALUES,
} from "./domain/identity/roles";
import { SPACE_CATALOG_CONTRACT_VERSION } from "./domain/spaces/space";
import { RESERVATION_CONTRACT_VERSION } from "./domain/reservations/reservation";

/**
 * Validadores compartidos de identidad, roles y agenda versionada.
 *
 * Borde que conecta con la base de datos y la API: convierten a validadores de
 * Convex los literales cuyo contrato singular vive en `convex/domain`. No son
 * una segunda fuente de verdad; si cambia un literal, cambia solo en el
 * dominio y este archivo lo refleja. TI2-87 suma la agenda sin duplicar la
 * API: las entradas públicas reutilizan estos validadores.
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

/**
 * Contratos públicos de agenda versionados (TI2-87), derivados del dominio.
 *
 * La versión viaja en cada proyección para que Web y Mobile detecten el
 * contrato sin inventar endpoints ni estados paralelos. Un cambio
 * incompatible sumaría `v2` sin alterar `v1`.
 */
export const agendaContractVersion = v.literal(AGENDA_CONTRACT_VERSION);

export const spaceCatalogContractVersion = v.literal(SPACE_CATALOG_CONTRACT_VERSION);

export const reservationContractVersion = v.literal(RESERVATION_CONTRACT_VERSION);

export const apiContractVersion = v.literal(API_CONTRACT_VERSION);

export const availabilityModalityUnion = v.union(
  ...AVAILABILITY_MODALITY_VALUES.map((value) => v.literal(value)),
);

export const reservationStatusUnion = v.union(
  ...RESERVATION_STATUS_VALUES.map((value) => v.literal(value)),
);

const availabilityWeekdays = [0, 1, 2, 3, 4, 5, 6] as const;

export const availabilityWeekdayUnion = v.union(
  ...availabilityWeekdays.map((day) => v.literal(day)),
);

/** Espacio del catálogo tal como lo lee la entrada pública versionada. */
export const spaceValidator = v.object({
  id: v.string(),
  campus: v.string(),
  building: v.string(),
  floor: v.string(),
  room: v.string(),
  accessConditions: v.string(),
  arrivalInstructions: v.string(),
  version: spaceCatalogContractVersion,
});

/** Bloque recurrente tal como lo valida la entrada pública versionada. */
export const recurringAvailabilityBlockValidator = v.object({
  id: v.string(),
  professionalId: v.string(),
  weekday: availabilityWeekdayUnion,
  from: v.string(),
  to: v.string(),
  durationMinutes: v.number(),
  modality: availabilityModalityUnion,
  spaceId: v.optional(v.string()),
  version: agendaContractVersion,
});
