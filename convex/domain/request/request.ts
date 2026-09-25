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

import type { ApiResult } from "../errors/api_error";
import { SPRINT_1_REQUEST_STATES, type Sprint1RequestState } from "./state";

/**
 * Tope del texto de necesidades de acceso en caracteres (TI2-23).
 *
 * Valor definitivo del contrato compartido, acordado con TI2-10: el Backend
 * y los consumidores validan con esta constante para no duplicar el número.
 * Se rechaza el exceso en vez de truncarlo, porque recortar necesidades de
 * acceso (Ley 21.719) alteraría en silencio lo que el estudiante declaró.
 */
export const ACCESS_NEEDS_MAX_LENGTH = 2000;

/** Verdadero cuando el texto cabe en el tope del contrato. */
export function isAccessNeedsWithinLimit(text: string): boolean {
  return text.length <= ACCESS_NEEDS_MAX_LENGTH;
}

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
 * una solicitud. El identificador es genérico para no importar
 * `convex/_generated`: con `string` devuelve la entidad canónica y con un
 * `Id` de Convex preserva el tipo para los validadores de la API.
 * No transforma `AccompanimentRequestContent`: convertir el DTO de creación
 * a la forma persistida es alcance de TI2-23.
 */
export function toAccompanimentRequest<RowId extends string, StudentId extends string>(row: {
  readonly _id: RowId;
  readonly studentId: StudentId;
  readonly status: string;
  readonly accessNeeds: string;
  readonly createdAt: number;
}): AccompanimentRequest & { readonly _id: RowId; readonly studentId: StudentId } {
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

/** Campos de la tabla `requests` que salen del contenido estructurado. */
export interface StoredRequestFields {
  readonly accessNeeds: string;
}

/**
 * Serializa el contenido estructurado a la forma persistida (TI2-23).
 *
 * Une las etiquetas de `accessNeeds` más `otherAccessNeed` (si trae texto)
 * separadas por salto de línea. Solo cubre las condiciones de acceso: el
 * resto del contenido (`needSummary`, `expectedOutcome`, modalidad,
 * disponibilidad) aún no tiene columna en el schema de Sprint 1 y queda
 * pendiente de persistencia futura, sin inventarle ubicación.
 *
 * Nunca trunca: si el texto supera `ACCESS_NEEDS_MAX_LENGTH` devuelve error
 * con código estable para que el llamante lo informe sin filtrar detalles
 * internos.
 */
export function toStoredRequestFields(
  content: AccompanimentRequestContent,
): ApiResult<StoredRequestFields> {
  const parts = content.accessNeeds.map((need) => need.label);
  const other = content.otherAccessNeed?.trim();
  if (other) {
    parts.push(other);
  }
  const accessNeeds = parts.join("\n");
  if (!isAccessNeedsWithinLimit(accessNeeds)) {
    return {
      status: "error",
      error: {
        code: "access_needs_too_long",
        message: "El texto de necesidades de acceso supera el máximo permitido.",
      },
    };
  }
  return { status: "ok", data: { accessNeeds } };
}
