import { describe, expect, test, vi } from "vitest";
import {
  buildVapidAuthorization,
  encryptWebPushPayload,
  webPushConfigFromEnv,
  webPushSender,
  type WebPushConfig,
} from "./web_push_sender";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function generateVapidTestConfig(): Promise<WebPushConfig> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwkPriv = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return {
    publicKey: bytesToBase64Url(rawPub),
    privateKey: jwkPriv.d ?? "",
    subject: "mailto:prueba@alu.uct.cl",
  };
}

async function generateSubscriberKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    privateKey: pair.privateKey,
    p256dh: bytesToBase64Url(rawPub),
    auth: bytesToBase64Url(auth),
    rawPub,
    authBytes: auth,
  };
}

describe("adaptador Web Push VAPID (TI2-160)", () => {
  test("devuelve null cuando falta alguna variable VAPID", () => {
    expect(webPushConfigFromEnv({})).toBeNull();
    expect(webPushConfigFromEnv({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" })).toBeNull();
  });

  test("firma un JWT VAPID verificable con la clave pública P-256", async () => {
    const config = await generateVapidTestConfig();
    const header = await buildVapidAuthorization(
      config,
      "https://push.example.test",
      Date.UTC(2027, 0, 4, 12),
    );
    expect(header).toContain(`k=${config.publicKey}`);
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [h, p, s] = (match?.[1] ?? "").split(".");
    const verifyKey = await crypto.subtle.importKey(
      "raw",
      base64UrlToBytes(config.publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verifyKey,
      base64UrlToBytes(s ?? ""),
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(valid).toBe(true);
  });

  test("cifra el mensaje genérico según RFC 8291 (aes128gcm) y el navegador puede descifrarlo", async () => {
    const sub = await generateSubscriberKeys();
    const encrypted = await encryptWebPushPayload(
      { p256dh: sub.p256dh, auth: sub.auth },
      {
        title: "Tienes una actualización pendiente",
        body: "Revisa las novedades en la aplicación.",
      },
    );

    const salt = encrypted.slice(0, 16);
    const recordSize = new DataView(encrypted.buffer, encrypted.byteOffset).getUint32(16, false);
    const idLen = encrypted[20];
    expect(recordSize).toBe(4096);
    expect(idLen).toBe(65);
    const asPublicBytes = encrypted.slice(21, 21 + 65);
    const ciphertext = encrypted.slice(21 + 65);

    const asPublicKey = await crypto.subtle.importKey(
      "raw",
      asPublicBytes,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    const ecdhSecret = new Uint8Array(
      await crypto.subtle.deriveBits({ name: "ECDH", public: asPublicKey }, sub.privateKey, 256),
    );

    const hkdf = async (s: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) => {
      const k = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, [
        "deriveBits",
      ]);
      return new Uint8Array(
        await crypto.subtle.deriveBits(
          { name: "HKDF", hash: "SHA-256", salt: s as BufferSource, info: info as BufferSource },
          k,
          len * 8,
        ),
      );
    };
    const prefix = new TextEncoder().encode("WebPush: info\0");
    const keyInfo = new Uint8Array(prefix.length + sub.rawPub.length + asPublicBytes.length);
    keyInfo.set(prefix, 0);
    keyInfo.set(sub.rawPub, prefix.length);
    keyInfo.set(asPublicBytes, prefix.length + sub.rawPub.length);

    const ikm = await hkdf(sub.authBytes, ecdhSecret, keyInfo, 32);
    const cekBytes = await hkdf(
      salt,
      ikm,
      new TextEncoder().encode("Content-Encoding: aes128gcm\0"),
      16,
    );
    const nonce = await hkdf(salt, ikm, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);
    const cek = await crypto.subtle.importKey("raw", cekBytes, "AES-GCM", false, ["decrypt"]);
    const decrypted = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, cek, ciphertext),
    );
    expect(decrypted[decrypted.length - 1]).toBe(0x02);
    const parsed = JSON.parse(new TextDecoder().decode(decrypted.slice(0, -1))) as {
      title: string;
      body: string;
    };
    expect(parsed).toEqual({
      title: "Tienes una actualización pendiente",
      body: "Revisa las novedades en la aplicación.",
    });
  });

  test("traduce 201 a sent, 410/404 a expired, 403 a not_authorized y 5xx a provider_unavailable", async () => {
    const config = await generateVapidTestConfig();
    const sub = await generateSubscriberKeys();
    const target = {
      endpoint: "https://push.example.test/sub/1",
      p256dh: sub.p256dh,
      auth: sub.auth,
    };
    const message = {
      title: "Tienes una actualización pendiente",
      body: "Revisa las novedades en la aplicación.",
    };

    const okFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    await expect(webPushSender(config, okFetch).send(target, message)).resolves.toEqual({
      status: "sent",
    });

    const goneFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 410 }));
    await expect(webPushSender(config, goneFetch).send(target, message)).resolves.toEqual({
      status: "expired",
    });

    const forbiddenFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(webPushSender(config, forbiddenFetch).send(target, message)).resolves.toEqual({
      status: "failed",
      errorCode: "not_authorized",
    });

    const downFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(webPushSender(config, downFetch).send(target, message)).resolves.toEqual({
      status: "failed",
      errorCode: "provider_unavailable",
    });

    const droppedFetch = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("socket hang up"));
    await expect(webPushSender(config, droppedFetch).send(target, message)).resolves.toEqual({
      status: "failed",
      errorCode: "delivery_uncertain",
    });

    await expect(webPushSender(null, okFetch).send(target, message)).resolves.toEqual({
      status: "failed",
      errorCode: "not_configured",
    });
  });
});
