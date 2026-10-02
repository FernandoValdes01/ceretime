import { describe, expect, expectTypeOf, test } from "vitest";
import {
  API_ERROR_CODE_VALUES,
  API_ERROR_MESSAGES,
  CONFLICT_ERROR_CODE,
  CONFLICT_ERROR_MESSAGE,
  NO_AVAILABILITY_ERROR_CODE,
  NO_AVAILABILITY_ERROR_MESSAGE,
  UNAUTHORIZED_ERROR_CODE,
  UNAUTHORIZED_ERROR_MESSAGE,
  conflictError,
  errResult,
  isApiErrorCode,
  isErrorResult,
  isOkResult,
  noAvailabilityError,
  okResult,
  unauthorizedError,
  type ApiErrorCode,
  type ApiResult,
} from "./api_error";
import {
  CONFLICT_ERROR_CODE as BARREL_CONFLICT,
  NO_AVAILABILITY_ERROR_CODE as BARREL_NO_AVAILABILITY,
  UNAUTHORIZED_ERROR_CODE as BARREL_UNAUTHORIZED,
  type ApiErrorCode as BarrelApiErrorCode,
} from "../index";

describe("Códigos estables de conflicto, acceso denegado y ausencia de cupo (TI2-88)", () => {
  test("los tres códigos son distintos y pertenecen al contrato común", () => {
    expect(UNAUTHORIZED_ERROR_CODE).toBe("unauthorized");
    expect(CONFLICT_ERROR_CODE).toBe("conflict");
    expect(NO_AVAILABILITY_ERROR_CODE).toBe("no_availability");
    expect(
      new Set([UNAUTHORIZED_ERROR_CODE, CONFLICT_ERROR_CODE, NO_AVAILABILITY_ERROR_CODE]).size,
    ).toBe(3);
    expect([...API_ERROR_CODE_VALUES]).toContain("unauthorized");
    expect([...API_ERROR_CODE_VALUES]).toContain("conflict");
    expect([...API_ERROR_CODE_VALUES]).toContain("no_availability");
  });

  test("se conserva la compatibilidad de Sprint 1 sin otra representación", () => {
    expect([...API_ERROR_CODE_VALUES]).toContain("access_needs_empty");
    expect([...API_ERROR_CODE_VALUES]).toContain("access_needs_too_long");
    expect([...API_ERROR_CODE_VALUES]).toEqual([
      "access_needs_empty",
      "access_needs_too_long",
      "unauthorized",
      "conflict",
      "no_availability",
    ]);
  });

  test("los códigos salen por el barrel sin duplicar la fuente", () => {
    expect(BARREL_UNAUTHORIZED).toBe(UNAUTHORIZED_ERROR_CODE);
    expect(BARREL_CONFLICT).toBe(CONFLICT_ERROR_CODE);
    expect(BARREL_NO_AVAILABILITY).toBe(NO_AVAILABILITY_ERROR_CODE);
    expectTypeOf<BarrelApiErrorCode>().toEqualTypeOf<ApiErrorCode>();
  });

  test("los mensajes son comprensibles y no filtran existencia ni datos sensibles", () => {
    expect(UNAUTHORIZED_ERROR_MESSAGE).toBe("No autorizado");
    expect(CONFLICT_ERROR_MESSAGE).toContain("conflicto");
    expect(NO_AVAILABILITY_ERROR_MESSAGE).toContain("canal oficial");
    for (const code of API_ERROR_CODE_VALUES) {
      const message = API_ERROR_MESSAGES[code];
      expect(typeof message).toBe("string");
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toMatch(/stack|Id\(|needs|nota/i);
    }
  });

  test("la ausencia de cupo pide coordinación por el canal oficial, no reserva incompatible", () => {
    const error = noAvailabilityError();
    expect(error).toEqual({
      code: "no_availability",
      message: "Sin cupo disponible. Coordina por el canal oficial con la referencia indicada.",
    });
    expect(error.message).not.toMatch(/reserv/i);
  });

  test("las fábricas devuelven solo código y mensaje, sin detalles sensibles", () => {
    expect(unauthorizedError()).toEqual({ code: "unauthorized", message: "No autorizado" });
    expect(conflictError()).toEqual({
      code: "conflict",
      message: "La solicitud entra en conflicto con el estado actual.",
    });
    for (const error of [unauthorizedError(), conflictError(), noAvailabilityError()]) {
      expect(Object.keys(error).sort()).toEqual(["code", "message"]);
      expect(isApiErrorCode(error.code)).toBe(true);
    }
    expect(isApiErrorCode("otro_codigo")).toBe(false);
  });
});

describe("Forma de éxito y error del contrato público común (TI2-88)", () => {
  test("el éxito trae las claves exactas y los clientes no leen el texto como código", () => {
    const result: ApiResult<{ readonly id: string }> = okResult({ id: "ficticio-1" });
    expect(result).toEqual({ status: "ok", data: { id: "ficticio-1" } });
    expect(Object.keys(result).sort()).toEqual(["data", "status"]);
    expect(isOkResult(result)).toBe(true);
    expect(isErrorResult(result)).toBe(false);
    if (!isOkResult(result)) throw new Error("Se esperaba éxito");
    expect(Object.keys(result.data).sort()).toEqual(["id"]);
  });

  test("el error trae las claves exactas con código estable para ambos clientes", () => {
    const result: ApiResult<never> = errResult(conflictError());
    expect(result).toEqual({
      status: "error",
      error: {
        code: "conflict",
        message: "La solicitud entra en conflicto con el estado actual.",
      },
    });
    expect(Object.keys(result).sort()).toEqual(["error", "status"]);
    expect(isErrorResult(result)).toBe(true);
    expect(isOkResult(result)).toBe(false);
    if (!isErrorResult(result)) throw new Error("Se esperaba error");
    expect(Object.keys(result.error).sort()).toEqual(["code", "message"]);
    expect(result.error.code).toBe("conflict");
    expect(result.error.code).not.toBe(result.error.message);
  });

  test("el error ignora campos extra como pilas o identificadores de terceros", () => {
    const conExtras = {
      code: "unauthorized",
      message: "No autorizado",
      stack: "pila ficticia",
      studentId: "tercero ficticio",
    };
    const result = errResult(conExtras);
    expect(result).toEqual({
      status: "error",
      error: { code: "unauthorized", message: "No autorizado" },
    });
    if (!isErrorResult(result)) throw new Error("Se esperaba error");
    expect(Object.keys(result.error).sort()).toEqual(["code", "message"]);
  });
});
