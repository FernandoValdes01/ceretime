import { AGENDA_TIME_ZONE, expandAvailabilitySlots } from "../../domain/availability/availability";
import { slotsCoverInterval } from "../../domain/availability/availability";
import { civilDateOfInstant } from "../../domain/calendar/civil_days";
import {
  notificationEventsForAvailabilityChange,
  notificationEventsForNeedsUpdated,
  notificationEventsForSpaceChange,
  type NotificationEvent,
} from "../../domain/notifications/notification";
import { assessCompatibility } from "../../domain/spaces/compatibility";
import { isBookableProfessional } from "../authorization/authorize";
import type { AvailabilityReader, CompatibilitySpaceSource } from "../availability/ports";
import type { AuthorizationReader } from "../authorization/authorize";
import type { NotificationEventRecorder } from "../notifications/ports";
import type { ApiResult } from "../../domain/errors/api_error";
import { conflictError, noAvailabilityError } from "../../domain/errors/api_error";

/**
 * Impacto de un cambio de configuración sobre atenciones futuras (TI2-156).
 *
 * Compara antes y después en la misma mutación y avisa solo lo que pasa de
 * reservable a no reservable. Usa cobertura de ventana (`slotsCoverInterval`,
 * que admite varias duraciones) y revisa a cada adicional (TI2-142). No
 * importa casos de uso para no ciclar con `availability`/`booking`.
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

/** Entrada mínima para evaluar si una atención sigue reservable (sin estudiante). */
export interface EvaluationAppointmentInput {
  readonly id: string;
  readonly accompanimentId: string;
  readonly professionalId: string;
  readonly modality: "inPerson" | "online";
  readonly spaceId?: string;
  readonly startAt: number;
  readonly endAt: number;
  readonly additionalProfessionalIds?: readonly string[];
}

export interface BookabilityDeps {
  readonly auth: AuthorizationReader;
  readonly availability: AvailabilityReader;
  readonly needs: {
    findNeedsAt(
      accompanimentId: string,
      at: number,
    ): Promise<{
      readonly _id: string;
      readonly needs: readonly { readonly id: string; readonly label: string }[];
    } | null>;
  };
  readonly compatibility: CompatibilitySpaceSource;
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

async function coversProfessional(
  deps: BookabilityDeps,
  professionalId: string,
  appointment: EvaluationAppointmentInput,
): Promise<ApiResult<boolean>> {
  const date = civilDateOfInstant(appointment.startAt, AGENDA_TIME_ZONE);
  const [blocksResult, exceptionsResult] = await Promise.all([
    deps.availability.listActiveBlocks(professionalId),
    deps.availability.listExceptions({ professionalId, from: date, to: date }),
  ]);
  if (blocksResult.status === "error" || exceptionsResult.status === "error") {
    return { status: "error", error: conflictError() };
  }
  let expanded;
  try {
    expanded = expandAvailabilitySlots({
      professionalId,
      blocks: [...blocksResult.data],
      exceptions: [...exceptionsResult.data],
      from: date,
      to: date,
      timeZone: AGENDA_TIME_ZONE,
    });
  } catch {
    return { status: "error", error: conflictError() };
  }
  const sameModalityAndSpace = expanded.filter(
    (slot) =>
      slot.modality === appointment.modality &&
      (appointment.modality !== "inPerson" || slot.spaceId === appointment.spaceId),
  );
  const covered = slotsCoverInterval(sameModalityAndSpace, {
    startAt: appointment.startAt,
    endAt: appointment.endAt,
  });
  return covered
    ? ({ status: "ok", data: true } as const)
    : ({ status: "error", error: noAvailabilityError() } as const);
}

async function checkCompatibility(
  deps: BookabilityDeps,
  appointment: EvaluationAppointmentInput,
): Promise<ApiResult<boolean>> {
  const needsEntry = await deps.needs.findNeedsAt(appointment.accompanimentId, appointment.startAt);
  if (needsEntry === null) return { status: "error", error: conflictError() };
  if (appointment.modality === "online") {
    const supports = await deps.compatibility.listOnlineSupports();
    const decision = assessCompatibility(needsEntry.needs, {
      modality: "online",
      onlineSupports: supports,
    });
    return decision.compatible
      ? ({ status: "ok", data: true } as const)
      : ({ status: "error", error: noAvailabilityError() } as const);
  }
  if (appointment.spaceId === undefined) {
    return { status: "error", error: noAvailabilityError() };
  }
  const space = await deps.compatibility.findCompatibilitySpace(appointment.spaceId);
  if (space === null) return { status: "error", error: noAvailabilityError() };
  const decision = assessCompatibility(needsEntry.needs, { modality: "inPerson", space });
  return decision.compatible
    ? ({ status: "ok", data: true } as const)
    : ({ status: "error", error: noAvailabilityError() } as const);
}

/**
 * Verdadero cuando la atención sigue reservable: responsable reservable y
 * cubierto, compatible y cada adicional reservable y cubierto. `conflict`
 * cuando una lectura se trunca; `no_availability` cuando no cubre o no es
 * compatible (se traduce a `false` para decidir el aviso).
 */
export async function isAppointmentStillBookable(
  deps: BookabilityDeps,
  appointment: EvaluationAppointmentInput,
): Promise<ApiResult<boolean>> {
  if (
    !(await isBookableProfessional(deps.auth, {
      accompanimentId: appointment.accompanimentId,
      professionalId: appointment.professionalId,
    }))
  ) {
    return { status: "ok", data: false } as const;
  }
  const covered = await coversProfessional(deps, appointment.professionalId, appointment);
  if (covered.status === "error") {
    return covered.error.code === "conflict" ? covered : ({ status: "ok", data: false } as const);
  }
  const compatible = await checkCompatibility(deps, appointment);
  if (compatible.status === "error") {
    return compatible.error.code === "conflict"
      ? compatible
      : ({ status: "ok", data: false } as const);
  }
  for (const additionalId of appointment.additionalProfessionalIds ?? []) {
    if (
      !(await isBookableProfessional(deps.auth, {
        accompanimentId: appointment.accompanimentId,
        professionalId: additionalId,
      }))
    ) {
      return { status: "ok", data: false } as const;
    }
    const additionalCovered = await coversProfessional(deps, additionalId, appointment);
    if (additionalCovered.status === "error") {
      return additionalCovered.error.code === "conflict"
        ? additionalCovered
        : ({ status: "ok", data: false } as const);
    }
  }
  return { status: "ok", data: true } as const;
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
