/**
 * Reglas de suscripciones Web Push (TI2-160).
 *
 * Dominio puro: no importa Convex ni clientes HTTP. Define el tope de
 * suscripciones activas por persona y los proveedores Web Push admitidos para
 * que el registro y el remitente compartan exactamente la misma fuente de
 * verdad y no se envíen solicitudes firmadas con VAPID a orígenes arbitrarios.
 */

/** Máximo de suscripciones Web Push activas por persona. */
export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 20;

const ALLOWED_WEB_PUSH_EXACT_HOSTS: ReadonlySet<string> = new Set([
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
]);

const ALLOWED_WEB_PUSH_HOST_SUFFIXES = [
  ".push.apple.com",
  ".notify.windows.com",
  ".push.services.mozilla.com",
] as const;

function isAllowedWebPushHostname(hostname: string): boolean {
  if (ALLOWED_WEB_PUSH_EXACT_HOSTS.has(hostname)) return true;
  return ALLOWED_WEB_PUSH_HOST_SUFFIXES.some(
    (suffix) => hostname.endsWith(suffix) && hostname.length > suffix.length,
  );
}

/**
 * Devuelve el origen (`https://host`) de un endpoint Web Push cuando usa HTTPS
 * en el puerto estándar, no incluye credenciales y pertenece a un proveedor
 * push admitido; en cualquier otro caso devuelve `null`.
 */
export function parseAllowedWebPushEndpointOrigin(endpoint: string): string | null {
  const trimmed = endpoint.trim();
  if (trimmed === "") return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    if (url.username !== "" || url.password !== "") return null;
    if (url.port !== "") return null;
    const hostname = url.hostname.toLowerCase();
    if (!isAllowedWebPushHostname(hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Verdadero cuando el endpoint apunta a un proveedor Web Push admitido. */
export function isAllowedWebPushEndpoint(endpoint: string): boolean {
  return parseAllowedWebPushEndpointOrigin(endpoint) !== null;
}
