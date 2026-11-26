import {
  CONFLICT_ERROR_CODE,
  REQUEST_FIELDS_INVALID_ERROR_CODE,
  UNAUTHORIZED_ERROR_CODE,
  type ApiErrorCode,
} from "../../../../../convex/domain/index.ts";
import { publicErrorOf } from "../../infrastructure/convex/public-error.ts";

/**
 * Desenlace de una acción fallida sobre una solicitud del Profesional (TI2-157).
 *
 * La pantalla nunca muestra `error.message` del SDK, que trae el nombre de la
 * función y el identificador de la petición. Distingue por `error.data.code`
 * (contrato común de TI2-88, ver «Errores» en
 * `docs/contratos-sprint-3/solicitudes.md`):
 *
 * - `unauthorized`: acceso denegado genérico, sin motivo ni existencia.
 * - `request_fields_invalid` y `access_needs_*`: el mensaje público dice qué
 *   dato corregir.
 * - `conflict`: el estado cambió; el mensaje público dice por qué y la Web
 *   agrega cómo seguir, según la acción.
 * - Cualquier otro fallo, incluida una red caída: mensaje de respaldo; el
 *   del registro por canal oficial pide revisar la bandeja antes de reintentar.
 */
export type RequestActionFailure =
  | { readonly status: "denied" }
  | { readonly status: "rejected"; readonly message: string };

/** Acciones del Profesional sobre una solicitud, para elegir cómo seguir. */
export type RequestAction =
  | "take"
  | "requestInformation"
  | "accept"
  | "close"
  | "registerOfficial"
  | "recordReferralContact"
  | "recordReferralAcceptance"
  | "refer";

const DETAIL_NEXT_STEP = "El detalle ya muestra el estado vigente; continúa desde ahí.";

/** Mensaje de respaldo: no expone el error y propone el siguiente paso. */
export const REQUEST_ACTION_FALLBACK_MESSAGE =
  "No pudimos completar la acción. Inténtalo de nuevo; si el problema sigue, avisa a CERETI por el canal oficial.";

/**
 * Respaldo del registro por canal oficial. Desde TI2-165 no lleva clave de
 * idempotencia: si se perdió la respuesta, la solicitud pudo quedar guardada
 * y reintentar dejaría otra. Por eso pide revisar la bandeja antes.
 */
export const REGISTER_OFFICIAL_FALLBACK_MESSAGE =
  "No sabemos si la solicitud quedó registrada. Revisa la bandeja de triage antes de registrarla de nuevo; si no aparece, inténtalo otra vez.";

function fallbackMessageFor(action: RequestAction): string {
  return action === "registerOfficial"
    ? REGISTER_OFFICIAL_FALLBACK_MESSAGE
    : REQUEST_ACTION_FALLBACK_MESSAGE;
}

const CONFLICT_NEXT_STEP: Record<RequestAction, string> = {
  take: "Revisa «Mis tomadas» o elige otra solicitud de la bandeja.",
  requestInformation: DETAIL_NEXT_STEP,
  accept: DETAIL_NEXT_STEP,
  close: DETAIL_NEXT_STEP,
  registerOfficial: "Revisa la bandeja de triage antes de registrarla de nuevo.",
  recordReferralContact: DETAIL_NEXT_STEP,
  recordReferralAcceptance: DETAIL_NEXT_STEP,
  refer: DETAIL_NEXT_STEP,
};

/** Termina el mensaje público en punto para unirle el siguiente paso. */
function asSentence(message: string): string {
  const trimmed = message.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Traduce el error de una acción al desenlace que muestra la pantalla. */
export function requestActionFailureOf(
  error: unknown,
  action: RequestAction,
): RequestActionFailure {
  const publicError = publicErrorOf(error);
  if (publicError === null) {
    return { status: "rejected", message: fallbackMessageFor(action) };
  }
  switch (publicError.code) {
    case UNAUTHORIZED_ERROR_CODE:
      return { status: "denied" };
    // Los códigos de Sprint 1 del contenido no tienen constante propia.
    case REQUEST_FIELDS_INVALID_ERROR_CODE:
    case "access_needs_empty" satisfies ApiErrorCode:
    case "access_needs_too_long" satisfies ApiErrorCode:
      return { status: "rejected", message: asSentence(publicError.message) };
    case CONFLICT_ERROR_CODE:
      return {
        status: "rejected",
        message: `${asSentence(publicError.message)} ${CONFLICT_NEXT_STEP[action]}`,
      };
    default:
      return { status: "rejected", message: fallbackMessageFor(action) };
  }
}

/** Verdadero si la lectura falló por la denegación genérica del Backend. */
export function isRequestAccessDenied(error: unknown): boolean {
  return publicErrorOf(error)?.code === UNAUTHORIZED_ERROR_CODE;
}
