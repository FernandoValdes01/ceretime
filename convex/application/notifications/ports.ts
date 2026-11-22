import type { NotificationEvent } from "../../domain/notifications/notification";

/**
 * Registro de los eventos de aviso que produjo la política de Dominio
 * (TI2-105, TI2-118, TI2-150).
 *
 * Capa de Aplicación: lo usan las solicitudes, la agenda y la justificación
 * después de persistir su cambio, dentro de la misma mutation que arma
 * Presentación. Si el cambio se rechaza, Presentación lanza el error y la
 * mutation descarta también el aviso. Infraestructura lo cumple con
 * `notificationEventRecorder`, que no duplica una clave ya registrada.
 */
export interface NotificationEventRecorder {
  record(events: readonly NotificationEvent[]): Promise<void>;
}
