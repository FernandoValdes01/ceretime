/**
 * Transiciones de solicitud comprometidas en Sprint 1 (TI2-7).
 *
 * Declara qué transiciones existen. No las aplica ni las valida: el rechazo de
 * saltos y la exigencia de motivo son alcance de TI2-21.
 */

import type { Sprint1RequestState } from "./state";

export type RequestStateTransition = {
  readonly from: Sprint1RequestState;
  readonly to: Sprint1RequestState;
  /** El motivo es lo que le explica al estudiante qué información falta. */
  readonly requiresReason: boolean;
};

/**
 * Cualquier par que no esté en esta tabla es inválido, incluidos los saltos y
 * los retrocesos.
 *
 * `from` y `to` se tipan como `Sprint1RequestState`, no `RequestState`: agregar
 * acá una transición hacia un estado de Cycle futuro no compila.
 */
export const SPRINT_1_REQUEST_TRANSITIONS = [
  { from: "received", to: "under_review", requiresReason: false },
  {
    from: "under_review",
    to: "awaiting_information_or_acceptance",
    requiresReason: true,
  },
  { from: "under_review", to: "accepted", requiresReason: false },
  {
    from: "awaiting_information_or_acceptance",
    to: "accepted",
    requiresReason: false,
  },
] as const satisfies readonly RequestStateTransition[];

/**
 * Registro append-only: es la evidencia de trazabilidad que exige la Ley
 * 21.719, no se edita ni se borra.
 *
 * `actorId` sale de la sesión autenticada en la capa de aplicación, nunca de un
 * parámetro del cliente. `reason` es texto para el estudiante, sin diagnósticos
 * ni etiquetas clínicas. `occurredAt` es epoch en milisegundos, como maneja las
 * fechas Convex.
 */
export type RequestStateChange = {
  readonly from: Sprint1RequestState;
  readonly to: Sprint1RequestState;
  readonly actorId: string;
  readonly occurredAt: number;
  readonly reason?: string;
};

/** Llegar acá habilita la apertura de exactamente un acompañamiento (TI2-24). */
export const ACCEPTANCE_STATE: Sprint1RequestState = "accepted";
