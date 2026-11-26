/**
 * Procedencia por canal oficial y derivaciones de la solicitud (TI2-143).
 *
 * Dominio puro: no importa Convex ni frameworks. Fija qué se guarda de una
 * derivación de entrada (otra unidad avisa a CERETI) y de una de salida
 * (CERETI deriva a otra unidad), y el orden que exige la de entrada antes de
 * abrir un acompañamiento: primero el contacto de CERETI con el estudiante y
 * después su aceptación.
 *
 * Los nombres de unidad y las razones son texto libre: no deben incluir
 * diagnósticos ni etiquetas clínicas. La derivación de salida no guarda
 * destinatarios ni antecedentes: la comunicación con la unidad de destino
 * ocurre fuera de la aplicación.
 */

import type { ApiResult } from "../errors/api_error";
import { invalidRequestFields, REQUEST_TEXT_MAX_LENGTH } from "./request";

/** Tope del nombre de una unidad de origen o de destino, en caracteres. */
export const REFERRAL_UNIT_MAX_LENGTH = 200;

/** Tope de la razón de una derivación de salida, igual al de los demás textos. */
export const REFERRAL_REASON_MAX_LENGTH = REQUEST_TEXT_MAX_LENGTH;

/**
 * Rechazo de una fecha de recepción futura. La Web lo muestra junto al campo
 * antes de enviar, con el mismo texto que respondería el Backend.
 */
export const RECEIVED_AT_FUTURE_MESSAGE = "La fecha de recepción no puede ser futura.";

/**
 * Derivación de entrada: la unidad que avisó, cuándo, y el contacto y la
 * aceptación con su fecha. El identificador es genérico para no importar
 * `convex/_generated`.
 */
export type IncomingReferral<UserId extends string = string> = {
  readonly originUnit: string;
  readonly referredAt: number;
  readonly contactedAt?: number;
  readonly contactedBy?: UserId;
  readonly acceptedAt?: number;
};

/** Derivación de salida: a qué unidad, cuándo, quién derivó y la razón legible. */
export type OutgoingReferral<UserId extends string = string> = {
  readonly destinationUnit: string;
  readonly referredAt: number;
  readonly referredBy: UserId;
  readonly reason: string;
};

/** Nombre de unidad recortado y dentro del tope. */
function toUnitName(raw: string, empty: string, tooLong: string): ApiResult<string> {
  const unit = raw.trim();
  if (unit === "") return invalidRequestFields(empty);
  if (unit.length > REFERRAL_UNIT_MAX_LENGTH) return invalidRequestFields(tooLong);
  return { status: "ok", data: unit };
}

/** Unidad de la Universidad que avisó a CERETI de la posible necesidad. */
export function toOriginUnit(raw: string): ApiResult<string> {
  return toUnitName(
    raw,
    "Indica la unidad que derivó al estudiante.",
    `El nombre de la unidad que derivó supera el máximo permitido (${REFERRAL_UNIT_MAX_LENGTH} caracteres).`,
  );
}

/** Unidad a la que CERETI deriva al estudiante. */
export function toDestinationUnit(raw: string): ApiResult<string> {
  return toUnitName(
    raw,
    "Indica la unidad a la que se deriva al estudiante.",
    `El nombre de la unidad de destino supera el máximo permitido (${REFERRAL_UNIT_MAX_LENGTH} caracteres).`,
  );
}

/**
 * Razón de la derivación de salida ya recortada por la política: solo aplica
 * el tope. Se rechaza el exceso, nunca se trunca, porque es lo que lee el
 * estudiante.
 */
export function toReferralReason(reason: string): ApiResult<string> {
  if (reason.length > REFERRAL_REASON_MAX_LENGTH) {
    return invalidRequestFields(
      `La razón de la derivación supera el máximo permitido (${REFERRAL_REASON_MAX_LENGTH} caracteres).`,
    );
  }
  return { status: "ok", data: reason };
}

/**
 * Fecha en que CERETI recibió la solicitud por el canal oficial. Si no llega,
 * es el instante del registro. `number` admite `NaN`, `Infinity` y negativos,
 * y una fecha futura no puede ser una recepción: todo eso se rechaza.
 */
export function toOfficialReceivedAt(raw: number | undefined, now: number): ApiResult<number> {
  if (raw === undefined) return { status: "ok", data: now };
  if (!Number.isFinite(raw) || raw <= 0) {
    return invalidRequestFields("La fecha de recepción no es válida.");
  }
  if (raw > now) return invalidRequestFields(RECEIVED_AT_FUTURE_MESSAGE);
  return { status: "ok", data: raw };
}

/** Por qué no se pudo registrar un paso de la derivación de entrada. */
export const REFERRAL_STEP_REJECTION_CAUSES = [
  "not_a_referral",
  "already_contacted",
  "contact_required",
  "already_accepted",
] as const;

export type ReferralStepRejectionCause = (typeof REFERRAL_STEP_REJECTION_CAUSES)[number];

/** Los rechazos son valores, como en la política de transición. */
export type ReferralStepResult<UserId extends string> =
  | { readonly status: "applied"; readonly referral: IncomingReferral<UserId> }
  | { readonly status: "rejected"; readonly cause: ReferralStepRejectionCause };

/**
 * Registra que CERETI contactó al estudiante por la derivación de entrada.
 * Se registra una sola vez: el contacto ya guardado no se reescribe, porque
 * es el rastro de quién contactó y cuándo.
 */
export function recordReferralContact<UserId extends string>(
  referral: IncomingReferral<UserId> | undefined,
  contact: { readonly contactedBy: UserId; readonly contactedAt: number },
): ReferralStepResult<UserId> {
  if (referral === undefined) return { status: "rejected", cause: "not_a_referral" };
  if (referral.contactedAt !== undefined) return { status: "rejected", cause: "already_contacted" };
  return {
    status: "applied",
    referral: {
      ...referral,
      contactedAt: contact.contactedAt,
      contactedBy: contact.contactedBy,
    },
  };
}

/**
 * Registra que el estudiante aceptó, después del contacto. Sin contacto
 * previo se rechaza: la aceptación solo puede venir de esa conversación.
 */
export function recordReferralAcceptance<UserId extends string>(
  referral: IncomingReferral<UserId> | undefined,
  acceptedAt: number,
): ReferralStepResult<UserId> {
  if (referral === undefined) return { status: "rejected", cause: "not_a_referral" };
  if (referral.contactedAt === undefined) return { status: "rejected", cause: "contact_required" };
  if (referral.acceptedAt !== undefined) return { status: "rejected", cause: "already_accepted" };
  return { status: "applied", referral: { ...referral, acceptedAt } };
}

/**
 * Una derivación de entrada no abre acompañamiento hasta que el estudiante
 * acepta, y la aceptación exige el contacto. Una solicitud que no viene de
 * una derivación no tiene esta condición.
 */
export function referralAllowsAccompaniment(
  referral: Pick<IncomingReferral, "contactedAt" | "acceptedAt"> | undefined,
): boolean {
  if (referral === undefined) return true;
  return referral.contactedAt !== undefined && referral.acceptedAt !== undefined;
}
