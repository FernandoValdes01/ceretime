import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { toOwnRequestActionFailure } from "./student-request-actions.ts";

/**
 * Traducción de errores de responder y cancelar (TI2-153). Los errores se
 * construyen como los entrega el SDK: el valor canónico viaja en `data` y el
 * `message` lleva contexto que nunca se muestra. Datos ficticios.
 */
function backendError(data: unknown): ConvexError<never> {
  const error = new ConvexError(data as never);
  error.message = "[CONVEX M(presentation/requests:cancelRequest)] [Request ID: abc] Server Error";
  return error;
}

describe("toOwnRequestActionFailure", () => {
  test("el conflicto con el estado actual muestra la explicación pública", () => {
    const message = "La solicitud no admite la cancelación en su estado actual.";
    expect(toOwnRequestActionFailure(backendError({ code: "conflict", message }))).toEqual({
      status: "rejected",
      message,
    });
  });

  test("los datos inválidos muestran qué corregir", () => {
    const message = "Se requiere el motivo para cancelar la solicitud.";
    expect(
      toOwnRequestActionFailure(backendError({ code: "request_fields_invalid", message })),
    ).toEqual({ status: "rejected", message });
  });

  test.each([
    ["el código del contrato común", { code: "unauthorized", message: "No autorizado" }],
    ["el texto de Sprint 1", "No autorizado"],
  ])("la denegación con %s no revela el motivo", (_, data) => {
    expect(toOwnRequestActionFailure(backendError(data))).toEqual({ status: "denied" });
  });

  test.each([
    [
      "un código sin explicación para esta acción",
      backendError({ code: "no_availability", message: "x" }),
    ],
    ["un error común", new Error("Server Error: detalle interno")],
    ["una red caída", new TypeError("Failed to fetch")],
  ])("%s se trata como fallo recuperable sin mostrar su texto", (_, error) => {
    expect(toOwnRequestActionFailure(error)).toEqual({ status: "failed" });
  });
});
