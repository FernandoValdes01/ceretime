import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Tareas periódicas del backend (TI2-159).
 *
 * El barrido de reintentos vuelve a programar entregas por correo cuyo
 * próximo intento ya venció (falla temporal del proveedor, falta de
 * configuración o autorización vencida del remitente). Una entrega ya enviada
 * o reservada por otro despacho no se repite.
 */
const crons = cronJobs();

crons.interval(
  "retry due notification deliveries",
  { minutes: 5 },
  internal.operations.notifications.scheduleDueNotificationDeliveries,
  {},
);

export default crons;
