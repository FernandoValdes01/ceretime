/**
 * Estados de la solicitud de acompañamiento (TI2-7).
 *
 * Dominio puro: no importa Convex ni frameworks, para poder probarse sin
 * levantar el backend. Los literales se mantienen en snake_case porque son
 * los valores persistidos: la columna `status` de la tabla `requests` y las
 * transiciones de TI2-21 ya operan con ellos. Cambiar el vocabulario
 * persistido exigiría una migración con compatibilidad de lectura.
 */

/** Estados con operación habilitada en Sprint 1, en orden de flujo. */
export const SPRINT_1_REQUEST_STATES = [
  "received",
  "under_review",
  "awaiting_information_or_acceptance",
  "accepted",
] as const;

/**
 * Declarados para que nadie invente nombres alternativos, no habilitados:
 * ninguna transición de Sprint 1 llega a ellos. Sus transiciones de origen
 * siguen pendientes de definición en el documento de requerimientos.
 */
export const FUTURE_REQUEST_STATES = [
  "referred",
  "closed_without_accompaniment",
  "cancelled",
] as const;

export const REQUEST_STATES = [...SPRINT_1_REQUEST_STATES, ...FUTURE_REQUEST_STATES] as const;

export type Sprint1RequestState = (typeof SPRINT_1_REQUEST_STATES)[number];
export type FutureRequestState = (typeof FUTURE_REQUEST_STATES)[number];
export type RequestState = (typeof REQUEST_STATES)[number];

export const INITIAL_REQUEST_STATE: Sprint1RequestState = "received";

/**
 * Etiqueta en español de cada estado de solicitud, para que Web y Mobile
 * muestren el mismo lenguaje al estudiante (fuente: especificación del
 * prototipo).
 */
export const REQUEST_STATE_LABELS: Record<RequestState, string> = {
  received: "Recibida",
  under_review: "En revisión",
  awaiting_information_or_acceptance: "Esperando información o aceptación",
  accepted: "Aceptada",
  referred: "Derivada",
  closed_without_accompaniment: "Cerrada sin acompañamiento",
  cancelled: "Cancelada",
};

/** Evita exponer estados que todavía no tienen operación asociada. */
export function isSprint1RequestState(state: RequestState): state is Sprint1RequestState {
  return (SPRINT_1_REQUEST_STATES as readonly RequestState[]).includes(state);
}
