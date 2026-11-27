import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Tareas periódicas del backend (TI2-159, TI2-162).
 *
 * El barrido de reintentos vuelve a programar entregas por correo cuyo
 * próximo intento ya venció (falla temporal del proveedor, falta de
 * configuración o autorización vencida del remitente). Una entrega ya enviada
 * o reservada por otro despacho no se repite. El segundo barrido reintenta la
 * sincronización con Calendar pendiente o con fallo recuperable
 * (`unavailable`); `not_connected` pide volver a vincular y no se reintenta
 * solo.
 */
const crons = cronJobs();

crons.interval(
  "retry due notification deliveries",
  { minutes: 5 },
  internal.operations.notifications.scheduleDueNotificationDeliveries,
  {},
);

crons.interval(
  "retry due calendar syncs",
  { minutes: 5 },
  internal.operations.calendar.scheduleDueCalendarSyncs,
  {},
);

export default crons;
