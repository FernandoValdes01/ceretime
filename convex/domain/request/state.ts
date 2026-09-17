/**
 * Estados de la solicitud de acompañamiento (TI2-7).
 *
 * Dominio puro: no importa Convex ni frameworks, para poder probarse sin
 * levantar el backend. Los literales usan camelCase, el mismo vocabulario
 * que el flujo de Mobile (`apps/mobile/src/application/student-area-models.ts`),
 * para que Web y Mobile compartan la respuesta sin conversión manual.
 */

/** Estados con operación habilitada en Sprint 1, en orden de flujo. */
export const SPRINT_1_REQUEST_STATES = [
  "received",
  "underReview",
  "awaitingInformationOrAcceptance",
  "accepted",
] as const;

/**
 * Declarados para que nadie invente nombres alternativos, no habilitados:
 * ninguna transición de Sprint 1 llega a ellos. Sus transiciones de origen
 * siguen pendientes de definición en el documento de requerimientos.
 */
export const FUTURE_REQUEST_STATES = [
  "referred",
  "closedWithoutAccompaniment",
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
  underReview: "En revisión",
  awaitingInformationOrAcceptance: "Esperando información o aceptación",
  accepted: "Aceptada",
  referred: "Derivada",
  closedWithoutAccompaniment: "Cerrada sin acompañamiento",
  cancelled: "Cancelada",
};

/** Evita exponer estados que todavía no tienen operación asociada. */
export function isSprint1RequestState(state: RequestState): state is Sprint1RequestState {
  return (SPRINT_1_REQUEST_STATES as readonly RequestState[]).includes(state);
}
