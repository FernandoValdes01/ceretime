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
 * Sin actor ni instante válido no hay trazabilidad, por eso ambos rechazan:
 * `number` admite `NaN`, `Infinity` y negativos, el tipo no protege de eso.
 */
export const TRANSITION_REJECTION_CAUSES = [
  "transition_not_allowed",
  "actor_required",
  "occurred_at_invalid",
  "reason_required",
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
 * Todo rechazo retorna antes de construir `change`: un intento inválido no deja
 * registro porque el registro nunca llega a existir. Las causas se evalúan de
 * la más general a la más específica, así la que se reporta es la primera que
 * el llamador tiene que resolver.
 *
 * `change` se construye desde la fila de la tabla y no desde el intento: así el
 * registro solo puede contener estados de Sprint 1, sin conversiones de tipo.
 */
export function transitionRequest(attempt: RequestTransitionAttempt): RequestTransitionResult {
  const transition = findSprint1Transition(attempt.from, attempt.to);
  if (transition === undefined) return { status: "rejected", cause: "transition_not_allowed" };

  const actorId = attempt.actorId.trim();
  if (actorId === "") return { status: "rejected", cause: "actor_required" };

  if (!Number.isFinite(attempt.occurredAt) || attempt.occurredAt <= 0) {
    return { status: "rejected", cause: "occurred_at_invalid" };
  }

  const reason = attempt.reason?.trim();
  if (transition.requiresReason && !reason) return { status: "rejected", cause: "reason_required" };

  const change: RequestStateChange = {
    from: transition.from,
    to: transition.to,
    actorId,
    occurredAt: attempt.occurredAt,
    ...(reason ? { reason } : {}),
  };

  return {
    status: "applied",
    change,
    opensAccompaniment: transition.to === ACCEPTANCE_STATE,
  };
}
