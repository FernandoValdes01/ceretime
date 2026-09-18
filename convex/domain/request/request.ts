/**
 * Solicitud de acompañamiento: DTO de creación y entidad pública (TI2-8).
 *
 * Dominio puro: no importa Convex ni `convex/_generated`. Se nombra
 * `AccompanimentRequest` y no `Request` porque `convex/tsconfig.json`
 * incluye `dom` en `lib`, y `Request` ya existe como tipo global de fetch
 * dentro de los archivos de Convex. Ver hilo de TI2-7 para el detalle.
 *
 * El contenido que entrega el estudiante (`AccompanimentRequestContent`) y
 * la entidad pública (`AccompanimentRequest`) son formas distintas y no se
 * mezclan: la tabla `requests` persiste `accessNeeds` como texto y nombra
 * el estado `status`, mientras el DTO de creación lleva el contenido
 * estructurado.
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
 * Entidad pública de solicitud (TI2-8): espejo exacto de la fila de la tabla
 * `requests` tal como la lee el Backend (`_id`, `studentId`, `status`,
 * `accessNeeds` como texto y `createdAt`). Un documento real de la tabla se
 * asigna directo a este tipo. Los identificadores son `string` plano para
 * no importar `convex/_generated`; los `Id` de Convex son asignables a
 * `string` y pasan directo al adaptador.
 */
export interface AccompanimentRequest {
  readonly _id: string;
  readonly studentId: string;
  readonly status: Sprint1RequestState;
  readonly accessNeeds: string;
  readonly createdAt: number;
}

/**
 * Valida una fila persistida de `requests` y devuelve la entidad pública.
 * Rechaza un `status` que no sea un estado de Sprint 1 en vez de propagar
 * un literal desconocido: una fila con estado inválido es corrupción, no
 * una solicitud. No transforma `AccompanimentRequestContent`: serializar el
 * DTO de creación a la forma persistida es alcance de TI2-23.
 */
export function toAccompanimentRequest(row: {
  readonly _id: string;
  readonly studentId: string;
  readonly status: string;
  readonly accessNeeds: string;
  readonly createdAt: number;
}): AccompanimentRequest {
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
