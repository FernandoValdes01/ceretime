import {
  CONFLICT_ERROR_CODE,
  REQUEST_FIELDS_INVALID_ERROR_CODE,
  errResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";

/*
 * Rechazos de las operaciones de solicitudes que devuelven `ApiResult`
 * (TI2-141). Presentación los traduce con `unwrapApiResult`.
 */

/** Denegación genérica, sin motivo ni existencia del recurso. */
export function denied<T>(): ApiResult<T> {
  return errResult(unauthorizedError());
}

/** Un campo de la solicitud no cumple: el mensaje dice qué corregir. */
export function invalidFields<T>(message: string): ApiResult<T> {
  return errResult({ code: REQUEST_FIELDS_INVALID_ERROR_CODE, message });
}

/** El estado actual no admite el paso pedido. */
export function stateConflict<T>(message: string): ApiResult<T> {
  return errResult({ code: CONFLICT_ERROR_CODE, message });
}
