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
 * Declarado para que nadie invente un nombre alternativo, no habilitado:
 * ninguna transición llega a él. La derivación exige contacto y aceptación
 * del estudiante antes de abrir acompañamiento (RN-24) y su flujo sigue
 * pendiente de definición en el documento de requerimientos.
 */
export const FUTURE_REQUEST_STATES = ["referred"] as const;

/**
 * Estados terminales que cierran la solicitud sin abrir acompañamiento
 * (TI2-85): el Estudiante cancela la suya y el Profesional con toma activa la
 * cierra. Operan en Dominio y Aplicación; `api.presentation.*` todavía no los
 * entrega (ver `toSprint1AccompanimentRequest`).
 */
export const CLOSURE_REQUEST_STATES = ["closed_without_accompaniment", "cancelled"] as const;

/** Conserva el orden previo a TI2-85: Sprint 1, derivación y cierres. */
export const REQUEST_STATES = [
  ...SPRINT_1_REQUEST_STATES,
  ...FUTURE_REQUEST_STATES,
  ...CLOSURE_REQUEST_STATES,
] as const;

export type Sprint1RequestState = (typeof SPRINT_1_REQUEST_STATES)[number];
export type FutureRequestState = (typeof FUTURE_REQUEST_STATES)[number];
export type ClosureRequestState = (typeof CLOSURE_REQUEST_STATES)[number];
export type RequestState = (typeof REQUEST_STATES)[number];

/**
 * Estados que puede traer una fila de `requests` o de `requestTransitions`:
 * los operativos de Sprint 1 más los cierres de TI2-85. `referred` sigue sin
 * habilitarse porque no tiene reglas ni proyección acordada.
 */
export const PERSISTABLE_REQUEST_STATES = [
  ...SPRINT_1_REQUEST_STATES,
  ...CLOSURE_REQUEST_STATES,
] as const;

export type PersistableRequestState = (typeof PERSISTABLE_REQUEST_STATES)[number];

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

/** Evita exponer estados que el contrato público todavía no entrega. */
export function isSprint1RequestState(state: RequestState): state is Sprint1RequestState {
  return (SPRINT_1_REQUEST_STATES as readonly RequestState[]).includes(state);
}

/**
 * Recibe `string` porque valida lo que trae una fila leída: un literal fuera
 * de la lista es corrupción o un estado sin reglas, como `referred`.
 */
export function isPersistableRequestState(state: string): state is PersistableRequestState {
  return (PERSISTABLE_REQUEST_STATES as readonly string[]).includes(state);
}
