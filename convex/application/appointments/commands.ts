import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import {
  transitionAppointment,
  type AppointmentStatus,
} from "../../domain/appointments/appointment";
import { conflictError, errResult, okResult, type ApiResult } from "../../domain/errors/api_error";
import {
  getAppointmentById,
  normalizeAppointmentId,
  persistAppointmentTransition,
} from "../../infrastructure/appointments/repository";

/**
 * Caso de uso de cambio de estado de la atención (TI2-107).
 *
 * Capa de Aplicación: aplica la política de transiciones de TI2-93
 * (`transitionAppointment`) sobre la fila vigente y persiste su resultado,
 * sin que el llamante diga qué campos cuadrar. Es la única vía de escritura
 * del estado y del motivo de cancelación (`persistAppointmentTransition` en
 * Infraestructura); `occupySlotAtomically` sigue siendo la única vía de
 * escritura de horario y recursos.
 *
 * Los rechazos de la política son de dos formas: transición no permitida,
 * sin actor o con datos inválidos, y cancelación de CERETI sin motivo.
 * Todos responden el código estable `conflict` (TI2-88), porque son
 * conflicto con el estado actual y no dicen por qué falló la regla; la
 * atención inexistente responde el mismo `conflict` para no revelar
 * existencia. El reagendamiento con fecha nueva no pasa por acá: es el caso
 * de uso de cambio de TI2-109, que compone la política con
 * `occupySlotAtomically` y le entrega la fecha original y el estado (así lo
 * prueban los tests de TI2-107 a nivel de repositorio); sin fecha nueva la
 * política la rechaza y acá responde el mismo `conflict`. `actorId` llega
 * resuelto de la sesión autenticada en el borde de Presentación cuando la
 * operación adquiera una función pública; hoy ninguna función pública la
 * expone y solo se ejercita en pruebas. Opera con datos ficticios.
 */

/** Entrada del cambio de estado, con la fila destino ya leída por Infraestructura. */
export interface ApplyAppointmentTransitionInput {
  /** Atención a cambiar, como cadena validable sin revelar existencia. */
  readonly appointmentId: string;
  /** Estado destino: la política valida que la transición exista. */
  readonly to: AppointmentStatus;
  /** Actor de la sesión autenticada; el dominio lo exige y desprende. */
  readonly actorId: string;
  /** Instante epoch del registro, en milisegundos. */
  readonly occurredAt: number;
  /** Motivo: obligatorio solo para la cancelación de CERETI. */
  readonly reason?: string;
}

/** Éxito del cambio de estado: la atención persistida, con identificador Convex. */
export interface ApplyAppointmentTransitionSuccess {
  readonly appointmentId: Id<"appointments">;
}

/** Resultado estable del cambio de estado según TI2-88. */
export type ApplyAppointmentTransitionResult = ApiResult<ApplyAppointmentTransitionSuccess>;

/**
 * Aplica la política de TI2-93 sobre la atención y persiste su resultado:
 * estado, `cancelReason` y `originalStartsAt` que la política produjo. La
 * fecha original ya conservada vuelve intacta en los cambios que no
 * reagendan, así el historial no se pierde aunque la fila cambie de estado.
 */
export async function applyAppointmentTransition(
  ctx: MutationCtx,
  input: ApplyAppointmentTransitionInput,
): Promise<ApplyAppointmentTransitionResult> {
  const appointmentId = normalizeAppointmentId(ctx, input.appointmentId);
  if (appointmentId === null) {
    return errResult(conflictError());
  }
  const row = await getAppointmentById(ctx, appointmentId);
  if (row === null) {
    return errResult(conflictError());
  }
  const outcome = transitionAppointment({
    from: row.status,
    to: input.to,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    reason: input.reason,
    currentStartAt: row.startsAt,
    currentOriginalStartAt: row.originalStartsAt,
  });
  if (outcome.status === "rejected") {
    return errResult(conflictError());
  }
  await persistAppointmentTransition(ctx, row._id, {
    status: outcome.change.to,
    cancelReason: outcome.cancelReason,
    originalStartsAt: outcome.originalStartAt,
  });
  return okResult({ appointmentId: row._id });
}
