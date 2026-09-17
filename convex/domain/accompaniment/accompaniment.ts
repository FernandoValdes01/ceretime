/**
 * Entidad de acompañamiento y sus vistas de lectura (TI2-8).
 *
 * Dominio puro: no importa Convex ni `convex/_generated`. La respuesta del
 * Backend viene con `_id` (el id que Convex entrega en cada documento), así
 * que el contrato usa `_id` y no `id`. `accessNeeds` es información sensible
 * (Ley 21.719): la vista minimizada para Practicante no la incluye y eso se
 * decide en la capa de autorización, no en este tipo.
 */

/** Estados del acompañamiento (activo, pausado, cerrado). */
export const ACCOMPANIMENT_STATUS_VALUES = ["active", "paused", "closed"] as const;

export type AccompanimentStatus = (typeof ACCOMPANIMENT_STATUS_VALUES)[number];

/** Vista de lectura de un acompañamiento: completa o minimizada. */
export const ACCOMPANIMENT_VIEW_VALUES = ["full", "minimized"] as const;

export type AccompanimentView = (typeof ACCOMPANIMENT_VIEW_VALUES)[number];

/**
 * Vista completa de un acompañamiento, para el Estudiante acompañado y el
 * Profesional asignado. Incluye `studentId` y `accessNeeds`.
 */
export interface Accompaniment {
  _id: string;
  studentId: string;
  status: AccompanimentStatus;
  objective: string;
  accessNeeds: string;
  view: "full";
}

/**
 * Vista minimizada de un acompañamiento, para el Practicante asignado:
 * sin `studentId` ni `accessNeeds`.
 */
export interface MinimizedAccompaniment {
  _id: string;
  status: AccompanimentStatus;
  objective: string;
  view: "minimized";
}

/** Cualquier vista de acompañamiento que el Backend puede devolver. */
export type AccompanimentProjection = Accompaniment | MinimizedAccompaniment;
