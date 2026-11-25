import { describe, expect, test } from "vitest";
import { isAllowedWebPushEndpoint, parseAllowedWebPushEndpointOrigin } from "./push";

describe("validación de destinos Web Push (TI2-160)", () => {
  test.each([
    ["https://fcm.googleapis.com/fcm/send/token-1", "https://fcm.googleapis.com"],
    ["https://android.googleapis.com/gcm/send/token-1", "https://android.googleapis.com"],
    [
      "https://updates.push.services.mozilla.com/wpush/v2/token-1",
      "https://updates.push.services.mozilla.com",
    ],
    ["https://web.push.apple.com/token-1", "https://web.push.apple.com"],
    ["https://sg2p.push.apple.com/token-1", "https://sg2p.push.apple.com"],
    ["https://wns2-bl2p.notify.windows.com/w/?token=1", "https://wns2-bl2p.notify.windows.com"],
  ])("admite el origen de proveedor Web Push %s", (endpoint, expectedOrigin) => {
    expect(parseAllowedWebPushEndpointOrigin(endpoint)).toBe(expectedOrigin);
    expect(isAllowedWebPushEndpoint(endpoint)).toBe(true);
  });

  test.each([
    "",
    "   ",
    "no-es-una-url",
    "http://fcm.googleapis.com/fcm/send/token-1",
    "https://evil.example.test/push/1",
    "https://fcm.googleapis.com.evil.test/fcm/send/1",
    "https://evil-push.apple.com/token-1",
    "https://push.apple.com/token-1",
    "https://notify.windows.com/token-1",
    "https://fcm.googleapis.com:8443/fcm/send/1",
    "https://user:pass@fcm.googleapis.com/fcm/send/1",
  ])("rechaza el destino ajeno o inválido %s", (endpoint) => {
    expect(parseAllowedWebPushEndpointOrigin(endpoint)).toBeNull();
    expect(isAllowedWebPushEndpoint(endpoint)).toBe(false);
  });
});
