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

import { deriveCoordinationReferenceCode } from "../availability/official_channel";

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
 * la capa de autorización, no acá. `requestId` es la solicitud aceptada que
 * lo abrió; falta en los acompañamientos que no nacieron de una solicitud.
 */
export interface AccompanimentRow<
  AccompanimentId extends string = string,
  UserId extends string = string,
  RequestId extends string = string,
> {
  readonly _id: AccompanimentId;
  readonly studentId: UserId;
  readonly status: AccompanimentStatus;
  readonly objective: string;
  readonly accessNeeds: string;
  readonly requestId?: RequestId;
}

/**
 * Vista completa de un acompañamiento, para el Estudiante acompañado y el
 * Profesional asignado. Incluye `studentId`, `accessNeeds`, el `referenceCode`
 * que el Estudiante recibe al no encontrar horario compatible (TI2-144) y, si
 * lo abrió una solicitud aceptada, su `requestId` (TI2-183) para enlazar ambos.
 */
export interface Accompaniment<
  AccompanimentId extends string = string,
  UserId extends string = string,
  RequestId extends string = string,
> {
  _id: AccompanimentId;
  studentId: UserId;
  status: AccompanimentStatus;
  objective: string;
  accessNeeds: string;
  referenceCode: string;
  requestId?: RequestId;
  view: "full";
}

/**
 * Vista minimizada de un acompañamiento, para el Practicante asignado:
 * sin `studentId`, `accessNeeds`, `referenceCode` ni `requestId`.
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
  RequestId extends string = string,
> = Accompaniment<AccompanimentId, UserId, RequestId> | MinimizedAccompaniment<AccompanimentId>;

/**
 * Vista completa de una fila. El `referenceCode` se deriva del `_id` con la
 * misma función que usa `searchSlots`, así el Profesional reconoce el código
 * que el Estudiante entrega por un canal oficial; no se persiste.
 */
export function toFullAccompaniment<
  AccompanimentId extends string,
  UserId extends string,
  RequestId extends string,
>(
  row: AccompanimentRow<AccompanimentId, UserId, RequestId>,
): Accompaniment<AccompanimentId, UserId, RequestId> {
  return {
    _id: row._id,
    studentId: row.studentId,
    status: row.status,
    objective: row.objective,
    accessNeeds: row.accessNeeds,
    referenceCode: deriveCoordinationReferenceCode(row._id),
    ...(row.requestId === undefined ? {} : { requestId: row.requestId }),
    view: "full",
  };
}

/**
 * Adaptador explícito de fila persistida a vista de lectura. La vista ya
 * viene decidida por la capa de autorización; acá solo se recorta la forma.
 * La vista minimizada nunca expone `studentId`, `accessNeeds`,
 * `referenceCode` ni `requestId`, aunque la fila los traiga.
 */
export function toAccompanimentProjection<
  AccompanimentId extends string,
  UserId extends string,
  RequestId extends string,
>(
  row: AccompanimentRow<AccompanimentId, UserId, RequestId>,
  view: AccompanimentView,
): AccompanimentProjection<AccompanimentId, UserId, RequestId> {
  if (view === "minimized") {
    return {
      _id: row._id,
      status: row.status,
      objective: row.objective,
      view: "minimized",
    };
  }
  return toFullAccompaniment(row);
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

/**
 * Tope del motivo opcional del cierre. Es el único cambio de estado con
 * motivo: el MER guarda `motivoCierre?` y no tiene dónde guardar uno de pausa
 * o de reactivación.
 */
export const ACCOMPANIMENT_CLOSURE_REASON_MAX_LENGTH = 500;

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
  /** Solo el cierre lo admite. */
  readonly closureReason?: string;
};

/**
 * Datos del cierre que el MER guarda en ACOMPAÑAMIENTOS: `cerradoPorId?`,
 * `cerradoEn?` y `motivoCierre?`, este último solo si se entregó.
 */
export type AccompanimentClosure = {
  readonly closedById: string;
  readonly closedAt: number;
  readonly closureReason?: string;
};

/**
 * Cambio aceptado, listo para guardar en el propio acompañamiento. Pausar y
 * reactivar solo cambian el estado, porque el MER no registra quién ni cuándo
 * lo hizo.
 */
export type AccompanimentStateChange =
  | { readonly to: "active" | "paused" }
  | { readonly to: "closed"; readonly closure: AccompanimentClosure };

export const ACCOMPANIMENT_TRANSITION_REJECTION_CAUSES = [
  "transition_not_allowed",
  "actor_required",
  "occurred_at_invalid",
  "closure_reason_not_allowed",
  "closure_reason_too_long",
] as const;

export type AccompanimentTransitionRejectionCause =
  (typeof ACCOMPANIMENT_TRANSITION_REJECTION_CAUSES)[number];

export type AccompanimentTransitionResult =
  | { readonly status: "applied"; readonly change: AccompanimentStateChange }
  | { readonly status: "rejected"; readonly cause: AccompanimentTransitionRejectionCause };

/**
 * Decide si un cambio de estado procede, sin persistir nada.
 *
 * El motivo del cierre es opcional: en blanco equivale a no entregarlo. Un
 * motivo en una pausa o una reactivación se rechaza en vez de descartarse.
 * Los rechazos se devuelven como valor y ninguno construye `change`.
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

  const closureReason = attempt.closureReason?.trim();
  if (transition.to !== "closed") {
    if (closureReason) return { status: "rejected", cause: "closure_reason_not_allowed" };
    return { status: "applied", change: { to: transition.to } };
  }
  if (
    closureReason !== undefined &&
    closureReason.length > ACCOMPANIMENT_CLOSURE_REASON_MAX_LENGTH
  ) {
    return { status: "rejected", cause: "closure_reason_too_long" };
  }

  return {
    status: "applied",
    change: {
      to: "closed",
      closure: {
        closedById: actorId,
        closedAt: attempt.occurredAt,
        ...(closureReason ? { closureReason } : {}),
      },
    },
  };
}
