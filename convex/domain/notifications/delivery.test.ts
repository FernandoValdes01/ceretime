import { describe, expect, test } from "vitest";
import {
  deliveryRetryAt,
  isNotificationDeliveryError,
  MAX_PROVIDER_UNAVAILABLE_ATTEMPTS,
  SENDER_SETUP_RETRY_DELAY_MS,
} from "./delivery";

const BASE_TIME = Date.UTC(2027, 0, 4, 12, 0, 0);

describe("política de reintentos de entrega (TI2-159)", () => {
  test("reconoce not_authorized como código estable de entrega", () => {
    expect(isNotificationDeliveryError("not_authorized")).toBe(true);
    expect(isNotificationDeliveryError("raw_oauth_error")).toBe(false);
  });

  test("una entrega enviada no se vuelve a intentar", () => {
    expect(
      deliveryRetryAt({
        channel: "email",
        status: "sent",
        attempts: 1,
        lastAttemptAt: BASE_TIME,
        sentAt: BASE_TIME,
      }),
    ).toBeNull();
  });

  test("una entrega pendiente queda disponible de inmediato", () => {
    expect(
      deliveryRetryAt({
        channel: "email",
        status: "pending",
        attempts: 0,
      }),
    ).toBe(0);
    expect(
      deliveryRetryAt({
        channel: "email",
        status: "pending",
        attempts: 0,
        lastAttemptAt: BASE_TIME,
      }),
    ).toBe(BASE_TIME);
  });

  test("un destino inválido no se reintenta", () => {
    expect(
      deliveryRetryAt({
        channel: "email",
        status: "failed",
        attempts: 1,
        lastAttemptAt: BASE_TIME,
        errorCode: "invalid_destination",
      }),
    ).toBeNull();
  });

  test("falta de configuración o autorización sigue reintentando sin agotar intentos", () => {
    for (const errorCode of ["not_configured", "not_authorized"] as const) {
      expect(
        deliveryRetryAt({
          channel: "email",
          status: "failed",
          attempts: MAX_PROVIDER_UNAVAILABLE_ATTEMPTS + 10,
          lastAttemptAt: BASE_TIME,
          errorCode,
        }),
      ).toBe(BASE_TIME + SENDER_SETUP_RETRY_DELAY_MS);
    }
  });

  test("proveedor no disponible aplica espera exponencial hasta el tope de intentos", () => {
    const delays = [1, 2, 3, 4, 5].map((attempts) => {
      const retryAt = deliveryRetryAt({
        channel: "email",
        status: "failed",
        attempts,
        lastAttemptAt: BASE_TIME,
        errorCode: "provider_unavailable",
      });
      return retryAt === null ? null : retryAt - BASE_TIME;
    });
    expect(delays).toEqual([60_000, 120_000, 240_000, 480_000, 960_000]);

    expect(
      deliveryRetryAt({
        channel: "email",
        status: "failed",
        attempts: MAX_PROVIDER_UNAVAILABLE_ATTEMPTS,
        lastAttemptAt: BASE_TIME,
        errorCode: "provider_unavailable",
      }),
    ).toBeNull();
  });
});
