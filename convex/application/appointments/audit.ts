import {
  toAppointmentAuditEvent,
  type AppointmentAuditEvent,
} from "../../domain/appointments/audit";

/**
 * Puerto de auditoría de cambios de agenda (TI2-128).
 *
 * Capa de Aplicación: los casos de uso de reserva, cancelación,
 * reagendamiento y registro de atención llaman a este puerto después de
 * persistir el cambio, dentro de la misma mutation que arma Presentación.
 * Así el cambio y su evento se confirman o se descartan juntos: si la
 * escritura del evento falla, la mutation aborta y el cambio tampoco queda.
 *
 * Solo se audita el éxito. Una denegación o un conflicto se deciden antes de
 * cualquier escritura y Presentación los lanza como error, lo que aborta la
 * mutation; un evento escrito en esa transacción se perdería con el rollback,
 * así que no se promete. La denegación queda garantizada por no escribir
 * nada y por responder el error genérico; si en el futuro se exige
 * conservarla, debe registrarse en una función interna propia, en otra
 * transacción coordinada desde una acción, nunca en la que aborta.
 *
 * Las lecturas (`query`) no escriben en Convex, así que el acceso de lectura
 * no se audita desde una consulta. Esa auditoría, si se pide, sigue la misma
 * vía interna coordinada. No hay entrada pública para leer, editar ni borrar
 * la bitácora.
 *
 * Opera con datos ficticios.
 */
export interface AppointmentAuditRecorder {
  recordAppointmentAudit(event: AppointmentAuditEvent): Promise<void>;
}

/** Construye el evento con la forma del dominio y lo entrega al puerto. */
export async function auditAppointmentChange(
  recorder: AppointmentAuditRecorder,
  event: AppointmentAuditEvent,
): Promise<void> {
  await recorder.recordAppointmentAudit(toAppointmentAuditEvent(event));
}
