import { AGENDA_TIME_ZONE } from "../../domain/availability/availability";
import {
  notificationEventsForAvailabilityChange,
  notificationEventsForNeedsUpdated,
  notificationEventsForSpaceChange,
  type NotificationEvent,
} from "../../domain/notifications/notification";
import { resolveBookableSlot, type SlotSelectionDeps } from "./booking";
import type { NotificationEventRecorder } from "../notifications/ports";

/**
 * Impacto de un cambio de configuración sobre atenciones futuras (TI2-156).
 *
 * Capa de Aplicación: detecta atenciones confirmadas que dejan de ser
 * reservables tras cambiar disponibilidad, sala o necesidades, sin borrarlas
 * ni cancelarlas en silencio. Reutiliza `resolveBookableSlot` (la misma
 * revalidación de reserva y reagendamiento), así lo que cuenta como afectado
 * es exactamente lo que la reserva rechazaría con `no_availability`.
 *
 * Solo futuras vigentes: quien llama ya filtró por `startsAt` posterior al
 * instante del cambio y estado que admite calendario (`scheduled`/`rescheduled`).
 * Las anteriores no cambian y nunca se escriben.
 */

export interface ImpactedAppointmentInput {
  readonly id: string;
  readonly accompanimentId: string;
  readonly professionalId: string;
  readonly modality: "inPerson" | "online";
  readonly spaceId?: string;
  readonly startAt: number;
  readonly endAt: number;
  readonly studentId: string;
  readonly additionalProfessionalIds?: readonly string[];
}

function toSubject(appointment: ImpactedAppointmentInput) {
  return {
    appointmentId: appointment.id,
    studentId: appointment.studentId,
    professionalId: appointment.professionalId,
    ...(appointment.additionalProfessionalIds === undefined
      ? {}
      : { additionalProfessionalIds: appointment.additionalProfessionalIds }),
  };
}

/**
 * Filtra las futuras que ya no son reservables con la configuración vigente.
 *
 * Revalida cada atención con su propio cupo actual. Un `ok` conserva la
 * compatibilidad y no se avisa; un error (`no_availability` o `conflict`)
 * marca la atención como afectada. Nunca lanza: un fallo de lectura cuenta
 * como afectada para no dejarla en silencio.
 */
export async function findAffectedAppointments(
  deps: SlotSelectionDeps,
  appointments: readonly ImpactedAppointmentInput[],
): Promise<ImpactedAppointmentInput[]> {
  const affected: ImpactedAppointmentInput[] = [];
  for (const appointment of appointments) {
    try {
      const slot = await resolveBookableSlot(deps, {
        accompanimentId: appointment.accompanimentId,
        professionalId: appointment.professionalId,
        modality: appointment.modality,
        ...(appointment.spaceId === undefined ? {} : { spaceId: appointment.spaceId }),
        startAt: appointment.startAt,
        endAt: appointment.endAt,
        timeZone: AGENDA_TIME_ZONE,
      });
      if (slot.status === "error") {
        affected.push(appointment);
      }
    } catch {
      affected.push(appointment);
    }
  }
  return affected;
}

/** Registra un aviso de cambio de disponibilidad por cada afectada. */
export async function notifyAvailabilityImpact(
  notifications: NotificationEventRecorder,
  appointments: readonly ImpactedAppointmentInput[],
  input: { readonly actorId: string; readonly occurredAt: number },
): Promise<void> {
  const events: NotificationEvent[] = [];
  for (const appointment of appointments) {
    events.push(
      ...notificationEventsForAvailabilityChange(
        toSubject(appointment),
        input.occurredAt,
        input.actorId,
      ),
    );
  }
  if (events.length > 0) {
    await notifications.record(events);
  }
}

/** Registra un aviso de cambio de sala por cada afectada. */
export async function notifySpaceImpact(
  notifications: NotificationEventRecorder,
  appointments: readonly ImpactedAppointmentInput[],
  input: { readonly actorId: string; readonly occurredAt: number },
): Promise<void> {
  const events: NotificationEvent[] = [];
  for (const appointment of appointments) {
    events.push(
      ...notificationEventsForSpaceChange(toSubject(appointment), input.occurredAt, input.actorId),
    );
  }
  if (events.length > 0) {
    await notifications.record(events);
  }
}

/** Registra un aviso de necesidades actualizadas por cada afectada. */
export async function notifyNeedsImpact(
  notifications: NotificationEventRecorder,
  appointments: readonly ImpactedAppointmentInput[],
  input: { readonly occurredAt: number },
): Promise<void> {
  const events: NotificationEvent[] = [];
  for (const appointment of appointments) {
    events.push(...notificationEventsForNeedsUpdated(toSubject(appointment), input.occurredAt));
  }
  if (events.length > 0) {
    await notifications.record(events);
  }
}
