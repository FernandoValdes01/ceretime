import { afterEach, describe, expect, test, vi } from "vitest";
import {
  extractPushSubscriptionPayload,
  subscribeBrowserPush,
  unsubscribeBrowserPush,
  vapidPublicKeyToUint8Array,
} from "./web-push";

describe("adaptador Web Push del navegador (TI2-160)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("convierte una clave pública VAPID base64url a Uint8Array", () => {
    const bytes = vapidPublicKeyToUint8Array("BAECAwQ");
    expect(Array.from(bytes)).toEqual([4, 1, 2, 3, 4]);
  });

  test("extrae endpoint y claves públicas p256dh/auth de la suscripción", () => {
    const p256dh = new Uint8Array([4, 1, 2, 3]).buffer;
    const auth = new Uint8Array([9, 8, 7, 6]).buffer;
    const payload = extractPushSubscriptionPayload({
      endpoint: "https://push.example.test/sub/1",
      expirationTime: null,
      getKey: (name) => (name === "p256dh" ? p256dh : auth),
    });
    expect(payload).toEqual({
      endpoint: "https://push.example.test/sub/1",
      p256dh: "BAECAw",
      auth: "CQgHBg",
    });

    const missingKey = extractPushSubscriptionPayload({
      endpoint: "https://push.example.test/sub/1",
      expirationTime: null,
      getKey: () => null,
    });
    expect(missingKey).toBeNull();
  });

  test("devuelve unsupported cuando el navegador no tiene PushManager", async () => {
    const result = await subscribeBrowserPush("BAECAwQ");
    expect(result).toEqual({ status: "unsupported" });
    await expect(unsubscribeBrowserPush()).resolves.toBeNull();
  });
});
