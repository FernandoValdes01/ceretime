// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../../../../../convex/_generated/dataModel";
import {
  toOutcome,
  toOwnRequestActionFailure,
  useBackendConnected,
  useCancelOwnRequest,
  useRespondToInformationRequest,
} from "./student-request-actions.ts";

/**
 * Responder y cancelar (TI2-153): la traducción de errores, el desenlace de la
 * mutación y lo que cada hook envía. Los errores se construyen como los
 * entrega el SDK: el valor canónico viaja en `data` y el `message` lleva
 * contexto que nunca se muestra. Datos ficticios.
 *
 * `useMutation` se simula como en `session-state.test.tsx`: `convex/react` no
 * distingue referencias del `api` generado, así que un solo doble recibe las
 * llamadas de ambos hooks y la prueba mira sus argumentos.
 */
const mutation = vi.fn<(args: Record<string, unknown>) => Promise<unknown>>();
let connected = true;

vi.mock("convex/react", () => ({
  useMutation: () => mutation,
  useConvexConnectionState: () => ({ isWebSocketConnected: connected }),
}));

afterEach(() => {
  mutation.mockReset();
  connected = true;
});

const REQUEST_ID = "req-ficticia" as Id<"requests">;

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

  // Convex no rechaza una mutación por red caída (la reenvía cuando vuelve la conexión):
  // `failed` llega por un error del servidor sin `data` pública o por un código
  // que la Web no espera.
  test.each([
    [
      "un código sin explicación para esta acción",
      backendError({ code: "no_availability", message: "x" }),
    ],
    [
      "un error del servidor sin datos públicos",
      new Error("[CONVEX M(presentation/requests:cancelRequest)] [Request ID: abc] Server Error"),
    ],
    ["un ConvexError sin código", backendError("detalle interno")],
  ])("%s se trata como fallo recuperable sin mostrar su texto", (_, error) => {
    expect(toOwnRequestActionFailure(error)).toEqual({ status: "failed" });
  });
});

describe("toOutcome", () => {
  test("solo una mutación resuelta termina en done", async () => {
    await expect(toOutcome(Promise.resolve({ _id: REQUEST_ID }))).resolves.toEqual({
      status: "done",
    });
  });

  test("un rechazo nunca termina en done, aunque sea desconocido", async () => {
    const conflict = backendError({ code: "conflict", message: "No admite la cancelación." });
    await expect(toOutcome(Promise.reject(conflict))).resolves.toEqual({
      status: "rejected",
      message: "No admite la cancelación.",
    });
    await expect(toOutcome(Promise.reject(new Error("Server Error")))).resolves.toEqual({
      status: "failed",
    });
  });
});

describe("hooks de responder y cancelar", () => {
  test("cancelar envía la solicitud y el motivo escrito", async () => {
    mutation.mockResolvedValue({ _id: REQUEST_ID });
    const { result } = renderHook(() => useCancelOwnRequest());

    await expect(result.current(REQUEST_ID, "Ya no lo necesito.")).resolves.toEqual({
      status: "done",
    });
    expect(mutation).toHaveBeenCalledWith({ requestId: REQUEST_ID, reason: "Ya no lo necesito." });
  });

  test("responder envía la solicitud y la respuesta escrita", async () => {
    mutation.mockResolvedValue({ _id: REQUEST_ID });
    const { result } = renderHook(() => useRespondToInformationRequest());

    await expect(result.current(REQUEST_ID, "Martes por la tarde.")).resolves.toEqual({
      status: "done",
    });
    expect(mutation).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      response: "Martes por la tarde.",
    });
  });

  test("un rechazo de la mutación llega como fallo, no como éxito", async () => {
    mutation.mockRejectedValue(
      backendError({ code: "conflict", message: "No admite la cancelación." }),
    );
    const { result } = renderHook(() => useCancelOwnRequest());

    await expect(result.current(REQUEST_ID, "Motivo ficticio.")).resolves.toEqual({
      status: "rejected",
      message: "No admite la cancelación.",
    });
  });

  test("useBackendConnected refleja la conexión del cliente", () => {
    connected = false;
    const { result } = renderHook(() => useBackendConnected());
    expect(result.current).toBe(false);
  });
});
