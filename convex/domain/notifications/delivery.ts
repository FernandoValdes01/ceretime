/**
 * Entrega de avisos por canal (TI2-145).
 *
 * Dominio puro: no importa Convex ni proveedores. Un aviso persistido puede
 * intentarse por correo o push, y cada canal guarda su propio resultado e
 * intentos. Los reintentos actualizan esa entrega: no crean otro aviso ni otra
 * fila por canal. Los códigos de error son estables y genéricos; nunca
 * contienen cuerpos, encabezados ni credenciales del proveedor.
 *
 * El envío real es TI2-159 (correo) y TI2-160 (push); esta forma solo fija lo
 * que la persistencia de TI2-145 necesita distinguir.
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
 * Códigos públicos del fallo de entrega, sin detalles del proveedor. El
 * despacho puede reintentar cualquiera; solo distinguen por qué no se envió.
 */
export const NOTIFICATION_DELIVERY_ERROR_VALUES = [
  "not_configured",
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
