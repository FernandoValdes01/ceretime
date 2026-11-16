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
 * Derivación de salida (TI2-143): CERETI deriva al estudiante a otra unidad.
 * Es terminal y nunca abre acompañamiento. La comunicación con la unidad de
 * destino ocurre fuera de la aplicación.
 */
export const REFERRAL_REQUEST_STATES = ["referred"] as const;

/**
 * Estados terminales que cierran la solicitud sin abrir acompañamiento
 * (TI2-85): el Estudiante cancela la suya y el Profesional con toma activa la
 * cierra. Desde TI2-141 tienen entrada pública y las lecturas los entregan.
 */
export const CLOSURE_REQUEST_STATES = ["closed_without_accompaniment", "cancelled"] as const;

/**
 * Todos los estados de la solicitud, en el orden previo a TI2-85: Sprint 1,
 * derivación y cierres. Son los que declara el contrato público y, desde
 * TI2-143, también los que puede traer una fila de `requests` o de
 * `requestTransitions`: no hay una lista aparte para lo que se guarda.
 */
export const REQUEST_STATES = [
  ...SPRINT_1_REQUEST_STATES,
  ...REFERRAL_REQUEST_STATES,
  ...CLOSURE_REQUEST_STATES,
] as const;

export type Sprint1RequestState = (typeof SPRINT_1_REQUEST_STATES)[number];
export type ReferralRequestState = (typeof REFERRAL_REQUEST_STATES)[number];
export type ClosureRequestState = (typeof CLOSURE_REQUEST_STATES)[number];
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

/**
 * Recibe `string` porque valida lo que trae una fila leída: un literal fuera
 * de la lista es corrupción.
 */
export function isRequestState(state: string): state is RequestState {
  return (REQUEST_STATES as readonly string[]).includes(state);
}
