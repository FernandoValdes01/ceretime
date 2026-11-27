import {
  CONFLICT_ERROR_CODE,
  PRIVACY_REQUEST_FIELDS_INVALID_ERROR_CODE,
  UNAUTHORIZED_ERROR_CODE,
} from "../../../../../convex/domain/index.ts";
import { publicErrorOf } from "../../infrastructure/convex/public-error.ts";

/**
 * Mensaje de una acción fallida sobre una solicitud de privacidad (TI2-171),
 * el mismo para el Estudiante y el Administrador.
 *
 * `conflict` y `privacy_request_fields_invalid` traen un mensaje público que
 * explica qué corregir o qué cambió; un error desconocido usa el genérico y
 * nunca muestra el texto del SDK.
 */
export function privacyActionErrorMessage(error: unknown): string {
  const publicError = publicErrorOf(error);
  if (publicError?.code === UNAUTHORIZED_ERROR_CODE) {
    return "No tienes acceso a esta solicitud de privacidad.";
  }
  if (
    publicError?.code === CONFLICT_ERROR_CODE ||
    publicError?.code === PRIVACY_REQUEST_FIELDS_INVALID_ERROR_CODE
  ) {
    return publicError.message;
  }
  return "No pudimos completar la acción. Inténtalo de nuevo.";
}
