/**
 * Registro del service worker y suscripción Web Push del navegador (TI2-160).
 *
 * Capa de Infraestructura Web: encapsula `navigator.serviceWorker`,
 * `PushManager` y `Notification` para que la bandeja de avisos (TI2-172)
 * active o desactive notificaciones opcionales sin depender de detalles del
 * navegador ni exponer claves privadas.
 */

export const PUSH_SERVICE_WORKER_PATH = "/push-sw.js";

/** Datos mínimos que se envían al backend al activar una suscripción propia. */
export interface BrowserPushSubscriptionPayload {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly expirationTime?: number;
}

export type BrowserPushSubscribeResult =
  | { readonly status: "subscribed"; readonly subscription: BrowserPushSubscriptionPayload }
  | { readonly status: "unsupported" }
  | { readonly status: "permission_denied" }
  | { readonly status: "invalid_subscription" };

/** Convierte una clave pública VAPID base64url en el buffer que espera `PushManager`. */
export function vapidPublicKeyToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const normalized = base64Url.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Extrae endpoint y claves públicas (`p256dh`, `auth`) de una `PushSubscription` del navegador. */
export function extractPushSubscriptionPayload(
  subscription: Pick<PushSubscription, "endpoint" | "expirationTime" | "getKey">,
): BrowserPushSubscriptionPayload | null {
  const endpoint = subscription.endpoint.trim();
  const p256dhBuffer = subscription.getKey("p256dh");
  const authBuffer = subscription.getKey("auth");
  if (endpoint === "" || p256dhBuffer === null || authBuffer === null) return null;
  const p256dh = bufferToBase64Url(p256dhBuffer);
  const auth = bufferToBase64Url(authBuffer);
  if (p256dh === "" || auth === "") return null;
  return {
    endpoint,
    p256dh,
    auth,
    ...(typeof subscription.expirationTime === "number" && subscription.expirationTime > 0
      ? { expirationTime: subscription.expirationTime }
      : {}),
  };
}

/** Verdadero cuando el navegador actual soporta Service Worker, PushManager y Notification. */
export function isWebPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Registra (o reutiliza) el service worker de avisos push. */
export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isWebPushSupported()) return null;
  const registration = await navigator.serviceWorker.register(PUSH_SERVICE_WORKER_PATH);
  await navigator.serviceWorker.ready;
  return registration;
}

/**
 * Solicita permiso de notificaciones al navegador, registra el service worker
 * y devuelve la suscripción lista para guardar en Convex.
 */
export async function subscribeBrowserPush(
  vapidPublicKey: string,
): Promise<BrowserPushSubscribeResult> {
  if (!isWebPushSupported()) return { status: "unsupported" };
  const permission =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return { status: "permission_denied" };

  const registration = await registerPushServiceWorker();
  if (registration === null) return { status: "unsupported" };

  const existing = await registration.pushManager.getSubscription();
  const active =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidPublicKeyToUint8Array(vapidPublicKey),
    }));

  const payload = extractPushSubscriptionPayload(active);
  if (payload === null) return { status: "invalid_subscription" };
  return { status: "subscribed", subscription: payload };
}

/**
 * Cancela la suscripción push del navegador actual y devuelve su endpoint
 * para que el backend también la elimine.
 */
export async function unsubscribeBrowserPush(): Promise<string | null> {
  if (!isWebPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration(PUSH_SERVICE_WORKER_PATH);
  if (registration === undefined) return null;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription === null) return null;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}

/** Devuelve el endpoint suscrito actualmente en este navegador, o `null`. */
export async function readBrowserPushEndpoint(): Promise<string | null> {
  if (!isWebPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration(PUSH_SERVICE_WORKER_PATH);
  if (registration === undefined) return null;
  const subscription = await registration.pushManager.getSubscription();
  return subscription?.endpoint ?? null;
}
