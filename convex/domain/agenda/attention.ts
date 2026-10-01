/**
 * Estados de la atención reservada (TI2-83).
 *
 * Dominio puro: no importa Convex ni `convex/_generated`. Los literales se
 * mantienen en snake_case porque son los valores persistidos en la columna
 * `status` de la tabla `attentions`, igual que los estados de solicitud de
 * Sprint 1. Cubre el ciclo de la especificación vigente (reserva, cambio,
 * cancelación e inasistencia); la justificación de la inasistencia y su
 * plazo de cinco días hábiles viven en una extensión futura, no en este
 * esquema.
 */

/** Estados del ciclo de reserva de una atención, en orden de flujo. */
export const ATTENTION_STATUS_VALUES = [
  "scheduled",
  "completed",
  "cancelled_by_student",
  "cancelled_by_cereti",
  "rescheduled",
  "no_show",
] as const;

export type AttentionStatus = (typeof ATTENTION_STATUS_VALUES)[number];

/** Estado inicial de una reserva recién creada. */
export const INITIAL_ATTENTION_STATUS: AttentionStatus = "scheduled";

/** Verdadero cuando el valor es un estado de atención conocido. */
export function isAttentionStatus(value: string): value is AttentionStatus {
  return (ATTENTION_STATUS_VALUES as readonly string[]).includes(value);
}
