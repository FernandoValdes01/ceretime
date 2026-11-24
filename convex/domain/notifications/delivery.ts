/**
 * Entrega de avisos por canal (TI2-145, TI2-159).
 *
 * Dominio puro: no importa Convex ni proveedores. Un aviso persistido puede
 * intentarse por correo o push, y cada canal guarda su propio resultado e
 * intentos. Los reintentos actualizan esa entrega: no crean otro aviso ni otra
 * fila por canal. Los códigos de error son estables y genéricos; nunca
 * contienen cuerpos, encabezados ni credenciales del proveedor.
 *
 * TI2-159 agrega la política de reintento del correo (`deliveryRetryAt`); el
 * push es TI2-160.
 */

/** Canales de entrega declarados. */
export const NOTIFICATION_DELIVERY_CHANNEL_VALUES = ["email", "push"] as const;

export type NotificationDeliveryChannel = (typeof NOTIFICATION_DELIVERY_CHANNEL_VALUES)[number];

/** Verdadero cuando el valor es un canal conocido. */
export function isNotificationDeliveryChannel(value: string): value is NotificationDeliveryChannel {
  return (NOTIFICATION_DELIVERY_CHANNEL_VALUES as readonly string[]).includes(value);
}

/**
 * Estado del último intento por canal: pendiente de envío, enviado o fallido.
 * Un fallo conserva su código para que el despacho decida si reintenta.
 */
export const NOTIFICATION_DELIVERY_STATUS_VALUES = ["pending", "sent", "failed"] as const;

export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUS_VALUES)[number];

/** Verdadero cuando el valor es un estado de entrega conocido. */
export function isNotificationDeliveryStatus(value: string): value is NotificationDeliveryStatus {
  return (NOTIFICATION_DELIVERY_STATUS_VALUES as readonly string[]).includes(value);
}

/**
 * Códigos públicos del fallo de entrega, sin detalles del proveedor. Solo
 * distinguen por qué no se envió; `deliveryRetryAt` decide con ellos si el
 * despacho vuelve a intentar. `not_authorized` es la autorización vencida o
 * revocada del remitente (TI2-159): el aviso espera a que se vuelva a
 * autorizar, sin perderse.
 */
export const NOTIFICATION_DELIVERY_ERROR_VALUES = [
  "not_configured",
  "not_authorized",
  "provider_unavailable",
  "invalid_destination",
] as const;

export type NotificationDeliveryError = (typeof NOTIFICATION_DELIVERY_ERROR_VALUES)[number];

/** Verdadero cuando el valor es un código de error de entrega conocido. */
export function isNotificationDeliveryError(value: string): value is NotificationDeliveryError {
  return (NOTIFICATION_DELIVERY_ERROR_VALUES as readonly string[]).includes(value);
}

/**
 * Resultado persistido de un canal: un solo registro por aviso y canal.
 * `attempts` cuenta los intentos acumulados; no es un historial de textos.
 */
export interface NotificationDeliveryState {
  readonly channel: NotificationDeliveryChannel;
  readonly status: NotificationDeliveryStatus;
  readonly attempts: number;
  readonly lastAttemptAt?: number;
  readonly sentAt?: number;
  readonly errorCode?: NotificationDeliveryError;
}

/**
 * Intentos máximos ante un proveedor no disponible. Con la espera creciente
 * de `deliveryRetryAt` cubren cerca de una hora; después la entrega queda
 * fallida con su código y deja de reintentarse sola.
 */
export const MAX_PROVIDER_UNAVAILABLE_ATTEMPTS = 6;

/** Primera espera ante un proveedor no disponible; se duplica en cada intento. */
const PROVIDER_RETRY_BASE_DELAY_MS = 60_000;

/** Tope de la espera creciente ante un proveedor no disponible. */
const PROVIDER_RETRY_MAX_DELAY_MS = 30 * 60_000;

/**
 * Espera entre intentos cuando falta configurar o volver a autorizar al
 * remitente. No tiene tope de intentos: el aviso no se pierde y sale en el
 * primer intento posterior a la nueva autorización.
 */
export const SENDER_SETUP_RETRY_DELAY_MS = 15 * 60_000;

/**
 * Instante desde el que la entrega puede volver a intentarse, o `null` si no
 * se reintenta (TI2-159).
 *
 * Una entrega enviada no se repite. Una pendiente puede intentarse ya. Un
 * destino inválido no mejora al reintentar. La configuración o autorización
 * faltante espera a que el remitente se repare, sin agotar intentos. Un
 * proveedor no disponible espera cada vez el doble, hasta
 * `MAX_PROVIDER_UNAVAILABLE_ATTEMPTS`.
 */
export function deliveryRetryAt(state: NotificationDeliveryState): number | null {
  if (state.status === "sent") return null;
  const lastAttemptAt = state.lastAttemptAt ?? 0;
  if (state.status === "pending") return lastAttemptAt;
  switch (state.errorCode) {
    case "invalid_destination":
      return null;
    case "not_configured":
    case "not_authorized":
      return lastAttemptAt + SENDER_SETUP_RETRY_DELAY_MS;
    case "provider_unavailable":
    case undefined: {
      if (state.attempts >= MAX_PROVIDER_UNAVAILABLE_ATTEMPTS) return null;
      const exponent = Math.max(state.attempts - 1, 0);
      const delay = Math.min(
        PROVIDER_RETRY_BASE_DELAY_MS * 2 ** exponent,
        PROVIDER_RETRY_MAX_DELAY_MS,
      );
      return lastAttemptAt + delay;
    }
  }
}
