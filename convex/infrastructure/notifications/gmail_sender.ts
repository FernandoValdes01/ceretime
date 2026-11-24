/**
 * Remitente de correo con la API de Gmail (TI2-159).
 *
 * Capa de Infraestructura: único lugar que habla con Gmail y con el token de
 * actualización del remitente. Cumple por forma el puerto `EmailSender` de
 * Aplicación; cambiar de remitente o de proveedor es reemplazar este
 * adaptador en la composición, sin tocar el despacho.
 *
 * El remitente es una cuenta institucional autorizada con OAuth solo para
 * `gmail.send` en el proyecto de Google Cloud de CERETIME. El token vive en
 * las variables de entorno de Convex: no se registra, no se guarda en la base
 * ni se devuelve. Las respuestas del proveedor se traducen a códigos estables
 * sin cuerpos ni encabezados. Un token vencido o revocado responde
 * `not_authorized` y el aviso espera a que se vuelva a autorizar.
 */

import type { NotificationDeliveryError } from "../../domain/notifications/delivery";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

/** Credenciales y destinos habilitados, leídos solo de variables de entorno. */
export interface GmailSenderConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly senderAddress: string;
  /**
   * Destinos de prueba habilitados, en minúsculas. Ausente habilita todos los
   * destinos; presente, un correo fuera de la lista no sale y queda como
   * `invalid_destination`, así una cuenta ficticia no recibe correos reales.
   */
  readonly allowedRecipients?: readonly string[];
}

/** Variables de entorno que configuran el remitente; todas opcionales salvo el cliente OAuth. */
export interface GmailSenderEnv {
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
  readonly GMAIL_SENDER_ADDRESS?: string;
  readonly GMAIL_SENDER_REFRESH_TOKEN?: string;
  readonly EMAIL_ALLOWED_RECIPIENTS?: string;
  readonly TEST_SEEDS_ENABLED?: string;
}

/**
 * Configuración del remitente, o `null` si falta alguna credencial. Sin
 * remitente configurado el despacho registra `not_configured` y reintenta
 * después, sin perder el aviso. Con `TEST_SEEDS_ENABLED === "true"`, exige
 * `EMAIL_ALLOWED_RECIPIENTS` explícito para evitar envíos a cuentas ficticias.
 */
export function gmailSenderConfigFromEnv(env: GmailSenderEnv): GmailSenderConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  const refreshToken = env.GMAIL_SENDER_REFRESH_TOKEN?.trim() ?? "";
  const senderAddress = env.GMAIL_SENDER_ADDRESS?.trim() ?? "";
  if (clientId === "" || clientSecret === "" || refreshToken === "" || senderAddress === "") {
    return null;
  }
  const allowed = env.EMAIL_ALLOWED_RECIPIENTS?.trim() ?? "";
  const allowedRecipients =
    allowed !== ""
      ? allowed
          .split(",")
          .map((address) => address.trim().toLowerCase())
          .filter((address) => address !== "")
      : env.TEST_SEEDS_ENABLED === "true"
        ? []
        : undefined;
  return {
    clientId,
    clientSecret,
    refreshToken,
    senderAddress,
    ...(allowedRecipients === undefined ? {} : { allowedRecipients }),
  };
}

/** Mensaje y resultado, estructuralmente iguales al puerto de Aplicación. */
interface GmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

type GmailSendResult =
  | { readonly status: "sent" }
  | { readonly status: "failed"; readonly errorCode: NotificationDeliveryError };

/** Dirección simple y sin saltos de línea: impide inyectar encabezados. */
const EMAIL_ADDRESS_PATTERN = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

function isValidAddress(address: string): boolean {
  return EMAIL_ADDRESS_PATTERN.test(address);
}

function base64FromUtf8(value: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Url(value: string): string {
  return base64FromUtf8(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Correo RFC 5322 de texto plano. El asunto va codificado (RFC 2047) para
 * conservar tildes; el cuerpo, en base64. Sin nombre visible del remitente:
 * el encabezado `From` no menciona CERETI.
 */
export function composeGmailRawMessage(senderAddress: string, message: GmailMessage): string {
  const lines = [
    `From: ${senderAddress}`,
    `To: ${message.to}`,
    `Subject: =?UTF-8?B?${base64FromUtf8(message.subject)}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64FromUtf8(message.text),
  ];
  return base64Url(lines.join("\r\n"));
}

type AccessTokenResult =
  | { readonly status: "ok"; readonly accessToken: string }
  | { readonly status: "failed"; readonly errorCode: NotificationDeliveryError };

/** Canjea el token de actualización por uno de acceso, sin exponer la respuesta. */
async function fetchAccessToken(
  config: GmailSenderConfig,
  fetchImpl: typeof fetch,
): Promise<AccessTokenResult> {
  let response: Response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
  } catch {
    return { status: "failed", errorCode: "provider_unavailable" };
  }
  // 400 `invalid_grant` es el token vencido (7 días en modo de prueba) o
  // revocado; 401 es un cliente OAuth inválido. Ambos se reparan autorizando.
  if (response.status === 400 || response.status === 401) {
    return { status: "failed", errorCode: "not_authorized" };
  }
  if (!response.ok) return { status: "failed", errorCode: "provider_unavailable" };
  try {
    const payload: unknown = await response.json();
    const accessToken =
      typeof payload === "object" && payload !== null
        ? (payload as { readonly access_token?: unknown }).access_token
        : undefined;
    if (typeof accessToken === "string" && accessToken.length > 0) {
      return { status: "ok", accessToken };
    }
  } catch {
    // Sin cuerpo legible no hay token.
  }
  return { status: "failed", errorCode: "provider_unavailable" };
}

/**
 * Puerto `EmailSender` con Gmail. Sin configuración responde
 * `not_configured`; nunca lanza por un fallo del proveedor.
 */
export function gmailEmailSender(
  config: GmailSenderConfig | null,
  fetchImpl: typeof fetch = fetch,
) {
  return {
    send: async (message: GmailMessage): Promise<GmailSendResult> => {
      if (config === null) return { status: "failed", errorCode: "not_configured" };
      const to = message.to.trim();
      if (!isValidAddress(to)) return { status: "failed", errorCode: "invalid_destination" };
      if (
        config.allowedRecipients !== undefined &&
        !config.allowedRecipients.includes(to.toLowerCase())
      ) {
        return { status: "failed", errorCode: "invalid_destination" };
      }

      const token = await fetchAccessToken(config, fetchImpl);
      if (token.status !== "ok") return token;

      let response: Response;
      try {
        response = await fetchImpl(SEND_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            raw: composeGmailRawMessage(config.senderAddress, { ...message, to }),
          }),
        });
      } catch {
        // La petición ya se envió a Gmail y se perdió la respuesta: el mensaje
        // pudo haberse aceptado, así que no se reintenta automáticamente.
        return { status: "failed", errorCode: "delivery_uncertain" };
      }
      if (response.ok) return { status: "sent" };
      if (response.status === 401 || response.status === 403) {
        return { status: "failed", errorCode: "not_authorized" };
      }
      if (response.status === 400) return { status: "failed", errorCode: "invalid_destination" };
      return { status: "failed", errorCode: "provider_unavailable" };
    },
  };
}
