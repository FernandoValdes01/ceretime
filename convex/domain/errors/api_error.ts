/**
 * Forma base de errores públicos y estados de respuesta (TI2-8, TI2-87).
 *
 * Formaliza el patrón que ya usa `presentation/session.ts` (un resultado
 * discriminado por `status`), para que Web y Mobile no dupliquen cada uno
 * su propia forma de leer errores de `ConvexError`. TI2-87 versiona el
 * catálogo sin duplicar la API Convex: la superficie sigue siendo
 * `api.presentation.*`; este módulo solo fija códigos estables y mensajes en
 * español, sin stack traces ni datos internos.
 */

/** Versión del contrato de errores que acompaña a cada proyección. */
export const API_CONTRACT_VERSION = "v1" as const;

export type ApiContractVersion = typeof API_CONTRACT_VERSION;

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

/** Códigos de Sprint 1, conservados sin cambios para compatibilidad. */
export const SPRINT_1_ERROR_CODES = ["access_needs_empty", "access_needs_too_long"] as const;

/** Códigos de disponibilidad del contrato v1, aditivos y estables. */
export const AVAILABILITY_ERROR_CODES = [
  "availability_invalid_weekday",
  "availability_invalid_time_range",
  "availability_invalid_modality",
  "availability_invalid_duration",
  "availability_too_many_items",
] as const;

/** Códigos del catálogo de espacios del contrato v1, aditivos y estables. */
export const SPACE_ERROR_CODES = ["space_invalid_field", "space_too_many_items"] as const;

/** Códigos de reserva del contrato v1, aditivos y estables. */
export const RESERVATION_ERROR_CODES = [
  "reservation_unknown_status",
  "reservation_invalid_modality",
  "reservation_invalid_time_range",
] as const;

/** Todo código público del contrato versionado, sin duplicar la API. */
export const PUBLIC_ERROR_CODES = [
  ...SPRINT_1_ERROR_CODES,
  ...AVAILABILITY_ERROR_CODES,
  ...SPACE_ERROR_CODES,
  ...RESERVATION_ERROR_CODES,
] as const;

export type PublicErrorCode = (typeof PUBLIC_ERROR_CODES)[number];

/** Mensaje público en español de cada código, sin motivo interno. */
export const PUBLIC_ERROR_MESSAGES: Record<PublicErrorCode, string> = {
  access_needs_empty: "Se requiere describir la necesidad de acceso.",
  access_needs_too_long: "El texto de necesidades de acceso supera el máximo permitido.",
  availability_invalid_weekday: "El día de la semana debe estar entre 0 y 6.",
  availability_invalid_time_range: "El rango horario debe avanzar en formato HH:MM.",
  availability_invalid_modality: "La modalidad debe ser presencial o en línea.",
  availability_invalid_duration: "La duración debe estar entre 15 y 480 minutos.",
  availability_too_many_items: "Se pidieron más franjas de las permitidas por lectura.",
  space_invalid_field:
    "El espacio debe traer campus, edificio, piso, sala, acceso e instrucciones.",
  space_too_many_items: "Se pidieron más espacios de los permitidos por lectura.",
  reservation_unknown_status: "El estado de la reserva no pertenece al contrato vigente.",
  reservation_invalid_modality: "La modalidad debe ser presencial o en línea.",
  reservation_invalid_time_range: "El rango de la reserva debe avanzar en el tiempo.",
};

/** Construye un error público sin exponer detalles internos. */
export function toPublicApiError(code: PublicErrorCode): PublicApiError {
  return { code, message: PUBLIC_ERROR_MESSAGES[code] };
}

/** Resultado versionado que suma `version` sin duplicar la forma de éxito. */
export type VersionedApiResult<T> = ApiResult<T> & { version: ApiContractVersion };

/** Envuelve un `ApiResult` con la versión del contrato vigente. */
export function withContractVersion<T>(result: ApiResult<T>): VersionedApiResult<T> {
  return { ...result, version: API_CONTRACT_VERSION };
}
