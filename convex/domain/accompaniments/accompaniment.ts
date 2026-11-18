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
 * los tipos sin duplicar la forma. `toAccompanimentProjection` es el único
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

/**
 * Cambios de estado del acompañamiento (TI2-152): pausar, reactivar y cerrar.
 *
 * `closed` no puede ser origen: un acompañamiento cerrado no se reabre ni
 * vuelve a pausarse, y una necesidad posterior comienza con otra solicitud.
 * El tipo de `from` lo excluye, así que agregar una salida desde `closed` no
 * compila. Un par ausente de esta tabla es una transición inválida.
 */
export type AccompanimentStateTransition = {
  readonly from: Exclude<AccompanimentStatus, "closed">;
  readonly to: AccompanimentStatus;
};

export const ACCOMPANIMENT_TRANSITIONS = [
  { from: "active", to: "paused" },
  { from: "paused", to: "active" },
  { from: "active", to: "closed" },
  { from: "paused", to: "closed" },
] as const satisfies readonly AccompanimentStateTransition[];

/** Tope del motivo opcional de un cambio de estado. */
export const ACCOMPANIMENT_REASON_MAX_LENGTH = 500;

/**
 * Motivo con que el cierre cancela las atenciones futuras. La cancelación de
 * CERETI exige motivo; el cierre no pide uno, así que usa este texto fijo y
 * nunca copia el motivo opcional del cierre a las atenciones.
 */
export const ACCOMPANIMENT_CLOSURE_CANCEL_REASON = "Cierre del acompañamiento";

export type AccompanimentTransitionAttempt = {
  readonly from: AccompanimentStatus;
  readonly to: AccompanimentStatus;
  readonly actorId: string;
  readonly occurredAt: number;
  readonly reason?: string;
};

/**
 * Entrada del historial de estados: el intento ya aceptado, con el origen de
 * una transición válida y el motivo solo si se entregó.
 */
export type AccompanimentStateChange = AccompanimentTransitionAttempt &
  AccompanimentStateTransition;

export const ACCOMPANIMENT_TRANSITION_REJECTION_CAUSES = [
  "transition_not_allowed",
  "actor_required",
  "occurred_at_invalid",
  "reason_too_long",
] as const;

export type AccompanimentTransitionRejectionCause =
  (typeof ACCOMPANIMENT_TRANSITION_REJECTION_CAUSES)[number];

export type AccompanimentTransitionResult =
  | { readonly status: "applied"; readonly change: AccompanimentStateChange }
  | { readonly status: "rejected"; readonly cause: AccompanimentTransitionRejectionCause };

/**
 * Decide si un cambio de estado procede, sin persistir nada.
 *
 * El motivo es opcional en todos los cambios: en blanco equivale a no
 * entregarlo. Los rechazos se devuelven como valor y ninguno construye
 * `change`, así un intento inválido no deja entrada en el historial.
 */
export function transitionAccompaniment(
  attempt: AccompanimentTransitionAttempt,
): AccompanimentTransitionResult {
  const transition = ACCOMPANIMENT_TRANSITIONS.find(
    (candidate) => candidate.from === attempt.from && candidate.to === attempt.to,
  );
  if (transition === undefined) return { status: "rejected", cause: "transition_not_allowed" };

  const actorId = attempt.actorId.trim();
  if (actorId === "") return { status: "rejected", cause: "actor_required" };

  if (!Number.isFinite(attempt.occurredAt) || attempt.occurredAt <= 0) {
    return { status: "rejected", cause: "occurred_at_invalid" };
  }

  const reason = attempt.reason?.trim();
  if (reason !== undefined && reason.length > ACCOMPANIMENT_REASON_MAX_LENGTH) {
    return { status: "rejected", cause: "reason_too_long" };
  }

  return {
    status: "applied",
    change: {
      from: transition.from,
      to: transition.to,
      actorId,
      occurredAt: attempt.occurredAt,
      ...(reason ? { reason } : {}),
    },
  };
}
