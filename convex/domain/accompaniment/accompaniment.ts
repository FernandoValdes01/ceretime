/**
 * Entidad de acompañamiento y sus vistas de lectura (TI2-8).
 *
 * Dominio puro: no importa Convex ni `convex/_generated`. La respuesta del
 * Backend viene con `_id` (el id que Convex entrega en cada documento), así
 * que el contrato usa `_id` y no `id`. `accessNeeds` es información sensible
 * (Ley 21.719): la vista minimizada para Practicante no la incluye y eso se
 * decide en la capa de autorización, no en este tipo.
 *
 * Los identificadores son genéricos con `string` por defecto: Web y Mobile
 * consumen el DTO con `string` plano (así viaja en JSON), mientras la capa
 * de Aplicación instancia la proyección con los `Id` de Convex y conserva
 * el tipado sin duplicar la forma. `toAccompanimentProjection` es el único
 * adaptador entre la fila persistida y la vista devuelta.
 */

/** Estados del acompañamiento (activo, pausado, cerrado). */
export const ACCOMPANIMENT_STATUS_VALUES = ["active", "paused", "closed"] as const;

export type AccompanimentStatus = (typeof ACCOMPANIMENT_STATUS_VALUES)[number];

/**
 * Objetivo con que se abre el acompañamiento (TI2-24).
 *
 * Dominio puro: recorta el texto del profesional y rechaza el vacío, sin
 * persistir nada. La solicitud no trae objetivo, así que quien acepta lo
 * aporta; convertir el contenido estructurado a la forma persistida es
 * alcance de TI2-23.
 */
export function toOpeningObjective(raw: string): string | null {
  const objective = raw.trim();
  return objective === "" ? null : objective;
}

/** Vista de lectura de un acompañamiento: completa o minimizada. */
export const ACCOMPANIMENT_VIEW_VALUES = ["full", "minimized"] as const;

export type AccompanimentView = (typeof ACCOMPANIMENT_VIEW_VALUES)[number];

/**
 * Fila mínima de la tabla `accompaniments` que necesita la proyección.
 * Espejo de la forma persistida; la decisión de qué vista devolver vive en
 * la capa de autorización, no acá.
 */
export interface AccompanimentRow<
  AccompanimentId extends string = string,
  UserId extends string = string,
> {
  readonly _id: AccompanimentId;
  readonly studentId: UserId;
  readonly status: AccompanimentStatus;
  readonly objective: string;
  readonly accessNeeds: string;
}

/**
 * Vista completa de un acompañamiento, para el Estudiante acompañado y el
 * Profesional asignado. Incluye `studentId` y `accessNeeds`.
 */
export interface Accompaniment<
  AccompanimentId extends string = string,
  UserId extends string = string,
> {
  _id: AccompanimentId;
  studentId: UserId;
  status: AccompanimentStatus;
  objective: string;
  accessNeeds: string;
  view: "full";
}

/**
 * Vista minimizada de un acompañamiento, para el Practicante asignado:
 * sin `studentId` ni `accessNeeds`.
 */
export interface MinimizedAccompaniment<AccompanimentId extends string = string> {
  _id: AccompanimentId;
  status: AccompanimentStatus;
  objective: string;
  view: "minimized";
}

/** Cualquier vista de acompañamiento que el Backend puede devolver. */
export type AccompanimentProjection<
  AccompanimentId extends string = string,
  UserId extends string = string,
> = Accompaniment<AccompanimentId, UserId> | MinimizedAccompaniment<AccompanimentId>;

/**
 * Adaptador explícito de fila persistida a vista de lectura. La vista ya
 * viene decidida por la capa de autorización; acá solo se recorta la forma.
 * La vista minimizada nunca expone `studentId` ni `accessNeeds`, aunque la
 * fila los traiga.
 */
export function toAccompanimentProjection<AccompanimentId extends string, UserId extends string>(
  row: AccompanimentRow<AccompanimentId, UserId>,
  view: AccompanimentView,
): AccompanimentProjection<AccompanimentId, UserId> {
  if (view === "minimized") {
    return {
      _id: row._id,
      status: row.status,
      objective: row.objective,
      view: "minimized",
    };
  }
  return {
    _id: row._id,
    studentId: row.studentId,
    status: row.status,
    objective: row.objective,
    accessNeeds: row.accessNeeds,
    view: "full",
  };
}
