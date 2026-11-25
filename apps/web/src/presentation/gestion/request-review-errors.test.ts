import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import {
  isRequestAccessDenied,
  REQUEST_ACTION_FALLBACK_MESSAGE,
  requestActionFailureOf,
} from "./request-review-errors.ts";

/** Traducción de errores de las acciones del Profesional (TI2-157). Datos ficticios. */
describe("requestActionFailureOf (TI2-157)", () => {
  test("la denegación del contrato común es acceso denegado", () => {
    expect(
      requestActionFailureOf(
        new ConvexError({ code: "unauthorized", message: "No autorizado" }),
        "accept",
      ),
    ).toEqual({ status: "denied" });
  });

  test("la denegación anterior a TI2-181, con texto en data, también es acceso denegado", () => {
    expect(requestActionFailureOf(new ConvexError("No autorizado"), "take")).toEqual({
      status: "denied",
    });
  });

  test("un dato inválido muestra el mensaje público terminado en punto", () => {
    expect(
      requestActionFailureOf(
        new ConvexError({
          code: "request_fields_invalid",
          message: "Se requiere el objetivo para abrir el acompañamiento",
        }),
        "accept",
      ),
    ).toEqual({
      status: "rejected",
      message: "Se requiere el objetivo para abrir el acompañamiento.",
    });
  });

  test("un conflicto suma cómo seguir según la acción", () => {
    const conflicto = new ConvexError({ code: "conflict", message: "Ya tomaste esta solicitud" });
    expect(requestActionFailureOf(conflicto, "take")).toEqual({
      status: "rejected",
      message:
        "Ya tomaste esta solicitud. Revisa «Mis tomadas» o elige otra solicitud de la bandeja.",
    });
    expect(requestActionFailureOf(conflicto, "close")).toEqual({
      status: "rejected",
      message:
        "Ya tomaste esta solicitud. El detalle ya muestra el estado vigente; continúa desde ahí.",
    });
  });

  test("errores del SDK, códigos desconocidos o sin mensaje usan el respaldo", () => {
    for (const error of [
      new Error("[CONVEX M(presentation/requests:takeRequest)] Server Error"),
      new ConvexError({ code: "otro_codigo", message: "Texto interno" }),
      new ConvexError({ code: "conflict" }),
      "texto suelto",
      undefined,
    ]) {
      expect(requestActionFailureOf(error, "requestInformation")).toEqual({
        status: "rejected",
        message: REQUEST_ACTION_FALLBACK_MESSAGE,
      });
    }
  });
});

describe("isRequestAccessDenied (TI2-157)", () => {
  test("reconoce solo la denegación genérica", () => {
    expect(
      isRequestAccessDenied(new ConvexError({ code: "unauthorized", message: "No autorizado" })),
    ).toBe(true);
    expect(isRequestAccessDenied(new ConvexError({ code: "conflict", message: "x" }))).toBe(false);
    expect(isRequestAccessDenied(new Error("No autorizado"))).toBe(false);
  });
});
