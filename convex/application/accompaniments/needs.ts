import { toLegacyAccessNeeds } from "../../domain/requests/request";
import { conflictError, errResult, okResult, type ApiResult } from "../../domain/errors/api_error";
import {
  authorizeAccompanimentNeedsUpdate,
  type AuthorizationReader,
} from "../authorization/authorize";
import {
  isAppointmentStillBookable,
  notifyNeedsImpact,
  type ImpactedAppointmentInput,
} from "../appointments/impact";
import type { AvailabilityReader, CompatibilitySpaceSource } from "../availability/ports";
import type { NotificationEventRecorder } from "../notifications/ports";

/**
 * Actualización versionada de necesidades de acceso (TI2-156).
 *
 * Versiona en `accompanimentNeeds` (NECESIDADES_ACCESO del MER): cierra la
 * vigente con `validUntil` y crea la nueva con `validFrom`. Las atenciones
 * anteriores se evalúan con la versión vigente a su fecha, así no se pierde
 * lo registrado antes. Compara antes/después y avisa solo lo que pasa de
 * compatible a incompatible.
 */

export interface AccompanimentNeedsWriter {
  saveVersionedAccessNeeds(
    accompanimentId: string,
    accessNeeds: string,
    actorId: string,
    now: number,
  ): Promise<void>;
}

export interface NeedsUpdateImpactDeps {
  readonly future: {
    listFutureByAccompaniment(
      accompanimentId: string,
      now: number,
    ): Promise<{
      readonly complete: boolean;
      readonly appointments: readonly ImpactedAppointmentInput[];
    }>;
  };
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
  readonly notifications: NotificationEventRecorder;
  readonly now?: () => number;
}

function conflict<T>(): ApiResult<T> {
  return errResult(conflictError());
}

export async function updateAccompanimentNeeds(
  auth: AuthorizationReader,
  store: AccompanimentNeedsWriter,
  input: {
    readonly tokenIdentifier: string | null;
    readonly accompanimentId: string;
    readonly accessNeeds: string;
  },
  impact: NeedsUpdateImpactDeps,
): Promise<ApiResult<null>> {
  const grant = await authorizeAccompanimentNeedsUpdate(auth, {
    tokenIdentifier: input.tokenIdentifier,
    accompanimentId: input.accompanimentId,
  });
  if (grant.status === "error") return grant;
  const validated = toLegacyAccessNeeds(input.accessNeeds);
  if (validated.status === "error") {
    return errResult(validated.error);
  }
  const now = impact.now === undefined ? Date.now() : impact.now();
  const future = await impact.future.listFutureByAccompaniment(input.accompanimentId, now);
  if (!future.complete) return conflict();
  const slotDeps = {
    auth,
    availability: impact.availability,
    needs: impact.needs,
    compatibility: impact.compatibility,
  };
  const beforeById = new Map<string, boolean>();
  for (const appointment of future.appointments) {
    const before = await isAppointmentStillBookable(slotDeps, appointment);
    if (before.status === "error") return errResult(before.error);
    beforeById.set(appointment.id, before.data);
  }
  await store.saveVersionedAccessNeeds(
    input.accompanimentId,
    validated.data,
    grant.data.callerId,
    now,
  );
  const afterById = new Map<string, boolean>();
  for (const appointment of future.appointments) {
    const after = await isAppointmentStillBookable(slotDeps, appointment);
    if (after.status === "error") return errResult(after.error);
    afterById.set(appointment.id, after.data);
  }
  const newly = future.appointments.filter(
    (appointment) =>
      beforeById.get(appointment.id) === true && afterById.get(appointment.id) === false,
  );
  await notifyNeedsImpact(impact.notifications, newly, { occurredAt: now });
  return okResult(null);
}
