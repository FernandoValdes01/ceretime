import { ConvexError } from "convex/values";
import { API_ERROR_MESSAGES } from "../../../convex/domain/errors/api_error";
import { toMobileOperationError } from "@/presentation/to-mobile-operation-error";

test.each(Object.entries(API_ERROR_MESSAGES))(
  "interpreta el código público %s aunque cambie la redacción del servidor",
  (code, message) => {
    const result = toMobileOperationError(
      new ConvexError({ code, message: "Otra redacción con un detalle del SDK" }),
      "No se pudo completar la operación.",
    );
    expect(result.message).toBe(message);
  },
);

test("un código desconocido no se interpreta por su mensaje", () => {
  expect(
    toMobileOperationError(
      new ConvexError({ code: "internal", message: "No autorizado" }),
      "Intenta nuevamente.",
    ).message,
  ).toBe("Intenta nuevamente.");
});
