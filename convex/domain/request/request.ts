/**
 * Solicitud de acompañamiento: DTO de creación y entidad persistida (TI2-8).
 *
 * Dominio puro: no importa Convex ni `convex/_generated`. El contenido que
 * entrega el estudiante (`AccompanimentRequestContent`) y la fila que guarda
 * la tabla `requests` (`StoredAccompanimentRequest`) son formas distintas y
 * no se mezclan: la tabla persiste `accessNeeds` como texto y nombra el
 * estado `status`, mientras el DTO de creación lleva el contenido
 * estructurado. `toStoredAccompanimentRequest` es el adaptador explícito
 * entre ambas formas.
 *
 * Los campos de contenido siguen el mismo vocabulario que el flujo de Mobile
 * (`apps/mobile/src/application/student-area-models.ts`), de modo que un
 * payload de solicitud válido enviado por Mobile se tipa sin conversión
 * manual contra `AccompanimentRequestContent`.
 */

import { SPRINT_1_REQUEST_STATES, type Sprint1RequestState } from "./state";

/** Modalidad de atención preferida por el estudiante en la solicitud. */
export type ModalityPreference = "inPerson" | "online";

/** Condición o apoyo que el estudiante indica para participar y comunicarse. */
export interface AccessNeed {
  readonly id: string;
  readonly label: string;
}

/** Rangos generales de disponibilidad del estudiante para el acompañamiento. */
export interface GeneralAvailability {
  readonly preferredWeekdays: readonly number[];
  readonly preferredTimeRange?: {
    readonly from: string;
    readonly to: string;
  };
}

/**
 * Contenido que el estudiante (o un canal institucional autorizado) entrega
 * al solicitar: necesidad, resultado esperado, condiciones de acceso,
 * modalidad, disponibilidad general y canal accesible para recibir
 * información.
 */
export interface AccompanimentRequestContent {
  needSummary: string;
  expectedOutcome: string;
  accessNeeds: readonly AccessNeed[];
  modalityPreference: ModalityPreference;
  generalAvailability: GeneralAvailability;
  preferredAccessibleInformationChannel: string;
  /** Texto libre para una condición adicional, sin pedir diagnóstico. */
  otherAccessNeed?: string;
}

/**
 * Fila de la tabla `requests` tal como la lee el Backend: espejo exacto de
 * la forma persistida (`_id`, `studentId`, `status`, `accessNeeds` como
 * texto y `createdAt`). Los identificadores son `string` plano para no
 * importar `convex/_generated`; los `Id` de Convex son asignables a `string`
 * y pasan directo al adaptador.
 */
export interface StoredAccompanimentRequest {
  readonly _id: string;
  readonly studentId: string;
  readonly status: Sprint1RequestState;
  readonly accessNeeds: string;
  readonly createdAt: number;
}

/**
 * Adaptador explícito de fila persistida a entidad de dominio. Rechaza un
 * `status` que no sea un estado de Sprint 1 en vez de propagar un literal
 * desconocido: una fila con estado inválido es corrupción, no una solicitud.
 */
export function toStoredAccompanimentRequest(row: {
  readonly _id: string;
  readonly studentId: string;
  readonly status: string;
  readonly accessNeeds: string;
  readonly createdAt: number;
}): StoredAccompanimentRequest {
  if (!(SPRINT_1_REQUEST_STATES as readonly string[]).includes(row.status)) {
    throw new Error(`Estado de solicitud desconocido en la fila ${row._id}: ${row.status}`);
  }
  return {
    _id: row._id,
    studentId: row.studentId,
    status: row.status as Sprint1RequestState,
    accessNeeds: row.accessNeeds,
    createdAt: row.createdAt,
  };
}
