import {
  SPACE_CATALOG_CONTRACT_VERSION,
  normalizeSpaceFields,
  toSpaceLabel,
  validateSpaceFields,
  type Space,
  type SpaceFields,
} from "../../domain/spaces/space";
import {
  SPACE_FIELDS_INVALID_ERROR_CODE,
  conflictError,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import { authorizeSpaceCatalogManage, type AuthorizationReader } from "../authorization/authorize";
import {
  isAppointmentStillBookable,
  notifySpaceImpact,
  type ImpactedAppointmentInput,
} from "../appointments/impact";
import type {
  AccompanimentNeedsReader,
  AvailabilityReader,
  CompatibilitySpaceSource,
} from "../availability/ports";
import type { NotificationEventRecorder } from "../notifications/ports";
import type { SpaceReader, SpaceWriter } from "./ports";

/**
 * Casos de uso de gestión del catálogo de espacios (TI2-148).
 *
 * Capa de Aplicación: exige administración con cuenta vigente antes de
 * validar nada, así que un rol sin permiso recibe el mismo error genérico
 * aunque mande campos inválidos. Después valida la versión del contrato y
 * los campos legibles en español; la validación responde `ApiResult` con el
 * código `space_fields_invalid` y el mensaje específico, que viaja al
 * cliente con `throwPublicApiError` también en producción (un `throw`
 * plano se redacta a `Server Error` en Convex). El duplicado lógico lo
 * decide Infraestructura con el índice de ubicación, en una sola fuente:
 * Aplicación no lo pre-revisa. No toca `ctx.db` ni publica
 * `query`/`mutation`: se prueban con dobles en memoria y el borde de
 * Presentación los expone.
 *
 * Toda denegación (sin identidad, sin perfil, no administrador, cuenta no
 * vigente o sala inexistente o de otra tabla) responde el mismo error
 * genérico, sin filtrar existencia. El duplicado responde `conflict`.
 * Las respuestas mantienen el contrato `Space` más su resumen legible
 * (`label`) y su vigencia (`isActive`), para que Web y Mobile no inventen
 * otra representación del mismo concepto.
 */

export type ManagedSpace = {
  readonly space: Space;
  readonly label: string;
  readonly isActive: boolean;
};

type ManageStore = SpaceReader & SpaceWriter;

/**
 * Impacto de un cambio de sala sobre atenciones futuras (TI2-156).
 *
 * Revalida las futuras que usan la sala con la misma regla de reserva. Si la
 * lectura se trunca, rechaza con `conflict` para no avisar a medias.
 */
export interface SpaceChangeImpactDeps {
  readonly future: {
    listFutureBySpace(
      spaceId: string,
      now: number,
    ): Promise<{
      readonly complete: boolean;
      readonly appointments: readonly ImpactedAppointmentInput[];
    }>;
  };
  readonly auth: AuthorizationReader;
  readonly availability: AvailabilityReader;
  readonly needs: AccompanimentNeedsReader;
  readonly compatibility: CompatibilitySpaceSource;
  readonly notifications: NotificationEventRecorder;
  readonly now?: () => number;
}

async function evaluateAllSpaceBookable(
  deps: {
    readonly auth: AuthorizationReader;
    readonly availability: AvailabilityReader;
    readonly needs: AccompanimentNeedsReader;
    readonly compatibility: CompatibilitySpaceSource;
  },
  appointments: readonly ImpactedAppointmentInput[],
): Promise<{ readonly ok: true; readonly byId: Map<string, boolean> } | { readonly ok: false }> {
  const byId = new Map<string, boolean>();
  for (const appointment of appointments) {
    const result = await isAppointmentStillBookable(
      {
        auth: deps.auth,
        availability: deps.availability,
        needs: deps.needs,
        compatibility: deps.compatibility,
      },
      appointment,
    );
    if (result.status === "error") return { ok: false };
    byId.set(appointment.id, result.data);
  }
  return { ok: true, byId };
}

function isLocationChanged(
  oldSpace: { campus: string; building: string; floor: string; room: string },
  next: { campus: string; building: string; floor: string; room: string },
): boolean {
  return (
    oldSpace.campus.trim() !== next.campus.trim() ||
    oldSpace.building.trim() !== next.building.trim() ||
    oldSpace.floor.trim() !== next.floor.trim() ||
    oldSpace.room.trim() !== next.room.trim()
  );
}

function denied<T>(): ApiResult<T> {
  return errResult(unauthorizedError());
}

function invalidFields<T>(message: string): ApiResult<T> {
  return errResult({ code: SPACE_FIELDS_INVALID_ERROR_CODE, message });
}

async function authorizeOrDeny(
  auth: AuthorizationReader,
  tokenIdentifier: string | null,
): Promise<{ readonly callerId: string } | ApiResult<ManagedSpace>> {
  const grant = await authorizeSpaceCatalogManage(auth, { tokenIdentifier });
  return grant.status === "error" ? denied() : { callerId: grant.data.callerId };
}

function checkVersion(version: string): void {
  if (version !== SPACE_CATALOG_CONTRACT_VERSION) {
    throw new Error("La versión del contrato de espacios debe ser la vigente.");
  }
}

function checkFields(fields: SpaceFields): SpaceFields | { readonly message: string } {
  const message = validateSpaceFields(fields);
  if (message !== null) return { message };
  return normalizeSpaceFields(fields);
}

function toManaged(space: Space, isActive: boolean): ManagedSpace {
  return { space, label: toSpaceLabel(space), isActive };
}

async function readManaged(store: SpaceReader, spaceId: string): Promise<ManagedSpace | null> {
  const stored = await store.getSpace(spaceId);
  if (stored === null) return null;
  const { isActive, ...space } = stored;
  return toManaged(space, isActive);
}

/**
 * Crea una sala vigente. La ubicación duplicada (vigente o retirada)
 * responde `conflict` sin escribir: es la misma sala y el camino es
 * reactivarla con `setSpaceCatalogActive`.
 */
export async function createSpaceCatalogEntry(
  auth: AuthorizationReader,
  store: ManageStore,
  input: { readonly tokenIdentifier: string | null; readonly version: string } & SpaceFields,
): Promise<ApiResult<ManagedSpace>> {
  const authz = await authorizeOrDeny(auth, input.tokenIdentifier);
  if (!("callerId" in authz)) return authz;
  checkVersion(input.version);
  const fields = checkFields(input);
  if ("message" in fields) return invalidFields(fields.message);
  const inserted = await store.insertSpace(fields);
  if (inserted.status === "error") return errResult(inserted.error);
  const managed = await readManaged(store, inserted.data.spaceId);
  if (managed === null) throw new Error("La sala creada no quedó registrada.");
  return okResult(managed);
}

/**
 * Reemplaza los campos de una sala sin cambiar su vigencia. La sala
 * inexistente o de otra tabla se deniega igual, y la ubicación de otra
 * sala responde `conflict`.
 *
 * Si cambia la ubicación, avisa a todas las futuras de esa sala; si solo
 * cambian condiciones, avisa solo a las que pasan de compatibles a
 * incompatibles (antes/después en la misma transacción).
 */
export async function updateSpaceCatalogEntry(
  auth: AuthorizationReader,
  store: ManageStore,
  input: {
    readonly tokenIdentifier: string | null;
    readonly version: string;
    readonly spaceId: string;
  } & SpaceFields,
  impact: SpaceChangeImpactDeps,
): Promise<ApiResult<ManagedSpace>> {
  const authz = await authorizeOrDeny(auth, input.tokenIdentifier);
  if (!("callerId" in authz)) return authz;
  checkVersion(input.version);
  const fields = checkFields(input);
  if ("message" in fields) return invalidFields(fields.message);
  const existing = await store.getSpace(input.spaceId);
  if (existing === null) return denied();
  const now = impact.now === undefined ? Date.now() : impact.now();
  const future = await impact.future.listFutureBySpace(input.spaceId, now);
  if (!future.complete) return errResult(conflictError());
  const locationChanged = isLocationChanged(existing, fields);
  const slotDeps = {
    auth: impact.auth,
    availability: impact.availability,
    needs: impact.needs,
    compatibility: impact.compatibility,
  };
  const before =
    locationChanged || future.appointments.length === 0
      ? null
      : await evaluateAllSpaceBookable(slotDeps, future.appointments);
  if (before !== null && !before.ok) return errResult(conflictError());
  const updated = await store.updateSpace(input.spaceId, fields);
  if (updated.status === "error") return errResult(updated.error);
  if (future.appointments.length === 0) {
    const managedEmpty = await readManaged(store, input.spaceId);
    if (managedEmpty === null) return denied();
    return okResult(managedEmpty);
  }
  if (locationChanged) {
    await notifySpaceImpact(impact.notifications, future.appointments, {
      actorId: authz.callerId,
      occurredAt: now,
    });
  } else {
    const after = await evaluateAllSpaceBookable(slotDeps, future.appointments);
    if (!after.ok) return errResult(conflictError());
    const newly = future.appointments.filter(
      (appointment) =>
        before !== null &&
        before.ok &&
        before.byId.get(appointment.id) === true &&
        after.byId.get(appointment.id) === false,
    );
    await notifySpaceImpact(impact.notifications, newly, {
      actorId: authz.callerId,
      occurredAt: now,
    });
  }
  const managed = await readManaged(store, input.spaceId);
  if (managed === null) return denied();
  return okResult(managed);
}

/**
 * Retira o reactiva una sala sin borrarla ni su historial. Solo avisa lo que
 * pasa de reservable a no reservable; reactivar no avisa.
 */
export async function setSpaceCatalogActive(
  auth: AuthorizationReader,
  store: ManageStore,
  input: {
    readonly tokenIdentifier: string | null;
    readonly version: string;
    readonly spaceId: string;
    readonly isActive: boolean;
  },
  impact: SpaceChangeImpactDeps,
): Promise<ApiResult<ManagedSpace>> {
  const authz = await authorizeOrDeny(auth, input.tokenIdentifier);
  if (!("callerId" in authz)) return authz;
  checkVersion(input.version);
  const existing = await store.getSpace(input.spaceId);
  if (existing === null) return denied();
  const now = impact.now === undefined ? Date.now() : impact.now();
  const future = await impact.future.listFutureBySpace(input.spaceId, now);
  if (!future.complete) return errResult(conflictError());
  const slotDeps = {
    auth: impact.auth,
    availability: impact.availability,
    needs: impact.needs,
    compatibility: impact.compatibility,
  };
  const before = await evaluateAllSpaceBookable(slotDeps, future.appointments);
  if (!before.ok) return errResult(conflictError());
  const patched = await store.setSpaceActive(input.spaceId, input.isActive);
  if (patched.status === "error") return errResult(patched.error);
  const after = await evaluateAllSpaceBookable(slotDeps, future.appointments);
  if (!after.ok) return errResult(conflictError());
  const newly = future.appointments.filter(
    (appointment) =>
      before.byId.get(appointment.id) === true && after.byId.get(appointment.id) === false,
  );
  await notifySpaceImpact(impact.notifications, newly, {
    actorId: authz.callerId,
    occurredAt: now,
  });
  const managed = await readManaged(store, input.spaceId);
  if (managed === null) return denied();
  return okResult(managed);
}

/**
 * Consulta una sala por id con permiso de administración, vigente o
 * retirada. La inexistente o de otra tabla se deniega igual, sin filtrar.
 */
export async function getSpaceCatalogEntry(
  auth: AuthorizationReader,
  store: SpaceReader,
  input: {
    readonly tokenIdentifier: string | null;
    readonly version: string;
    readonly spaceId: string;
  },
): Promise<ApiResult<ManagedSpace>> {
  const authz = await authorizeOrDeny(auth, input.tokenIdentifier);
  if (!("callerId" in authz)) return authz;
  checkVersion(input.version);
  const managed = await readManaged(store, input.spaceId);
  if (managed === null) return denied();
  return okResult(managed);
}
