import { API_ERROR_MESSAGES, isApiErrorCode } from "../../../../convex/domain/errors/api_error";
import { LocalOperationError } from "../application/operation-error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Compatibilidad con operaciones antiguas que todavía no publican códigos. */
const publicRequestMessages = new Set([
  "Se requiere describir la necesidad de acceso",
  "La necesidad de acceso supera el máximo permitido (2000 caracteres)",
  "Solo se pueden tomar solicitudes recibidas",
  "Ya tomaste esta solicitud",
  "La solicitud no admite iniciar la revisión en su estado actual",
  "Se requiere el motivo para pedir información adicional",
  "La solicitud no admite pedir información adicional en su estado actual",
  "La solicitud ya fue aceptada",
  "La solicitud no admite la aceptación en su estado actual",
  "Se requiere el objetivo para abrir el acompañamiento",
]);

export function toMobileOperationError(error: unknown, fallback: string): Error {
  if (error instanceof LocalOperationError) return error;
  const data = isRecord(error) && isRecord(error.data) ? error.data : error;
  if (isRecord(data) && typeof data.code === "string") {
    return new LocalOperationError(
      isApiErrorCode(data.code) ? API_ERROR_MESSAGES[data.code] : fallback,
    );
  }
  if (isRecord(error) && error.data === "No autorizado") {
    return new LocalOperationError("No autorizado");
  }
  if (error instanceof Error && publicRequestMessages.has(error.message)) {
    return new LocalOperationError(error.message);
  }
  return new LocalOperationError(fallback);
}

/** Transición compatible para denegaciones antiguas y el código público actual. */
export function isMobileAccessDenied(error: unknown): boolean {
  if (!isRecord(error)) return false;
  return (
    error.data === "No autorizado" ||
    (isRecord(error.data) && error.data.code === "unauthorized") ||
    error.code === "unauthorized"
  );
}
