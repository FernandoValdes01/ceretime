import { ConvexError } from "convex/values";
import {
  UNAUTHORIZED_ERROR_CODE,
  UNAUTHORIZED_ERROR_MESSAGE,
  type PublicApiError,
} from "../../../../../convex/domain/index.ts";

/**
 * Error público del Backend (TI2-88), sin stack ni datos internos; `null` si
 * no lo es (una red caída, un `Error` común o un `ConvexError` sin código).
 *
 * Es la única lectura de `ConvexError` que comparten las vistas Web: cada
 * consumidor decide qué hacer con el código, pero ninguno vuelve a inspeccionar
 * `error.data` ni muestra `error.message` del SDK. Mientras Web y Convex se
 * despliegan por separado, la denegación anterior a TI2-181, con el texto
 * «No autorizado» en `error.data`, se lee como `unauthorized`.
 */
export function publicErrorOf(error: unknown): PublicApiError | null {
  if (!(error instanceof ConvexError)) {
    return null;
  }
  const data: unknown = error.data;
  if (typeof data === "object" && data !== null) {
    const record = data as { code?: unknown; message?: unknown };
    if (typeof record.code === "string" && typeof record.message === "string") {
      return { code: record.code, message: record.message };
    }
  }
  if (data === UNAUTHORIZED_ERROR_MESSAGE) {
    return { code: UNAUTHORIZED_ERROR_CODE, message: UNAUTHORIZED_ERROR_MESSAGE };
  }
  return null;
}
