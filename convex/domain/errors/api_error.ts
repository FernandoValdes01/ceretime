/**
 * Forma base de errores públicos y estados de respuesta (TI2-8, TI2-88).
 *
 * Formaliza el patrón que ya usa `presentation/session.ts` (un resultado
 * discriminado por `status`), para que Web y Mobile no dupliquen cada uno
 * su propia forma de leer errores de `ConvexError`.
 *
 * Dominio puro: no importa Convex, React ni Expo. Los códigos son estables
 * y los clientes distinguen por `code`, nunca interpretando el texto de
 * `message` como código.
 */

/** Datos mínimos de un error público: sin stack traces ni detalles internos. */
export interface PublicApiError {
  code: string;
  message: string;
}

/**
 * Resultado de una operación que puede fallar. `T` es la forma de éxito.
 * Mismo patrón discriminado por `status` que ya usa `SessionResult`.
 */
export type ApiResult<T> = { status: "ok"; data: T } | { status: "error"; error: PublicApiError };

/**
 * Códigos estables del contrato público (TI2-88).
 *
 * Se conservan los de Sprint 1 (`access_needs_empty`, `access_needs_too_long`)
 * y se fijan los tres nuevos: `unauthorized` para acceso denegado,
 * `conflict` para conflicto con el estado actual y `no_availability` para
 * ausencia de cupo. Conflicto y ausencia de cupo son códigos distintos y
 * ninguno revela si el recurso existe.
 */
export const API_ERROR_CODE_VALUES = [
  "access_needs_empty",
  "access_needs_too_long",
  "unauthorized",
  "conflict",
  "no_availability",
] as const;

/** Código estable de un error público del contrato común. */
export type ApiErrorCode = (typeof API_ERROR_CODE_VALUES)[number];

/** Acceso denegado: responde igual ante identificador ajeno o inexistente. */
export const UNAUTHORIZED_ERROR_CODE = "unauthorized" as const;

/** Conflicto con el estado actual, sin filtrar la existencia del recurso. */
export const CONFLICT_ERROR_CODE = "conflict" as const;

/**
 * Ausencia de cupo: se coordina por el canal oficial con la referencia mínima
 * ya entregada en la entrada, sin crear una reserva incompatible.
 */
export const NO_AVAILABILITY_ERROR_CODE = "no_availability" as const;

/** Mensaje comprensible para acceso denegado, idéntico al de Sprint 1. */
export const UNAUTHORIZED_ERROR_MESSAGE = "No autorizado";

/** Mensaje comprensible para conflicto, sin detalles sensibles. */
export const CONFLICT_ERROR_MESSAGE = "La solicitud entra en conflicto con el estado actual.";

/**
 * Mensaje comprensible para ausencia de cupo: coordinación por el canal
 * oficial con la referencia mínima, sin reserva incompatible ni datos
 * de terceros, necesidades o notas.
 */
export const NO_AVAILABILITY_ERROR_MESSAGE =
  "Sin cupo disponible. Coordina por el canal oficial con la referencia indicada.";

/** Texto comprensible por cada código estable, sin detalles internos. */
export const API_ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  access_needs_empty: "Se requiere describir la necesidad de acceso.",
  access_needs_too_long: "El texto de necesidades de acceso supera el máximo permitido.",
  unauthorized: UNAUTHORIZED_ERROR_MESSAGE,
  conflict: CONFLICT_ERROR_MESSAGE,
  no_availability: NO_AVAILABILITY_ERROR_MESSAGE,
};

/** Verdadero cuando el código pertenece al contrato público estable. */
export function isApiErrorCode(code: string): code is ApiErrorCode {
  return (API_ERROR_CODE_VALUES as readonly string[]).includes(code);
}

/** Error público de acceso denegado, sin motivo ni existencia del recurso. */
export function unauthorizedError(): PublicApiError {
  return { code: UNAUTHORIZED_ERROR_CODE, message: UNAUTHORIZED_ERROR_MESSAGE };
}

/** Error público de conflicto, sin filtrar la existencia de recursos. */
export function conflictError(): PublicApiError {
  return { code: CONFLICT_ERROR_CODE, message: CONFLICT_ERROR_MESSAGE };
}

/**
 * Error público de ausencia de cupo: coordinación por el canal oficial con
 * la referencia mínima, sin reserva incompatible ni datos sensibles.
 */
export function noAvailabilityError(): PublicApiError {
  return { code: NO_AVAILABILITY_ERROR_CODE, message: NO_AVAILABILITY_ERROR_MESSAGE };
}

/** Resultado de éxito con las claves exactas `{status, data}`. */
export function okResult<T>(data: T): ApiResult<T> {
  return { status: "ok", data };
}

/**
 * Resultado de error con las claves exactas `{status, error}` y
 * `{code, message}`.
 *
 * Solo conserva código y mensaje: ignora cualquier campo extra como
 * pilas, identificadores de terceros, necesidades o notas.
 */
export function errResult<T>(error: PublicApiError): ApiResult<T> {
  return { status: "error", error: { code: error.code, message: error.message } };
}

/** Verdadero cuando el resultado es éxito (`{status: "ok", data}`). */
export function isOkResult<T>(result: ApiResult<T>): result is { status: "ok"; data: T } {
  return result.status === "ok";
}

/** Verdadero cuando el resultado es error (`{status: "error", error}`). */
export function isErrorResult<T>(
  result: ApiResult<T>,
): result is { status: "error"; error: PublicApiError } {
  return result.status === "error";
}
