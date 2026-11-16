import {
  CONFLICT_ERROR_CODE,
  errResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import { toAccompanimentRequest, type AccompanimentRequest } from "../../domain/requests/request";
import type { RequestState } from "../../domain/requests/state";
import type { StoredRequestRow } from "./ports";

/*
 * Resultados de las operaciones de solicitudes que devuelven `ApiResult`
 * (TI2-141, TI2-181): la entidad pública y los rechazos. Presentación los
 * traduce con `unwrapApiResult`. El de un campo inválido es
 * `invalidRequestFields`, de Dominio, junto a la validación.
 */

/** Solicitud pública con los identificadores que instancia Presentación. */
export type RequestEntity<
  RequestId extends string,
  UserId extends string,
> = AccompanimentRequest & {
  readonly _id: RequestId;
  readonly studentId: UserId;
};

/**
 * Entidad pública de una fila, con el estado que deja la operación. Es la
 * única conversión del módulo: un campo nuevo de la entidad se agrega aquí.
 */
export function toEntity<RequestId extends string, UserId extends string>(
  row: StoredRequestRow<RequestId, UserId>,
  status: RequestState = row.status,
): RequestEntity<RequestId, UserId> {
  return toAccompanimentRequest({
    _id: row._id,
    studentId: row.studentId,
    status,
    accessNeeds: row.accessNeeds,
    createdAt: row.createdAt,
  });
}

/** Denegación genérica, sin motivo ni existencia del recurso. */
export function denied<T>(): ApiResult<T> {
  return errResult(unauthorizedError());
}

/** El estado actual no admite el paso pedido. */
export function stateConflict<T>(message: string): ApiResult<T> {
  return errResult({ code: CONFLICT_ERROR_CODE, message });
}
