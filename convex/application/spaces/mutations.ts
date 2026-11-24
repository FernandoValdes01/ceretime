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
  findAffectedAppointments,
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

async function notifySpaceChangeImpact(
  deps: SpaceChangeImpactDeps,
  spaceId: string,
  actorId: string,
): Promise<ApiResult<null>> {
  const now = deps.now === undefined ? Date.now() : deps.now();
  const future = await deps.future.listFutureBySpace(spaceId, now);
  if (!future.complete) return errResult(conflictError());
  if (future.appointments.length === 0) return okResult(null);
  const affected = await findAffectedAppointments(
    {
      auth: deps.auth,
      availability: deps.availability,
      needs: deps.needs,
      compatibility: deps.compatibility,
    },
    future.appointments,
  );
  await notifySpaceImpact(deps.notifications, affected, { actorId, occurredAt: now });
  return okResult(null);
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
): Promise<ApiResult<ManagedSpace> | null> {
  const grant = await authorizeSpaceCatalogManage(auth, { tokenIdentifier });
  return grant.status === "error" ? denied() : null;
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
  const denial = await authorizeOrDeny(auth, input.tokenIdentifier);
  if (denial !== null) return denial;
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
 * Con `impact` (TI2-156), tras escribir revalida las futuras que usan la sala
 * y avisa a las que dejan de ser compatibles, sin borrarlas. El cambio de
 * condiciones queda conservado en el catálogo e informado por avisos.
 */
export async function updateSpaceCatalogEntry(
  auth: AuthorizationReader,
  store: ManageStore,
  input: {
    readonly tokenIdentifier: string | null;
    readonly version: string;
    readonly spaceId: string;
  } & SpaceFields,
  impact?: SpaceChangeImpactDeps,
): Promise<ApiResult<ManagedSpace>> {
  const denial = await authorizeOrDeny(auth, input.tokenIdentifier);
  if (denial !== null) return denial;
  checkVersion(input.version);
  const fields = checkFields(input);
  if ("message" in fields) return invalidFields(fields.message);
  const existing = await store.getSpace(input.spaceId);
  if (existing === null) return denied();
  const updated = await store.updateSpace(input.spaceId, fields);
  if (updated.status === "error") return errResult(updated.error);
  if (impact !== undefined) {
    const grant = await authorizeSpaceCatalogManage(auth, {
      tokenIdentifier: input.tokenIdentifier,
    });
    if (grant.status === "error") return denied();
    const notified = await notifySpaceChangeImpact(impact, input.spaceId, grant.data.callerId);
    if (notified.status === "error") return errResult(notified.error);
  }
  const managed = await readManaged(store, input.spaceId);
  if (managed === null) return denied();
  return okResult(managed);
}

/**
 * Retira o reactiva una sala sin borrarla ni su historial. La sala
 * inexistente o de otra tabla se deniega igual.
 *
 * Con `impact` (TI2-156) avisa a las futuras afectadas, sin cancelación
 * automática silenciosa: la atención confirmada nunca desaparece por un
 * cambio de configuración.
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
  impact?: SpaceChangeImpactDeps,
): Promise<ApiResult<ManagedSpace>> {
  const denial = await authorizeOrDeny(auth, input.tokenIdentifier);
  if (denial !== null) return denial;
  checkVersion(input.version);
  const existing = await store.getSpace(input.spaceId);
  if (existing === null) return denied();
  const patched = await store.setSpaceActive(input.spaceId, input.isActive);
  if (patched.status === "error") return errResult(patched.error);
  if (impact !== undefined) {
    const grant = await authorizeSpaceCatalogManage(auth, {
      tokenIdentifier: input.tokenIdentifier,
    });
    if (grant.status === "error") return denied();
    const notified = await notifySpaceChangeImpact(impact, input.spaceId, grant.data.callerId);
    if (notified.status === "error") return errResult(notified.error);
  }
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
  const denial = await authorizeOrDeny(auth, input.tokenIdentifier);
  if (denial !== null) return denial;
  checkVersion(input.version);
  const managed = await readManaged(store, input.spaceId);
  if (managed === null) return denied();
  return okResult(managed);
}
