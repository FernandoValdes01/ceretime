/**
 * Atención reservada: contratos públicos compartidos v1 (TI2-87, extendido TI2-93).
 *
 * Dominio puro: no importa Convex, React ni Expo, para que Web y Mobile
 * consuman la misma forma sin levantar el backend. Reserva y atención son
 * una sola entidad (`appointments` es la única representación: no existe un
 * `domain/reservations` paralelo); la inasistencia es un estado de la
 * atención y su justificación se representa por estado, sin sanción
 * automática. El plazo de cinco días hábiles lo calcula TI2-94.
 *
 * Reutiliza los literales de TI2-83 y `ModalityPreference` de la solicitud
 * para no duplicar su representación. TI2-93 agrega la política de
 * transiciones y la conservación de fecha original; la conciliación con la
 * persistencia (`originalStartsAt`, `cancelReason` en `schema.ts`) la aplican
 * TI2-107/TI2-109/TI2-110 sobre esta política. Acá solo hay forma versionada
 * con identificadores genéricos (`string` plano, sin `Id`/`Doc` de Convex).
 */

import type { ModalityPreference } from "../requests/request";

/** Versión del contrato público de la atención reservada. */
export const APPOINTMENT_CONTRACT_VERSION = "v1" as const;

export type AppointmentContractVersion = typeof APPOINTMENT_CONTRACT_VERSION;

/**
 * Estados del ciclo de reserva de una atención, en orden de flujo.
 *
 * Los seis primeros son de TI2-83 y se conservan en orden para no romper
 * contratos existentes. `no_show` es la inasistencia pendiente de
 * justificación por compatibilidad; TI2-93 agrega su resolución explícita
 * (`no_show_justified`, `no_show_unjustified`) sin sanción automática.
 */
export const APPOINTMENT_STATUS_VALUES = [
  "scheduled",
  "completed",
  "cancelled_by_student",
  "cancelled_by_cereti",
  "rescheduled",
  "no_show",
  "no_show_justified",
  "no_show_unjustified",
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUS_VALUES)[number];

/** Estado inicial de una reserva recién creada. */
export const INITIAL_APPOINTMENT_STATUS: AppointmentStatus = "scheduled";

/** Inasistencia pendiente de justificación (valor histórico `no_show`). */
export const NO_SHOW_PENDING_STATE: AppointmentStatus = "no_show";

/** Atención reservada vinculada a un acompañamiento, con identificadores genéricos. */
export interface Appointment {
  readonly id: string;
  readonly accompanimentId: string;
  readonly professionalId: string;
  readonly modality: ModalityPreference;
  /** Referencia opaca al espacio; ausente en modalidad en línea. */
  readonly spaceId?: string;
  /** Referencia opaca al cupo de disponibilidad que la originó. */
  readonly slotId?: string;
  /** Inicio de la atención como milisegundos epoch. */
  readonly startAt: number;
  /** Fin de la atención como milisegundos epoch. */
  readonly endAt: number;
  /**
   * Fecha original del primer agendamiento, como milisegundos epoch.
   *
   * Ausente hasta el primer reagendamiento; desde entonces se conserva y no
   * se sobrescribe. La persistencia la refleja en `originalStartsAt`
   * (TI2-107); acá viaja con el mismo significado para Web y Mobile.
   */
  readonly originalStartAt?: number;
  /**
   * Motivo de cancelación: obligatorio para CERETI, opcional para el
   * estudiante. La persistencia lo refleja en `cancelReason` (TI2-107).
   */
  readonly cancelReason?: string;
  readonly status: AppointmentStatus;
  readonly version: AppointmentContractVersion;
}

/**
 * Transición declarada de la atención.
 *
 * `requiresReason` exige motivo no vacío (cancelación CERETI);
 * `requiresReschedule` exige fecha efectiva nueva (`newStartAt`/`newEndAt`).
 * Cualquier par ausente es inválido, incluidos saltos, retrocesos y salidas
 * desde estados terminales.
 */
export type AppointmentStateTransition = {
  readonly from: AppointmentStatus;
  readonly to: AppointmentStatus;
  readonly requiresReason: boolean;
  readonly requiresReschedule: boolean;
};

/**
 * Tabla única de transiciones válidas (TI2-93).
 *
 * Desde `scheduled` o `rescheduled` la atención puede realizarse,
 * cancelarse, reagendarse o registrar inasistencia pendiente. Un segundo
 * reagendamiento conserva la primera fecha original. Desde `no_show` solo se
 * resuelve la justificación; el plazo lo calcula TI2-94 y no hay sanción
 * automática. Los demás estados son terminales.
 */
export const APPOINTMENT_TRANSITIONS = [
  { from: "scheduled", to: "completed", requiresReason: false, requiresReschedule: false },
  {
    from: "scheduled",
    to: "cancelled_by_student",
    requiresReason: false,
    requiresReschedule: false,
  },
  { from: "scheduled", to: "cancelled_by_cereti", requiresReason: true, requiresReschedule: false },
  { from: "scheduled", to: "rescheduled", requiresReason: false, requiresReschedule: true },
  { from: "scheduled", to: "no_show", requiresReason: false, requiresReschedule: false },
  { from: "rescheduled", to: "completed", requiresReason: false, requiresReschedule: false },
  {
    from: "rescheduled",
    to: "cancelled_by_student",
    requiresReason: false,
    requiresReschedule: false,
  },
  {
    from: "rescheduled",
    to: "cancelled_by_cereti",
    requiresReason: true,
    requiresReschedule: false,
  },
  { from: "rescheduled", to: "rescheduled", requiresReason: false, requiresReschedule: true },
  { from: "rescheduled", to: "no_show", requiresReason: false, requiresReschedule: false },
  { from: "no_show", to: "no_show_justified", requiresReason: false, requiresReschedule: false },
  { from: "no_show", to: "no_show_unjustified", requiresReason: false, requiresReschedule: false },
] as const satisfies readonly AppointmentStateTransition[];

/**
 * Intento de cambio de estado de la atención.
 *
 * `from` y `to` admiten cualquier estado declarado: la política es el único
 * punto que rechaza saltos, así ninguna capa superior necesita filtrarlos
 * antes. `currentStartAt` es la fecha efectiva vigente y
 * `currentOriginalStartAt` la fecha original ya conservada, si existe.
 * `newStartAt`/`newEndAt` solo se usan al reagendar.
 */
export type AppointmentTransitionAttempt = {
  readonly from: AppointmentStatus;
  readonly to: AppointmentStatus;
  readonly actorId: string;
  readonly occurredAt: number;
  readonly reason?: string;
  readonly currentStartAt: number;
  readonly currentOriginalStartAt?: number;
  readonly newStartAt?: number;
  readonly newEndAt?: number;
};

/**
 * Entrada del historial de la atención: se agrega, no se edita ni se borra.
 *
 * `actorId` sale de la sesión autenticada en la capa de aplicación, nunca de
 * un parámetro del cliente. `reason` es texto operativo; quien lo escribe no
 * debe incluir diagnósticos ni respaldos sensibles, pero el tipo no puede
 * impedirlo. `occurredAt` es epoch en milisegundos, como maneja Convex.
 */
export type AppointmentStateChange = {
  readonly from: AppointmentStatus;
  readonly to: AppointmentStatus;
  readonly actorId: string;
  readonly occurredAt: number;
  readonly reason?: string;
};

/** Causas de rechazo de la transición, devueltas como valor, no como excepción. */
export const APPOINTMENT_REJECTION_CAUSES = [
  "transition_not_allowed",
  "actor_required",
  "occurred_at_invalid",
  "current_start_invalid",
  "reason_required",
  "occurred_before_start",
  "reschedule_required",
  "reschedule_invalid",
] as const;

export type AppointmentRejectionCause = (typeof APPOINTMENT_REJECTION_CAUSES)[number];

export type AppointmentTransitionResult =
  | {
      readonly status: "applied";
      readonly change: AppointmentStateChange;
      /**
       * Fecha efectiva resultante: la nueva al reagendar, la vigente en otro
       * caso. Nunca es la original; esa viaja en `originalStartAt`.
       */
      readonly effectiveStartAt: number;
      /** Fin efectivo resultante; presente solo al reagendar. */
      readonly effectiveEndAt?: number;
      /**
       * Fecha original conservada: la primera al reagendar y la vigente en
       * otro caso. Ausente hasta el primer reagendamiento y nunca se
       * sobrescribe después.
       */
      readonly originalStartAt?: number;
      /** Motivo de cancelación normalizado: solo en cancelaciones con motivo. */
      readonly cancelReason?: string;
    }
  | {
      readonly status: "rejected";
      readonly cause: AppointmentRejectionCause;
    };

/** Búsqueda exacta en la tabla: un par ausente es una transición inválida. */
export function findAppointmentTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
): AppointmentStateTransition | undefined {
  return APPOINTMENT_TRANSITIONS.find(
    (transition) => transition.from === from && transition.to === to,
  );
}

/** Verdadero cuando el instante es un epoch válido en milisegundos. */
function isValidInstant(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Destinos que registran algo ya ocurrido: realización e inasistencia en sus
 * tres estados. Solo proceden cuando el instante del registro no es anterior
 * al inicio vigente; así no se puede dar por realizada ni registrar
 * inasistencia antes de la atención, y el plazo de justificación de TI2-94
 * siempre cuenta desde una inasistencia ya ocurrida. Cancelar y reagendar sí
 * pueden ocurrir antes del inicio y no pasan por esta regla.
 */
const PAST_EVENT_TARGETS: ReadonlySet<AppointmentStatus> = new Set([
  "completed",
  "no_show",
  "no_show_justified",
  "no_show_unjustified",
]);

/**
 * Aplica la política de transición de la atención (TI2-93).
 *
 * Dominio puro: no persiste ni muta nada, devuelve un resultado y la capa de
 * aplicación decide qué guardar (TI2-107/TI2-109/TI2-110). Todo rechazo
 * retorna antes de construir `change`: un intento inválido no deja entrada
 * en el historial. Las causas se evalúan de la más general a la más
 * específica.
 *
 * Reglas temporales, todas puras como el fin posterior al inicio: la fecha
 * vigente siempre debe ser válida; realización e inasistencia exigen
 * `occurredAt` no anterior al inicio; reagendar exige inicio nuevo distinto
 * y no anterior al instante del registro (no se mueve al pasado).
 *
 * Al reagendar, `originalStartAt` conserva la primera fecha y no se
 * sobrescribe en reagendamientos encadenados; la fecha efectiva viaja
 * aparte y el retorno solo trae lo que un reagendamiento puede producir
 * (sin `cancelReason`: ninguna transición con reagendamiento es
 * cancelación). El motivo es obligatorio solo para la cancelación CERETI y
 * opcional para la del estudiante.
 */
export function transitionAppointment(
  attempt: AppointmentTransitionAttempt,
): AppointmentTransitionResult {
  const transition = findAppointmentTransition(attempt.from, attempt.to);
  if (transition === undefined) return { status: "rejected", cause: "transition_not_allowed" };

  const actorId = attempt.actorId.trim();
  if (actorId === "") return { status: "rejected", cause: "actor_required" };

  if (!isValidInstant(attempt.occurredAt)) {
    return { status: "rejected", cause: "occurred_at_invalid" };
  }

  if (!isValidInstant(attempt.currentStartAt)) {
    return { status: "rejected", cause: "current_start_invalid" };
  }

  const reason = attempt.reason?.trim();
  if (transition.requiresReason && !reason) {
    return { status: "rejected", cause: "reason_required" };
  }

  if (PAST_EVENT_TARGETS.has(transition.to) && attempt.occurredAt < attempt.currentStartAt) {
    return { status: "rejected", cause: "occurred_before_start" };
  }

  const change: AppointmentStateChange = {
    from: transition.from,
    to: transition.to,
    actorId,
    occurredAt: attempt.occurredAt,
    ...(reason ? { reason } : {}),
  };

  if (!transition.requiresReschedule) {
    const isCancel =
      transition.to === "cancelled_by_student" || transition.to === "cancelled_by_cereti";
    const preserved =
      attempt.currentOriginalStartAt !== undefined && isValidInstant(attempt.currentOriginalStartAt)
        ? { originalStartAt: attempt.currentOriginalStartAt }
        : {};
    return {
      status: "applied",
      change,
      effectiveStartAt: attempt.currentStartAt,
      ...preserved,
      ...(isCancel && reason ? { cancelReason: reason } : {}),
    };
  }

  if (attempt.newStartAt === undefined || attempt.newEndAt === undefined) {
    return { status: "rejected", cause: "reschedule_required" };
  }
  if (
    !isValidInstant(attempt.newStartAt) ||
    !isValidInstant(attempt.newEndAt) ||
    attempt.newEndAt <= attempt.newStartAt ||
    attempt.newStartAt === attempt.currentStartAt ||
    attempt.newStartAt < attempt.occurredAt
  ) {
    return { status: "rejected", cause: "reschedule_invalid" };
  }

  const originalStartAt =
    attempt.currentOriginalStartAt !== undefined && isValidInstant(attempt.currentOriginalStartAt)
      ? attempt.currentOriginalStartAt
      : attempt.currentStartAt;

  return {
    status: "applied",
    change,
    effectiveStartAt: attempt.newStartAt,
    effectiveEndAt: attempt.newEndAt,
    originalStartAt,
  };
}

/** Entrada mínima para listar atenciones: filtros opcionales y paginación. */
export interface ListAppointmentsInput {
  readonly accompanimentId?: string;
  readonly professionalId?: string;
  readonly limit: number;
  readonly cursor?: string;
  readonly version: AppointmentContractVersion;
}

/** Página de atenciones con paginación keyset sobre el identificador. */
export interface AppointmentPage {
  readonly items: readonly Appointment[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  readonly version: AppointmentContractVersion;
}
