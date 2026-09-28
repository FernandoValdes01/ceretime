function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Mensajes de validación que la API pública documenta para Sprint 1. */
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
  if (isRecord(error) && error.data === "No autorizado") {
    return new Error("No autorizado");
  }
  if (error instanceof Error && publicRequestMessages.has(error.message)) {
    return new Error(error.message);
  }
  return new Error(fallback);
}
