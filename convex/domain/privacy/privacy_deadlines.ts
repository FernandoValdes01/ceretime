/**
 * Plazos del procedimiento de prueba de privacidad (TI2-136).
 *
 * Dominio puro y determinista: el reloj, la zona horaria y los feriados son
 * datos de entrada; no hay `Date.now`, ni zona implícita del servidor, ni
 * proveedor externo de feriados. Mismos inputs dan el mismo plazo.
 *
 * Convención de cómputo del procedimiento de prueba, pendiente de validación
 * institucional: la fecha civil de recepción es el día 0 y el conteo empieza
 * al día siguiente. `responseAt` es el vencimiento exclusivo, es decir, el
 * inicio del día civil posterior al último día cubierto; una respuesta en ese
 * instante queda fuera y cualquier instante anterior queda dentro. Para los días
 * hábiles se excluyen sábados, domingos y los feriados explícitos.
 */

import {
  addBusinessDays,
  addCivilDays,
  assertTimeZone,
  assertUsableInstant,
  civilDateOfInstant,
  midnightToEpochMs,
  normalizeHolidays,
} from "../calendar/civil_days";
import {
  isPrivacyRequestKind,
  type PrivacyRequestKind,
  PRIVACY_REQUEST_KIND_VALUES,
} from "./privacy_request";

/** Días corridos para responder una solicitud distinta de bloqueo. */
export const PRIVACY_RESPONSE_CALENDAR_DAYS = 30 as const;

/** Días corridos máximos de la única prórroga. */
export const PRIVACY_RESPONSE_EXTENSION_CALENDAR_DAYS = 30 as const;

/** Días hábiles para responder una solicitud de bloqueo temporal. */
export const PRIVACY_TEMPORARY_BLOCK_BUSINESS_DAYS = 2 as const;

/** Días hábiles para reclamar ante la Agencia desde la notificación. */
export const PRIVACY_AGENCY_CLAIM_BUSINESS_DAYS = 30 as const;

/** Identificador de la regla aplicada, para que la UI no deduzca plazos. */
export const PRIVACY_RESPONSE_RULE_VALUES = ["calendar_30", "business_2"] as const;

export type PrivacyResponseRule = (typeof PRIVACY_RESPONSE_RULE_VALUES)[number];

/** Entrada común de los plazos: instante, zona IANA y feriados explícitos. */
export interface PrivacyDeadlineInput {
  readonly receivedAt: number;
  readonly timeZone: string;
  readonly holidays?: readonly string[];
}

/** Entrada del plazo de respuesta: el derecho decide entre 30 corridos y 2 hábiles. */
export interface PrivacyResponseDeadlineInput extends PrivacyDeadlineInput {
  readonly kind: PrivacyRequestKind;
}

/** Plazo de respuesta calculado, con su fecha civil y vencimiento exclusivo. */
export interface PrivacyResponseDeadline {
  readonly kind: PrivacyRequestKind;
  readonly rule: PrivacyResponseRule;
  /** Fecha civil `YYYY-MM-DD` de la recepción en la zona horaria dada. */
  readonly receivedDate: string;
  /** Último día civil cubierto por el plazo, `YYYY-MM-DD` en la zona horaria dada. */
  readonly responseDate: string;
  /** Vencimiento exclusivo: 00:00 local del día siguiente a `responseDate`. */
  readonly responseAt: number;
  /** Días contados por la regla: 30 corridos o 2 hábiles. */
  readonly responseDays: number;
  /** Verdadero solo para la regla de 30 días corridos. */
  readonly extensionAllowed: boolean;
  /** Días corridos máximos de la prórroga; 0 cuando no se permite. */
  readonly extensionCalendarDays: number;
  readonly timeZone: string;
  /** Feriados normalizados (únicos y ordenados) usados en el cálculo. */
  readonly holidays: readonly string[];
}

/** Prórroga única de hasta 30 días corridos. */
export interface PrivacyResponseExtension {
  readonly days: number;
  /** Último día civil cubierto después de la prórroga. */
  readonly extendedUntilDate: string;
  /** Vencimiento exclusivo posterior a la prórroga. */
  readonly extendedUntilAt: number;
}

/** Plazo con su prórroga ya aplicada. */
export interface ExtendedPrivacyResponseDeadline extends PrivacyResponseDeadline {
  readonly extension: PrivacyResponseExtension;
}

/** Causas por las que una prórroga no procede. */
export const PRIVACY_EXTENSION_REJECTION_CAUSES = [
  "extension_not_allowed",
  "extension_already_applied",
  "extension_days_invalid",
] as const;

export type PrivacyExtensionRejectionCause = (typeof PRIVACY_EXTENSION_REJECTION_CAUSES)[number];

export type PrivacyExtensionResult =
  | { readonly status: "applied"; readonly deadline: ExtendedPrivacyResponseDeadline }
  | { readonly status: "rejected"; readonly cause: PrivacyExtensionRejectionCause };

/** Entrada del plazo de reclamo ante la Agencia. */
export interface PrivacyAgencyClaimDeadlineInput {
  readonly notifiedAt: number;
  readonly timeZone: string;
  readonly holidays?: readonly string[];
}

/** Plazo para reclamar ante la Agencia desde la notificación de la respuesta. */
export interface PrivacyAgencyClaimDeadline {
  readonly notifiedDate: string;
  /** Último día hábil cubierto, `YYYY-MM-DD` en la zona horaria dada. */
  readonly claimDate: string;
  /** Vencimiento exclusivo: 00:00 local del día siguiente a `claimDate`. */
  readonly claimAt: number;
  readonly businessDays: number;
  readonly timeZone: string;
  readonly holidays: readonly string[];
}

function assertKind(kind: PrivacyRequestKind): void {
  if (!isPrivacyRequestKind(kind)) {
    throw new Error(
      `El derecho ${String(kind)} no es válido; se esperaba uno de ${PRIVACY_REQUEST_KIND_VALUES.join(", ")}.`,
    );
  }
}

function validateDeadlineInput(input: {
  readonly instant: number;
  readonly timeZone: string;
  readonly holidays?: readonly string[];
}): readonly string[] {
  assertUsableInstant(input.instant, "El plazo requiere un instante válido en milisegundos.");
  assertTimeZone(input.timeZone);
  return normalizeHolidays(input.holidays);
}

/**
 * Calcula el plazo de respuesta de una solicitud.
 *
 * Una solicitud de bloqueo responde en 2 días hábiles y no admite prórroga;
 * las demás responden en 30 días corridos y admiten una sola prórroga de
 * hasta 30. La recepción es el día 0 y el vencimiento es exclusivo.
 */
export function calculatePrivacyResponseDeadline(
  input: PrivacyResponseDeadlineInput,
): PrivacyResponseDeadline {
  assertKind(input.kind);
  const holidays = validateDeadlineInput({
    instant: input.receivedAt,
    timeZone: input.timeZone,
    ...(input.holidays === undefined ? {} : { holidays: input.holidays }),
  });
  const holidaySet = new Set(holidays);
  const receivedDate = civilDateOfInstant(input.receivedAt, input.timeZone);

  const isBlocking = input.kind === "blocking";
  const responseDate = isBlocking
    ? addBusinessDays(receivedDate, PRIVACY_TEMPORARY_BLOCK_BUSINESS_DAYS, holidaySet)
    : addCivilDays(receivedDate, PRIVACY_RESPONSE_CALENDAR_DAYS);
  const responseAt = midnightToEpochMs(addCivilDays(responseDate, 1), input.timeZone);

  return {
    kind: input.kind,
    rule: isBlocking ? "business_2" : "calendar_30",
    receivedDate,
    responseDate,
    responseAt,
    responseDays: isBlocking
      ? PRIVACY_TEMPORARY_BLOCK_BUSINESS_DAYS
      : PRIVACY_RESPONSE_CALENDAR_DAYS,
    extensionAllowed: !isBlocking,
    extensionCalendarDays: isBlocking ? 0 : PRIVACY_RESPONSE_EXTENSION_CALENDAR_DAYS,
    timeZone: input.timeZone,
    holidays,
  };
}

/** Atajo del plazo de 2 días hábiles para una solicitud de bloqueo. */
export function calculatePrivacyBlockingResponseDeadline(
  input: PrivacyDeadlineInput,
): PrivacyResponseDeadline {
  return calculatePrivacyResponseDeadline({ ...input, kind: "blocking" });
}

/**
 * Aplica la prórroga única de hasta 30 días corridos.
 *
 * No muta el plazo recibido. Una solicitud de bloqueo, una prórroga ya
 * aplicada y un número de días fuera de 1..30 se rechazan como valor.
 */
export function applyPrivacyResponseExtension(
  deadline: PrivacyResponseDeadline | ExtendedPrivacyResponseDeadline,
  days: number,
): PrivacyExtensionResult {
  if (!deadline.extensionAllowed) {
    return { status: "rejected", cause: "extension_not_allowed" };
  }
  if ("extension" in deadline) {
    return { status: "rejected", cause: "extension_already_applied" };
  }
  if (!Number.isInteger(days) || days < 1 || days > PRIVACY_RESPONSE_EXTENSION_CALENDAR_DAYS) {
    return { status: "rejected", cause: "extension_days_invalid" };
  }

  const extendedUntilDate = addCivilDays(deadline.responseDate, days);
  const extendedUntilAt = midnightToEpochMs(addCivilDays(extendedUntilDate, 1), deadline.timeZone);
  return {
    status: "applied",
    deadline: {
      ...deadline,
      extension: { days, extendedUntilDate, extendedUntilAt },
    },
  };
}

/**
 * Calcula el plazo de 30 días hábiles para reclamar ante la Agencia.
 *
 * El plazo se cuenta desde la notificación de la respuesta, porque el reclamo
 * existe cuando el titular ya conoce la decisión. La notificación es el día 0
 * y el vencimiento es exclusivo.
 */
export function calculatePrivacyAgencyClaimDeadline(
  input: PrivacyAgencyClaimDeadlineInput,
): PrivacyAgencyClaimDeadline {
  const holidays = validateDeadlineInput({
    instant: input.notifiedAt,
    timeZone: input.timeZone,
    ...(input.holidays === undefined ? {} : { holidays: input.holidays }),
  });
  const notifiedDate = civilDateOfInstant(input.notifiedAt, input.timeZone);
  const claimDate = addBusinessDays(
    notifiedDate,
    PRIVACY_AGENCY_CLAIM_BUSINESS_DAYS,
    new Set(holidays),
  );
  return {
    notifiedDate,
    claimDate,
    claimAt: midnightToEpochMs(addCivilDays(claimDate, 1), input.timeZone),
    businessDays: PRIVACY_AGENCY_CLAIM_BUSINESS_DAYS,
    timeZone: input.timeZone,
    holidays,
  };
}

/** Verdadero cuando el instante cae antes del vencimiento exclusivo. */
export function isWithinPrivacyDeadline(deadlineAt: number, instant: number): boolean {
  return instant < deadlineAt;
}
