function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
