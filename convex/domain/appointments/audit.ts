import type { AppointmentStatus } from "./appointment";

/**
 * Evento mínimo de auditoría de cambios de agenda (TI2-128).
 *
 * Dominio puro: no importa Convex, React ni Expo. Fija la forma append-only
 * de un cambio exitoso de la atención: quién lo hizo (`actorId`, resuelto
 * desde la identidad de la sesión), cuándo (`occurredAt`, reloj del
 * servidor), qué acción, sobre qué atención y con qué resultado (el estado
 * en que quedó). No lleva motivo, nota, necesidades ni nombres: el motivo
 * de cancelación vive solo en `appointments.cancelReason` y no se copia.
 *
 * No reemplaza `requestTransitions`, que guarda el motivo del cambio de una
 * solicitud, ni los eventos de notificación de TI2-105: es la bitácora del
 * cambio de agenda, sin otro contenido.
 */

/** Acciones auditadas sobre la agenda: reservar, cancelar, mover y registrar. */
export const APPOINTMENT_AUDIT_ACTION_VALUES = [
  "booked",
  "cancelled",
  "rescheduled",
  "attendance_recorded",
] as const;

export type AppointmentAuditAction = (typeof APPOINTMENT_AUDIT_ACTION_VALUES)[number];

/**
 * Resultados coherentes con cada acción: la reserva deja `scheduled`, la
 * cancelación una de las dos cancelaciones, el movimiento `rescheduled` y el
 * registro la realización o la inasistencia pendiente.
 */
const RESULTS_BY_ACTION: Readonly<Record<AppointmentAuditAction, readonly AppointmentStatus[]>> = {
  booked: ["scheduled"],
  cancelled: ["cancelled_by_student", "cancelled_by_cereti"],
  rescheduled: ["rescheduled"],
  attendance_recorded: ["completed", "no_show"],
};

/** Evento de auditoría con exactamente cinco campos, todos referencias o literales. */
export interface AppointmentAuditEvent {
  readonly action: AppointmentAuditAction;
  readonly actorId: string;
  readonly appointmentId: string;
  readonly result: AppointmentStatus;
  readonly occurredAt: number;
}

/** Verdadero cuando el valor es una acción auditada conocida. */
export function isAppointmentAuditAction(value: string): value is AppointmentAuditAction {
  return (APPOINTMENT_AUDIT_ACTION_VALUES as readonly string[]).includes(value);
}

/**
 * Construye el evento campo por campo.
 *
 * Un llamante no puede colar texto extra (motivo, nota, nombre): el retorno
 * solo copia los cinco campos del contrato. Una referencia vacía, un
 * instante inválido, una acción desconocida o un resultado que no
 * corresponde a la acción son error, no evento incompleto.
 */
export function toAppointmentAuditEvent(input: AppointmentAuditEvent): AppointmentAuditEvent {
  if (!isAppointmentAuditAction(input.action)) {
    throw new Error("La acción auditada es desconocida.");
  }
  const actorId = input.actorId.trim();
  if (actorId === "") {
    throw new Error("El evento de auditoría requiere un actor.");
  }
  const appointmentId = input.appointmentId.trim();
  if (appointmentId === "") {
    throw new Error("El evento de auditoría requiere una atención.");
  }
  if (!Number.isFinite(input.occurredAt) || input.occurredAt <= 0) {
    throw new Error("El evento de auditoría requiere un instante epoch válido.");
  }
  if (!RESULTS_BY_ACTION[input.action].includes(input.result)) {
    throw new Error("El resultado no corresponde a la acción auditada.");
  }
  return {
    action: input.action,
    actorId,
    appointmentId,
    result: input.result,
    occurredAt: input.occurredAt,
  };
}
