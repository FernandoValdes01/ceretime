import { toLegacyAccessNeeds } from "../../domain/requests/request";
import {
  conflictError,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import type { AuthorizationReader } from "../authorization/authorize";
import {
  findAffectedAppointments,
  notifyNeedsImpact,
  type ImpactedAppointmentInput,
} from "../appointments/impact";
import type {
  AccompanimentNeedsReader,
  AvailabilityReader,
  CompatibilitySpaceSource,
} from "../availability/ports";
import type { NotificationEventRecorder } from "../notifications/ports";

/**
 * Actualización de necesidades de acceso del estudiante (TI2-156).
 *
 * Capa de Aplicación: el estudiante dueño actualiza el texto de necesidades
 * de su acompañamiento para atenciones futuras, sin alterar lo registrado
 * antes. Las atenciones anteriores conservan su fila y no se tocan; las
 * futuras que dejan de ser compatibles se avisan a sus profesionales para
 * coordinar una solución, sin cancelarlas en silencio.
 *
 * Solo el estudiante dueño con cuenta vigente, sobre un acompañamiento
 * activo o en pausa. Un acompañamiento cerrado es de solo lectura (TI2-152).
 * Valida con la misma regla de solicitudes (`toLegacyAccessNeeds`): texto
 * recortado, no vacío y dentro del tope, sin truncar.
 */

export interface AccompanimentNeedsWriter {
  saveAccessNeeds(accompanimentId: string, accessNeeds: string): Promise<void>;
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
  readonly needs: AccompanimentNeedsReader;
  readonly compatibility: CompatibilitySpaceSource;
  readonly notifications: NotificationEventRecorder;
  readonly now?: () => number;
}

function denied<T>(): ApiResult<T> {
  return errResult(unauthorizedError());
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
  impact?: NeedsUpdateImpactDeps,
): Promise<ApiResult<null>> {
  if (input.accompanimentId.trim() === "") return denied();
  const profile =
    input.tokenIdentifier === null
      ? null
      : await auth.findProfileByTokenIdentifier(input.tokenIdentifier);
  if (
    profile === null ||
    profile.role !== "student" ||
    profile.institutionalStatus !== "enabled" ||
    profile.accountStatus !== "active"
  ) {
    return denied();
  }
  const accompaniment = await auth.getAccompaniment(input.accompanimentId);
  if (accompaniment === null || accompaniment.studentId !== profile._id) {
    return denied();
  }
  if (accompaniment.status === "closed") {
    return conflict();
  }
  const validated = toLegacyAccessNeeds(input.accessNeeds);
  if (validated.status === "error") {
    return errResult(validated.error);
  }
  await store.saveAccessNeeds(input.accompanimentId, validated.data);

  if (impact === undefined) return okResult(null);
  const now = impact.now === undefined ? Date.now() : impact.now();
  const future = await impact.future.listFutureByAccompaniment(input.accompanimentId, now);
  if (!future.complete) return conflict();
  if (future.appointments.length === 0) return okResult(null);
  const affected = await findAffectedAppointments(
    {
      auth,
      availability: impact.availability,
      needs: impact.needs,
      compatibility: impact.compatibility,
    },
    future.appointments,
  );
  await notifyNeedsImpact(impact.notifications, affected, { occurredAt: now });
  return okResult(null);
}
