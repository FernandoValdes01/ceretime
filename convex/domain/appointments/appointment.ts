/**
 * Vocabulario persistido de la atención reservada (TI2-83).
 *
 * Dominio puro: no importa Convex ni `convex/_generated`. `appointments` es
 * la única tabla de atención/reserva (no existe otra tabla `reservations`).
 * Los literales son los estados de la especificación vigente (reserva,
 * cambio, cancelación e inasistencia) en snake_case, como los estados de
 * solicitud. Las transiciones son de TI2-93, la justificación de la
 * inasistencia vive en una extensión futura y la conciliación con los
 * contratos públicos se prepara en los repositorios de S2; acá solo hay
 * literales y tipos para derivar los validadores del borde.
 */

/** Estados del ciclo de reserva de una atención, en orden de flujo. */
export const APPOINTMENT_STATUS_VALUES = [
  "scheduled",
  "completed",
  "cancelled_by_student",
  "cancelled_by_cereti",
  "rescheduled",
  "no_show",
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUS_VALUES)[number];

/** Estado inicial de una reserva recién creada. */
export const INITIAL_APPOINTMENT_STATUS: AppointmentStatus = "scheduled";
