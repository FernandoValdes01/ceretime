import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { toSubmitFailure } from "./student-request-form-data.ts";

/** Traducción de los errores de `createRequest` (TI2-149). */
describe("TI2-149: desenlace de un envío fallido", () => {
  test("los rechazos de los datos muestran el mensaje público del Backend", () => {
    for (const code of [
      "request_fields_invalid",
      "access_needs_empty",
      "access_needs_too_long",
      "conflict",
    ]) {
      expect(toSubmitFailure(new ConvexError({ code, message: "Mensaje público." }))).toEqual({
        status: "rejected",
        message: "Mensaje público.",
      });
    }
  });

  test("la denegación con código o con el texto anterior es la misma", () => {
    expect(
      toSubmitFailure(new ConvexError({ code: "unauthorized", message: "No autorizado" })),
    ).toEqual({ status: "denied" });
    expect(toSubmitFailure(new ConvexError("No autorizado"))).toEqual({ status: "denied" });
  });

  test("un fallo de red, un código desconocido o un error sin mensaje es recuperable", () => {
    expect(toSubmitFailure(new Error("[CONVEX M(...)] Server Error"))).toEqual({
      status: "failed",
    });
    expect(toSubmitFailure(new ConvexError({ code: "otro", message: "x" }))).toEqual({
      status: "failed",
    });
    expect(toSubmitFailure(new ConvexError({ code: "request_fields_invalid" }))).toEqual({
      status: "failed",
    });
    expect(toSubmitFailure(new ConvexError({ code: "no_availability", message: "x" }))).toEqual({
      status: "failed",
    });
  });
});
