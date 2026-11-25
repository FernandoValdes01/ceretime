/**
 * Adaptador de Web Push con VAPID y cifrado RFC 8291 (`aes128gcm`) (TI2-160).
 *
 * Capa de Infraestructura: firma los envíos con claves VAPID (RFC 8292) y
 * cifra el texto genérico extremo a extremo con Web Crypto API, sin depender
 * del runtime de Node ni exponer la clave privada fuera del servidor. Las
 * respuestas del servicio push del navegador se traducen a estados estables:
 * `404` y `410` devuelven `expired` para que el despacho retire la suscripción
 * vencida; el resto de los fallos usa los códigos genéricos de entrega.
 */

import type {
  PushMessage,
  PushSender,
  PushSendResult,
  PushSubscriptionTarget,
} from "../../application/notifications/ports";
import { parseAllowedWebPushEndpointOrigin } from "../../domain/notifications/push";

/** Claves VAPID del remitente, leídas solo desde variables de entorno. */
export interface WebPushConfig {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly subject: string;
}

export interface WebPushEnv {
  readonly VAPID_PUBLIC_KEY?: string;
  readonly VAPID_PRIVATE_KEY?: string;
  readonly VAPID_SUBJECT?: string;
}

/** Configuración VAPID desde entorno, o `null` si falta alguna variable. */
export function webPushConfigFromEnv(env: WebPushEnv): WebPushConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = env.VAPID_SUBJECT?.trim() ?? "";
  if (publicKey === "" || privateKey === "" || subject === "") return null;
  return { publicKey, privateKey, subject };
}

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

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  let total = 0;
  for (const part of parts) total += part.length;
  const buffer = new ArrayBuffer(total);
  const result = new Uint8Array(buffer);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function utf8Bytes(value: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(value);
  const buffer = new ArrayBuffer(encoded.byteLength);
  const copy = new Uint8Array(buffer);
  copy.set(encoded);
  return copy;
}

async function hkdfDerive(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  lengthBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const baseKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    baseKey,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Cifra la carga JSON según RFC 8291 (`aes128gcm`) para la clave pública y el
 * secreto de autenticación del navegador.
 */
export async function encryptWebPushPayload(
  target: Pick<PushSubscriptionTarget, "p256dh" | "auth">,
  payload: PushMessage,
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublicBytes = base64UrlToBytes(target.p256dh);
  const authSecret = base64UrlToBytes(target.auth);
  if (uaPublicBytes.length !== 65 || uaPublicBytes[0] !== 0x04 || authSecret.length !== 16) {
    throw new Error("Claves de suscripción push inválidas.");
  }

  const uaPublicKey = await crypto.subtle.importKey(
    "raw",
    uaPublicBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const asPublicBytes = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: uaPublicKey },
      ephemeral.privateKey,
      256,
    ),
  );

  const keyInfo = concatBytes(utf8Bytes("WebPush: info\0"), uaPublicBytes, asPublicBytes);
  const ikm = await hkdfDerive(authSecret, ecdhSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const cekBytes = await hkdfDerive(salt, ikm, utf8Bytes("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfDerive(salt, ikm, utf8Bytes("Content-Encoding: nonce\0"), 12);

  const cek = await crypto.subtle.importKey("raw", cekBytes, "AES-GCM", false, ["encrypt"]);
  const plaintext = concatBytes(
    utf8Bytes(JSON.stringify({ title: payload.title, body: payload.body })),
    new Uint8Array([0x02]),
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cek, plaintext),
  );

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  const header = concatBytes(
    salt,
    recordSize,
    new Uint8Array([asPublicBytes.length]),
    asPublicBytes,
  );
  return concatBytes(header, ciphertext);
}

/** Firma el encabezado `Authorization: vapid ...` (RFC 8292) para el origen del endpoint. */
export async function buildVapidAuthorization(
  config: WebPushConfig,
  endpointOrigin: string,
  nowMs: number,
): Promise<string> {
  const pubBytes = base64UrlToBytes(config.publicKey);
  if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) {
    throw new Error("La clave pública VAPID no tiene formato P-256 sin comprimir.");
  }
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: bytesToBase64Url(pubBytes.slice(1, 33)),
    y: bytesToBase64Url(pubBytes.slice(33, 65)),
    d: config.privateKey,
  };
  const signingKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const headerB64 = bytesToBase64Url(utf8Bytes(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const exp = Math.floor(nowMs / 1000) + 12 * 3600;
  const payloadB64 = bytesToBase64Url(
    utf8Bytes(JSON.stringify({ aud: endpointOrigin, exp, sub: config.subject })),
  );
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      signingKey,
      utf8Bytes(signingInput),
    ),
  );
  const jwt = `${signingInput}.${bytesToBase64Url(signature)}`;
  return `vapid t=${jwt}, k=${config.publicKey}`;
}

/**
 * Puerto `PushSender` con Web Push (TI2-160). Sin claves VAPID responde
 * `not_configured`; rechaza orígenes ajenos a los proveedores admitidos antes
 * de invocar `fetch`, deshabilita redirecciones y nunca lanza por fallos del
 * servicio push.
 */
export function webPushSender(
  config: WebPushConfig | null,
  fetchImpl: typeof fetch = fetch,
  now: () => number = () => Date.now(),
): PushSender {
  return {
    send: async (target: PushSubscriptionTarget, message: PushMessage): Promise<PushSendResult> => {
      if (config === null) return { status: "failed", errorCode: "not_configured" };
      const origin = parseAllowedWebPushEndpointOrigin(target.endpoint);
      if (origin === null) return { status: "failed", errorCode: "invalid_destination" };

      let authorization: string;
      try {
        authorization = await buildVapidAuthorization(config, origin, now());
      } catch {
        return { status: "failed", errorCode: "not_configured" };
      }

      let body: Uint8Array<ArrayBuffer>;
      try {
        body = await encryptWebPushPayload(target, message);
      } catch {
        return { status: "failed", errorCode: "invalid_destination" };
      }

      let response: Response;
      try {
        response = await fetchImpl(target.endpoint, {
          method: "POST",
          redirect: "manual",
          headers: {
            Authorization: authorization,
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            TTL: "86400",
          },
          body,
        });
      } catch {
        // Si se pierde la respuesta tras invocar al servicio push, el aviso
        // pudo haberse entregado y no se reintenta automáticamente.
        return { status: "failed", errorCode: "delivery_uncertain" };
      }
      if (response.status >= 300 && response.status < 400) {
        return { status: "failed", errorCode: "invalid_destination" };
      }
      if (response.ok) return { status: "sent" };
      if (response.status === 404 || response.status === 410) return { status: "expired" };
      if (response.status === 401 || response.status === 403) {
        return { status: "failed", errorCode: "not_authorized" };
      }
      if (response.status === 400) return { status: "failed", errorCode: "invalid_destination" };
      return { status: "failed", errorCode: "provider_unavailable" };
    },
  };
}
