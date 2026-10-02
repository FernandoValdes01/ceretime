/**
 * Forma base de errores públicos y estados de respuesta (TI2-8).
 *
 * Formaliza el patrón que ya usa `presentation/session.ts` (un resultado
 * discriminado por `status`), para que Web y Mobile no dupliquen cada uno
 * su propia forma de leer errores de `ConvexError`.
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
