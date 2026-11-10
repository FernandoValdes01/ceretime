import {
  SPACE_CATALOG_CONTRACT_VERSION,
  normalizeSpaceFields,
  toSpaceLabel,
  validateSpaceFields,
  type Space,
  type SpaceFields,
} from "../../domain/spaces/space";
import {
  conflictError,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import { authorizeSpaceCatalogManage, type AuthorizationReader } from "../authorization/authorize";
import type { SpaceReader, SpaceWriter } from "./ports";

/**
 * Casos de uso de gestión del catálogo de espacios (TI2-148).
 *
 * Capa de Aplicación: exige administración con cuenta vigente, valida la
 * versión del contrato y los campos legibles en español, rechaza el
 * duplicado lógico y delega la persistencia en el puerto `SpaceWriter`.
 * No toca `ctx.db` ni publica `query`/`mutation`: se prueban con dobles en
 * memoria y el borde de Presentación los expone.
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

function denied<T>(): ApiResult<T> {
  return errResult(unauthorizedError());
}

function conflict<T>(): ApiResult<T> {
  return errResult(conflictError());
}

function checkVersion(version: string): void {
  if (version !== SPACE_CATALOG_CONTRACT_VERSION) {
    throw new Error("La versión del contrato de espacios debe ser la vigente.");
  }
}

function checkFields(fields: SpaceFields): SpaceFields {
  const message = validateSpaceFields(fields);
  if (message !== null) throw new Error(message);
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
 * responde `conflict` sin escribir: es la misma sala.
 */
export async function createSpaceCatalogEntry(
  auth: AuthorizationReader,
  store: ManageStore,
  input: { readonly tokenIdentifier: string | null; readonly version: string } & SpaceFields,
): Promise<ApiResult<ManagedSpace>> {
  checkVersion(input.version);
  const fields = checkFields(input);
  const grant = await authorizeSpaceCatalogManage(auth, {
    tokenIdentifier: input.tokenIdentifier,
  });
  if (grant.status === "error") return denied();
  if ((await store.findSpaceByLocation(fields)) !== null) return conflict();
  const inserted = await store.insertSpace(fields);
  if (inserted.status === "error") return errResult(inserted.error);
  const managed = await readManaged(store, inserted.data.spaceId);
  if (managed === null) return conflict();
  return okResult(managed);
}

/**
 * Reemplaza los campos de una sala sin cambiar su vigencia. La sala
 * inexistente o de otra tabla se deniega igual, y la ubicación de otra
 * sala responde `conflict`.
 */
export async function updateSpaceCatalogEntry(
  auth: AuthorizationReader,
  store: ManageStore,
  input: {
    readonly tokenIdentifier: string | null;
    readonly version: string;
    readonly spaceId: string;
  } & SpaceFields,
): Promise<ApiResult<ManagedSpace>> {
  checkVersion(input.version);
  const fields = checkFields(input);
  const grant = await authorizeSpaceCatalogManage(auth, {
    tokenIdentifier: input.tokenIdentifier,
  });
  if (grant.status === "error") return denied();
  const existing = await store.getSpace(input.spaceId);
  if (existing === null) return denied();
  const clash = await store.findSpaceByLocation(fields);
  if (clash !== null && clash.id !== existing.id) return conflict();
  const updated = await store.updateSpace(input.spaceId, fields);
  if (updated.status === "error") return errResult(updated.error);
  const managed = await readManaged(store, input.spaceId);
  if (managed === null) return denied();
  return okResult(managed);
}

/**
 * Retira o reactiva una sala sin borrarla ni su historial. La sala
 * inexistente o de otra tabla se deniega igual. Retirar no avisa a
 * atenciones confirmadas: eso es tarea del siguiente módulo (TI2-156).
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
): Promise<ApiResult<ManagedSpace>> {
  checkVersion(input.version);
  const grant = await authorizeSpaceCatalogManage(auth, {
    tokenIdentifier: input.tokenIdentifier,
  });
  if (grant.status === "error") return denied();
  const existing = await store.getSpace(input.spaceId);
  if (existing === null) return denied();
  const patched = await store.setSpaceActive(input.spaceId, input.isActive);
  if (patched.status === "error") return errResult(patched.error);
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
  checkVersion(input.version);
  const grant = await authorizeSpaceCatalogManage(auth, {
    tokenIdentifier: input.tokenIdentifier,
  });
  if (grant.status === "error") return denied();
  const managed = await readManaged(store, input.spaceId);
  if (managed === null) return denied();
  return okResult(managed);
}
