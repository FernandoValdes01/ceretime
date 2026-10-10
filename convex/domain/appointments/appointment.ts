/**
 * Atención reservada: contratos públicos compartidos v1 (TI2-87, extendido TI2-93, plazo TI2-94).
 *
 * Dominio puro: no importa Convex, React ni Expo, para que Web y Mobile
 * consuman la misma forma sin levantar el backend. Reserva y atención son
 * una sola entidad (`appointments` es la única representación: no existe un
 * `domain/reservations` paralelo); la inasistencia es un estado de la
 * atención y su justificación se representa por estado, sin sanción
 * automática. El plazo de cinco días hábiles lo calcula TI2-94 en este mismo
 * módulo, sin persistir la explicación (la persistencia y la revisión son
 * TI2-119).
 *
 * Reutiliza los literales de TI2-83 y `ModalityPreference` de la solicitud
 * para no duplicar su representación. TI2-93 agrega la política de
 * transiciones y la conservación de fecha original; la conciliación con la
 * persistencia (`originalStartsAt`, `cancelReason` en `schema.ts`) la aplican
 * TI2-107/TI2-109/TI2-110 sobre esta política. Acá solo hay forma versionada
 * con identificadores genéricos (`string` plano, sin `Id`/`Doc` de Convex).
 */

import type { ModalityPreference } from "../requests/request";
import { isValidCivilDate } from "../availability/availability";

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

/**
 * Plazo de justificación de cinco días hábiles (TI2-94, RF-20/RN-14/CA-07).
 *
 * Política provisional pendiente de validación PV-11 (CERETI + UCT): no afirma
 * aprobación institucional. Días hábiles provisorios: lunes a viernes civiles
 * en la zona horaria dada, excluyendo feriados explícitos. Fin de semana y
 * feriados no cuentan; la fecha civil de la inasistencia es el día 0
 * exclusivo y el conteo empieza al día siguiente, aunque la inasistencia caiga
 * en fin de semana o feriado. El reloj, el calendario y los feriados son datos
 * de entrada: no hay `Date.now`, ni zona implícita del servidor, ni proveedor
 * externo de feriados (fuera de alcance: certificados, sanción automática y
 * cron). Mismos inputs dan el mismo plazo.
 *
 * Límite exclusivo: el plazo vence al inicio del día civil siguiente a la
 * fecha límite en la zona horaria dada (`deadlineAt`). Una entrega en el
 * instante exacto del vencimiento queda fuera; un milisegundo antes queda
 * dentro. La comparación usa instantes epoch en milisegundos, como Convex.
 */

/** Días hábiles posteriores a la inasistencia que abarca el plazo. */
export const JUSTIFICATION_BUSINESS_DAYS = 5 as const;

/** Entrada del cálculo del plazo: inasistencia más calendario explícito. */
export interface CalculateJustificationDeadlineInput {
  /** Instante epoch en milisegundos de la inasistencia ya ocurrida. */
  readonly missedAt: number;
  /** Zona horaria IANA explícita (p. ej. `America/Santiago`). */
  readonly timeZone: string;
  /** Feriados civiles explícitos `YYYY-MM-DD`; fin de semana siempre descansa. */
  readonly holidays?: readonly string[];
}

/** Plazo calculado: fechas civiles más instante exclusivo de vencimiento. */
export interface JustificationDeadline {
  /** Fecha civil `YYYY-MM-DD` de la inasistencia en la zona horaria dada. */
  readonly absenceDate: string;
  /** Quinto día hábil posterior, `YYYY-MM-DD` en la zona horaria dada. */
  readonly deadlineDate: string;
  /** Vencimiento exclusivo: 00:00 local del día siguiente a `deadlineDate`. */
  readonly deadlineAt: number;
  /** Días hábiles contados; siempre `JUSTIFICATION_BUSINESS_DAYS`. */
  readonly businessDays: number;
  readonly timeZone: string;
  /** Feriados normalizados (únicos y ordenados) usados en el cálculo. */
  readonly holidays: readonly string[];
}

/** Entrada de la decisión: cálculo más instante de entrega a evaluar. */
export interface DecideJustificationTimelinessInput extends CalculateJustificationDeadlineInput {
  /** Instante epoch en milisegundos de entrega de la explicación. */
  readonly submittedAt: number;
}

/** Cálculo más decisión para TI2-119, sin persistir la explicación. */
export interface JustificationTimeliness extends JustificationDeadline {
  readonly submittedAt: number;
  /** Fecha civil de la entrega en la zona horaria dada. */
  readonly submittedDate: string;
  /** Verdadero cuando la entrega cae dentro del plazo exclusivo. */
  readonly withinDeadline: boolean;
}

const JUSTIFICATION_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function justificationFormatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = JUSTIFICATION_FORMATTER_CACHE.get(timeZone);
  if (cached !== undefined) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  JUSTIFICATION_FORMATTER_CACHE.set(timeZone, created);
  return created;
}

function justificationParts(epochMs: number, timeZone: string): Record<string, string> {
  return justificationFormatterFor(timeZone)
    .formatToParts(new Date(epochMs))
    .reduce<Record<string, string>>((accumulator, part) => {
      accumulator[part.type] = part.value;
      return accumulator;
    }, {});
}

function justificationOffsetMs(timeZone: string, utcMs: number): number {
  const parts = justificationParts(utcMs, timeZone);
  const asUtc = Date.UTC(
    Number(parts["year"]),
    Number(parts["month"]) - 1,
    Number(parts["day"]),
    Number(parts["hour"]) % 24,
    Number(parts["minute"]),
    Number(parts["second"]),
  );
  return asUtc - utcMs;
}

function justificationMidnightToEpochMs(date: string, timeZone: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const targetLocal = Date.UTC(year, month - 1, day, 0, 0, 0);
  const firstPass = targetLocal - justificationOffsetMs(timeZone, targetLocal);
  return targetLocal - justificationOffsetMs(timeZone, firstPass);
}

function justificationCivilDateOfInstant(epochMs: number, timeZone: string): string {
  const parts = justificationParts(epochMs, timeZone);
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
}

function justificationCivilWeekday(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const days = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  return (((days + 4) % 7) + 7) % 7;
}

function justificationNextCivilDate(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const next = new Date(Date.UTC(year, month - 1, day) + 86_400_000);
  const nextYear = next.getUTCFullYear();
  const nextMonth = String(next.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(next.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

/**
 * Verdadero cuando el instante es representable como fecha (`new Date` válido).
 *
 * `isValidInstant` (TI2-93) solo exige finito positivo; magnitudes absurdas
 * como `1e30` lo pasan pero `Intl` lanzaría `RangeError`. Este resguardo las
 * convierte en el error propio del plazo para no filtrar excepciones crudas.
 */
function assertUsableJustificationInstant(value: number, message: string): void {
  if (!isValidInstant(value) || Number.isNaN(new Date(value).getTime())) {
    throw new Error(message);
  }
}

function assertJustificationTimeZone(timeZone: string): void {
  if (typeof timeZone !== "string" || timeZone.trim() === "") {
    throw new Error("El plazo requiere una zona horaria IANA explícita.");
  }
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
  } catch {
    throw new Error("La zona horaria del plazo es desconocida.");
  }
}

function normalizeJustificationHolidays(
  holidays: readonly string[] | undefined,
): readonly string[] {
  if (holidays === undefined) return [];
  const seen = new Set<string>();
  for (const holiday of holidays) {
    if (typeof holiday !== "string" || !isValidCivilDate(holiday)) {
      throw new Error(`El feriado ${String(holiday)} no es una fecha civil válida YYYY-MM-DD.`);
    }
    seen.add(holiday);
  }
  return [...seen].sort();
}

/**
 * Calcula el plazo de cinco días hábiles posteriores a una inasistencia.
 *
 * Dominio puro y determinista: mismos inputs, mismo plazo. Cuenta desde la
 * fecha civil de `missedAt` (día 0 exclusivo), no desde la reserva ni en días
 * corridos. Valida el instante, la zona horaria y cada feriado explícito.
 */
export function calculateJustificationDeadline(
  input: CalculateJustificationDeadlineInput,
): JustificationDeadline {
  assertUsableJustificationInstant(
    input.missedAt,
    "La inasistencia requiere un instante válido en milisegundos.",
  );
  assertJustificationTimeZone(input.timeZone);
  const holidays = normalizeJustificationHolidays(input.holidays);
  const holidaySet = new Set(holidays);

  const absenceDate = justificationCivilDateOfInstant(input.missedAt, input.timeZone);
  let counted = 0;
  let current = absenceDate;
  let deadlineDate = absenceDate;
  for (let step = 0; step < 370; step += 1) {
    current = justificationNextCivilDate(current);
    const weekday = justificationCivilWeekday(current);
    const isWeekend = weekday === 0 || weekday === 6;
    if (!isWeekend && !holidaySet.has(current)) {
      counted += 1;
      if (counted === JUSTIFICATION_BUSINESS_DAYS) {
        deadlineDate = current;
        break;
      }
    }
  }
  if (counted !== JUSTIFICATION_BUSINESS_DAYS) {
    throw new Error("El plazo no encontró cinco días hábiles en el horizonte de búsqueda.");
  }

  const deadlineAt = justificationMidnightToEpochMs(
    justificationNextCivilDate(deadlineDate),
    input.timeZone,
  );

  return {
    absenceDate,
    deadlineDate,
    deadlineAt,
    businessDays: JUSTIFICATION_BUSINESS_DAYS,
    timeZone: input.timeZone,
    holidays,
  };
}

/**
 * Devuelve cálculo y decisión de puntualidad para TI2-119.
 *
 * `withinDeadline` es verdadero cuando `submittedAt` cae dentro del plazo
 * exclusivo (`submittedAt < deadlineAt`) y no es anterior a la inasistencia.
 * No persiste nada: TI2-119 decide entrega, revisión y persistencia.
 */
export function decideJustificationTimeliness(
  input: DecideJustificationTimelinessInput,
): JustificationTimeliness {
  assertUsableJustificationInstant(
    input.submittedAt,
    "La entrega requiere un instante válido en milisegundos.",
  );
  const deadline = calculateJustificationDeadline(input);
  const submittedDate = justificationCivilDateOfInstant(input.submittedAt, input.timeZone);
  const withinDeadline =
    input.submittedAt >= input.missedAt && input.submittedAt < deadline.deadlineAt;
  return { ...deadline, submittedAt: input.submittedAt, submittedDate, withinDeadline };
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
