import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Tareas periódicas del backend (TI2-159, TI2-162, TI2-147).
 *
 * El barrido de reintentos vuelve a programar entregas por correo cuyo
 * próximo intento ya venció (falla temporal del proveedor, falta de
 * configuración o autorización vencida del remitente). Una entrega ya enviada
 * o reservada por otro despacho no se repite. El segundo barrido reintenta la
 * sincronización con Calendar pendiente o con fallo recuperable
 * (`unavailable`); `not_connected` pide volver a vincular y no se reintenta
 * solo. El tercero cierra las justificaciones de inasistencia vencidas sin
 * depender de que el estudiante abra la aplicación; empieza con `cursor: null`
 * y continúa por lotes hasta que el barrido termina.
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

crons.interval(
  "expire overdue justifications",
  { hours: 1 },
  internal.operations.appointments.expireOverdueJustifications,
  { cursor: null },
);

export default crons;
