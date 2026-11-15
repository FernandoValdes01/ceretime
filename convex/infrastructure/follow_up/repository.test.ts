import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import type { QueryCtx } from "../../_generated/server";
import { followUpRecordReader, isInvalidCursorError } from "./repository";

/**
 * `convex-test` no reproduce el rechazo de un cursor de Convex (lee el
 * cursor con `JSON.parse`), así que estas pruebas simulan `paginate` para fijar
 * qué errores se traducen y cuáles se propagan.
 */
function readerWhosePaginateThrows(error: unknown) {
  const query = {
    withIndex: () => query,
    order: () => query,
    paginate: async () => {
      throw error;
    },
  };
  const ctx = {
    db: { normalizeId: (_table: string, id: string) => id, query: () => query },
  } as unknown as QueryCtx;
  return followUpRecordReader(ctx);
}

const INVALID_CURSOR_ERRORS = [
  ["un error con InvalidCursor en el mensaje", new Error("InvalidCursor: el cursor no es válido")],
  [
    "un error de sistema con paginationError InvalidCursor",
    new ConvexError({ isConvexSystemError: true, paginationError: "InvalidCursor" }),
  ],
] as const;

describe("historial de seguimiento: errores de paginate (TI2-146)", () => {
  test.each(INVALID_CURSOR_ERRORS)("%s se traduce en null", async (_name, error) => {
    expect(isInvalidCursorError(error)).toBe(true);
    expect(
      await readerWhosePaginateThrows(error).listByAccompaniment("acc-1", {
        limit: 5,
        cursor: "cursor-rechazado",
      }),
    ).toBeNull();
  });

  test.each([
    ["un defecto del servidor", new Error("fallo inesperado")],
    ["un límite de lectura", new Error("Too many documents read in a single function execution")],
    ["un ConvexError sin paginationError", new ConvexError({ code: "conflict" })],
    ["un valor que no es un Error", "InvalidCursor"],
  ] as const)("%s con cursor se propaga como interno", async (_name, error) => {
    expect(isInvalidCursorError(error)).toBe(false);
    await expect(
      readerWhosePaginateThrows(error).listByAccompaniment("acc-1", {
        limit: 5,
        cursor: "cursor-valido",
      }),
    ).rejects.toBe(error);
  });
});
