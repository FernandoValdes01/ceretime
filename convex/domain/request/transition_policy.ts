/**
 * Política de transición de la solicitud de acompañamiento (TI2-21).
 *
 * Dominio puro: consume la tabla de `transitions.ts` y decide si un intento de
 * cambio de estado procede. No persiste ni muta nada: devuelve un resultado y
 * la capa de aplicación decide qué guardar.
 */

import type { RequestState } from "./state";
import {
  ACCEPTANCE_STATE,
  SPRINT_1_REQUEST_TRANSITIONS,
  type RequestStateChange,
  type RequestStateTransition,
} from "./transitions";

/**
 * `from` y `to` admiten cualquier estado declarado, incluidos los de Cycles
 * futuros: la política es el único punto que los rechaza, así ninguna capa
 * superior necesita filtrarlos antes.
 */
export type RequestTransitionAttempt = {
  readonly from: RequestState;
  readonly to: RequestState;
  readonly actorId: string;
  readonly occurredAt: number;
  readonly reason?: string;
};

/**
 * Los rechazos se devuelven como valor, no como excepción, igual que en
 * `application/session`: la capa pública decide cuánto revela al cliente.
 * Sin actor no hay trazabilidad, por eso su ausencia también rechaza.
 */
export const TRANSITION_REJECTION_CAUSES = [
  "transition_not_allowed",
  "reason_required",
  "actor_required",
] as const;

export type TransitionRejectionCause = (typeof TRANSITION_REJECTION_CAUSES)[number];

export type RequestTransitionResult =
  | {
      readonly status: "applied";
      /** Entrada del registro append-only; la persiste la capa de aplicación. */
      readonly change: RequestStateChange;
      /**
       * Verdadero solo al llegar a `accepted`. Como ninguna transición de
       * Sprint 1 sale de ese estado, se emite una sola vez por solicitud: es la
       * señal con la que TI2-24 abre exactamente un acompañamiento.
       */
      readonly opensAccompaniment: boolean;
    }
  | {
      readonly status: "rejected";
      readonly cause: TransitionRejectionCause;
    };

/** Búsqueda exacta en la tabla: un par ausente es una transición inválida. */
export function findSprint1Transition(
  from: RequestState,
  to: RequestState,
): RequestStateTransition | undefined {
  return SPRINT_1_REQUEST_TRANSITIONS.find(
    (transition) => transition.from === from && transition.to === to,
  );
}

/**
 * `change` se construye desde la fila de la tabla y no desde el intento: así el
 * registro solo puede contener estados de Sprint 1, sin conversiones de tipo.
 */
export function transitionRequest(attempt: RequestTransitionAttempt): RequestTransitionResult {
  const transition = findSprint1Transition(attempt.from, attempt.to);
  if (transition === undefined) return { status: "rejected", cause: "transition_not_allowed" };

  const reason = attempt.reason?.trim();
  const change: RequestStateChange = {
    from: transition.from,
    to: transition.to,
    actorId: attempt.actorId,
    occurredAt: attempt.occurredAt,
    ...(reason ? { reason } : {}),
  };

  return {
    status: "applied",
    change,
    opensAccompaniment: transition.to === ACCEPTANCE_STATE,
  };
}
