import { describe, expect, test } from "vitest";
import {
  API_CONTRACT_VERSION,
  PUBLIC_ERROR_CODES,
  PUBLIC_ERROR_MESSAGES,
  toPublicApiError,
  withContractVersion,
} from "./api_error";
import {
  AGENDA_CONTRACT_VERSION,
  RESERVATION_CONTRACT_VERSION,
  SPACE_CATALOG_CONTRACT_VERSION,
} from "../index";

describe("Errores públicos versionados sin duplicar la API (TI2-87)", () => {
  test("la versión vigente es v1 en agenda, espacios, reserva y errores", () => {
    expect(API_CONTRACT_VERSION).toBe("v1");
    expect(AGENDA_CONTRACT_VERSION).toBe("v1");
    expect(SPACE_CATALOG_CONTRACT_VERSION).toBe("v1");
    expect(RESERVATION_CONTRACT_VERSION).toBe("v1");
  });

  test("Sprint 1 conserva sus códigos y mensajes sin cambios", () => {
    expect(toPublicApiError("access_needs_empty")).toEqual({
      code: "access_needs_empty",
      message: "Se requiere describir la necesidad de acceso.",
    });
    expect(toPublicApiError("access_needs_too_long")).toEqual({
      code: "access_needs_too_long",
      message: "El texto de necesidades de acceso supera el máximo permitido.",
    });
    expect(PUBLIC_ERROR_CODES).toContain("access_needs_empty");
    expect(PUBLIC_ERROR_CODES).toContain("access_needs_too_long");
  });

  test("los códigos nuevos son aditivos, estables y sin detalles internos", () => {
    expect(PUBLIC_ERROR_CODES).toContain("availability_invalid_weekday");
    expect(PUBLIC_ERROR_CODES).toContain("space_invalid_field");
    expect(PUBLIC_ERROR_CODES).toContain("reservation_unknown_status");
    for (const code of PUBLIC_ERROR_CODES) {
      const error = toPublicApiError(code);
      expect(error.code).toBe(code);
      expect(error.message).toBe(PUBLIC_ERROR_MESSAGES[code]);
      expect("stack" in error).toBe(false);
    }
  });

  test("el envoltorio versionado suma v1 sin duplicar la forma", () => {
    expect(withContractVersion({ status: "ok", data: { id: "ficticio" } })).toEqual({
      status: "ok",
      data: { id: "ficticio" },
      version: "v1",
    });
    expect(
      withContractVersion({
        status: "error",
        error: { code: "space_invalid_field", message: "x" },
      }).version,
    ).toBe("v1");
  });
});
