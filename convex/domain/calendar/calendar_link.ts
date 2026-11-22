/**
 * Vínculo con Google Calendar y estado de sincronización por atención
 * (TI2-145).
 *
 * Dominio puro: no importa Convex ni el SDK de Google. «Conectado» tiene una
 * sola fuente: los alcances OAuth que Better Auth conserva para la cuenta de
 * Google. Este contrato no modela un estado de vínculo paralelo; solo los
 * metadatos locales que Better Auth no tiene (`linkedAt` y `revokedAt`) y el
 * estado del evento de una atención concreta (`pending`, `synced` o `error`).
 *
 * Las credenciales OAuth no se modelan acá. Viven cifradas en el componente de
 * autenticación de Better Auth y la persistencia solo guarda una referencia
 * opaca a esa cuenta, nunca el token. Los códigos de error reutilizan los
 * motivos genéricos del respaldo `.ics` para no inventar un segundo
 * vocabulario ni filtrar respuestas del proveedor.
 */

import {
  CALENDAR_EVENT_FALLBACK_REASON_VALUES,
  type CalendarEventFallbackReason,
} from "./calendar_event";

/**
 * Estado del evento de una atención en Calendar.
 *
 * `pending` significa que la atención todavía no tiene un evento confirmado;
 * `synced`, que el evento refleja su horario vigente; `error`, que el último
 * intento falló y queda el código para decidir si se reintenta o se pide
 * volver a vincular la cuenta.
 */
export const CALENDAR_SYNC_STATUS_VALUES = ["pending", "synced", "error"] as const;

export type CalendarSyncStatus = (typeof CALENDAR_SYNC_STATUS_VALUES)[number];

/** Verdadero cuando el valor es un estado de sincronización conocido. */
export function isCalendarSyncStatus(value: string): value is CalendarSyncStatus {
  return (CALENDAR_SYNC_STATUS_VALUES as readonly string[]).includes(value);
}

/**
 * Códigos del fallo de sincronización. Son los mismos motivos genéricos del
 * respaldo `.ics`: `not_connected` pide volver a vincular y `unavailable`
 * permite reintentar sin exponer detalles del proveedor.
 */
export type CalendarSyncErrorCode = CalendarEventFallbackReason;

export const CALENDAR_SYNC_ERROR_CODE_VALUES = CALENDAR_EVENT_FALLBACK_REASON_VALUES;

/** Verdadero cuando el valor es un código de error de sincronización conocido. */
export function isCalendarSyncErrorCode(value: string): value is CalendarSyncErrorCode {
  return (CALENDAR_EVENT_FALLBACK_REASON_VALUES as readonly string[]).includes(value);
}

/**
 * Metadatos locales del vínculo, sin estado ni credenciales.
 *
 * No expresan si la cuenta sigue conectada: eso lo deciden los alcances de
 * Better Auth. `revokedAt` conserva el instante en que se desconectó
 * localmente para la sincronización de TI2-161.
 */
export interface CalendarConnectionMetadata {
  readonly linkedAt: number;
  readonly revokedAt?: number;
}

/**
 * Estado persistido de la sincronización de una atención.
 *
 * `attempts` acumula intentos; no es un historial. Las atenciones anteriores a
 * TI2-145 no tienen estado y se leen con `calendarSyncStateOf` como `null`, no
 * como pendientes inventadas.
 */
export interface CalendarSyncState {
  readonly status: CalendarSyncStatus;
  readonly attempts: number;
  readonly lastAttemptAt?: number;
  readonly errorCode?: CalendarSyncErrorCode;
}

/** Estado inicial de una atención que todavía no tiene evento confirmado. */
export function initialCalendarSyncState(): CalendarSyncState {
  return { status: "pending", attempts: 0 };
}

/**
 * Reconstruye el estado de sincronización desde los campos de la atención.
 * Devuelve `null` cuando la fila es anterior a TI2-145 y nunca declaró estado.
 */
export function calendarSyncStateOf(input: {
  readonly calendarSyncStatus?: CalendarSyncStatus;
  readonly calendarSyncAttempts?: number;
  readonly calendarSyncLastAttemptAt?: number;
  readonly calendarSyncErrorCode?: CalendarSyncErrorCode;
}): CalendarSyncState | null {
  if (input.calendarSyncStatus === undefined) return null;
  return {
    status: input.calendarSyncStatus,
    attempts: input.calendarSyncAttempts ?? 0,
    ...(input.calendarSyncLastAttemptAt === undefined
      ? {}
      : { lastAttemptAt: input.calendarSyncLastAttemptAt }),
    ...(input.calendarSyncErrorCode === undefined
      ? {}
      : { errorCode: input.calendarSyncErrorCode }),
  };
}
