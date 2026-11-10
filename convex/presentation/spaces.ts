import { v } from "convex/values";
import {
  createSpaceCatalogEntry,
  getSpaceCatalogEntry,
  setSpaceCatalogActive,
  updateSpaceCatalogEntry,
} from "../application/spaces/mutations";
import { listSpaceCatalogUseCase } from "../application/spaces/queries";
import { mutation, query } from "../_generated/server";
import { SPACE_CATALOG_CONTRACT_VERSION } from "../domain/spaces/space";
import { authorizationReader } from "../infrastructure/accompaniments/repository";
import { spaceReader, spaceWriter } from "../infrastructure/spaces/repository";
import { unwrapApiResult as unwrap } from "./session";

/**
 * Borde de Presentación: catálogo de espacios con autorización en Backend (TI2-99).
 *
 * Adaptador delgado bajo `api.presentation.spaces`: valida la entrada,
 * resuelve la identidad en el servidor con `ctx.auth.getUserIdentity()` y
 * delega en Aplicación, que autoriza por cuenta vigente y lee el catálogo
 * vigente con Infraestructura. Nunca acepta un `userId` del cliente como
 * prueba ni toca `ctx.db` directamente.
 *
 * Toda denegación (sin identidad, sin perfil o cuenta inhabilitada)
 * responde con el mismo error genérico, sin exponer el motivo. El listado se
 * pagina: nunca se trunca en silencio.
 */

const spaceValidator = v.object({
  id: v.id("spaces"),
  campus: v.string(),
  building: v.string(),
  floor: v.string(),
  room: v.string(),
  accessConditions: v.string(),
  arrivalInstructions: v.string(),
  version: v.literal(SPACE_CATALOG_CONTRACT_VERSION),
});

const managedSpaceValidator = v.object({
  space: v.object({
    id: v.string(),
    campus: v.string(),
    building: v.string(),
    floor: v.string(),
    room: v.string(),
    accessConditions: v.string(),
    arrivalInstructions: v.string(),
    version: v.literal(SPACE_CATALOG_CONTRACT_VERSION),
  }),
  label: v.string(),
  isActive: v.boolean(),
  version: v.literal(SPACE_CATALOG_CONTRACT_VERSION),
});

const spaceFields = {
  campus: v.string(),
  building: v.string(),
  floor: v.string(),
  room: v.string(),
  accessConditions: v.string(),
  arrivalInstructions: v.string(),
  version: v.literal(SPACE_CATALOG_CONTRACT_VERSION),
};

const spaceCatalogPageValidator = v.object({
  items: v.array(spaceValidator),
  hasMore: v.boolean(),
  nextCursor: v.union(v.string(), v.null()),
  version: v.literal(SPACE_CATALOG_CONTRACT_VERSION),
});

/**
 * Lista el catálogo de espacios que puede ver el solicitante, paginado.
 * Basta una cuenta vigente de cualquier rol; el resto recibe denegación.
 */
export const listSpaces = query({
  args: {
    limit: v.number(),
    cursor: v.optional(v.string()),
    version: v.literal(SPACE_CATALOG_CONTRACT_VERSION),
  },
  returns: spaceCatalogPageValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return await listSpaceCatalogUseCase(ctx, identity, args);
  },
});

/**
 * Gestión del catálogo de espacios (TI2-148): solo administración vigente.
 *
 * Adaptadores delgados: validan la forma del contrato v1, resuelven la
 * identidad en el servidor y delegan en Aplicación con los adaptadores de
 * Infraestructura. No tocan `ctx.db` ni aceptan `userId` del cliente. Los
 * errores usan `throwPublicApiError`: `unauthorized` sin motivo ni
 * existencia y `conflict` para el duplicado lógico, sin borrar historial.
 */

/** Crea una sala vigente con su resumen legible y su vigencia. */
export const createSpace = mutation({
  args: { ...spaceFields },
  returns: managedSpaceValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const managed = unwrap(
      await createSpaceCatalogEntry(
        authorizationReader(ctx),
        { ...spaceReader(ctx), ...spaceWriter(ctx) },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          ...args,
        },
      ),
    );
    return { ...managed, version: SPACE_CATALOG_CONTRACT_VERSION };
  },
});

/** Reemplaza los campos de una sala sin cambiar su vigencia. */
export const updateSpace = mutation({
  args: { spaceId: v.string(), ...spaceFields },
  returns: managedSpaceValidator,
  handler: async (ctx, { spaceId, version: _version, ...fields }) => {
    const identity = await ctx.auth.getUserIdentity();
    const managed = unwrap(
      await updateSpaceCatalogEntry(
        authorizationReader(ctx),
        { ...spaceReader(ctx), ...spaceWriter(ctx) },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          version: SPACE_CATALOG_CONTRACT_VERSION,
          spaceId,
          ...fields,
        },
      ),
    );
    return { ...managed, version: SPACE_CATALOG_CONTRACT_VERSION };
  },
});

/** Retira o reactiva una sala sin borrarla. La retirada no avisa: es TI2-156. */
export const setSpaceActive = mutation({
  args: {
    spaceId: v.string(),
    isActive: v.boolean(),
    version: v.literal(SPACE_CATALOG_CONTRACT_VERSION),
  },
  returns: managedSpaceValidator,
  handler: async (ctx, { spaceId, isActive }) => {
    const identity = await ctx.auth.getUserIdentity();
    const managed = unwrap(
      await setSpaceCatalogActive(
        authorizationReader(ctx),
        { ...spaceReader(ctx), ...spaceWriter(ctx) },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          version: SPACE_CATALOG_CONTRACT_VERSION,
          spaceId,
          isActive,
        },
      ),
    );
    return { ...managed, version: SPACE_CATALOG_CONTRACT_VERSION };
  },
});

/** Consulta una sala por id, vigente o retirada. Solo administración. */
export const getSpace = query({
  args: { spaceId: v.string(), version: v.literal(SPACE_CATALOG_CONTRACT_VERSION) },
  returns: managedSpaceValidator,
  handler: async (ctx, { spaceId }) => {
    const identity = await ctx.auth.getUserIdentity();
    const managed = unwrap(
      await getSpaceCatalogEntry(authorizationReader(ctx), spaceReader(ctx), {
        tokenIdentifier: identity?.tokenIdentifier ?? null,
        version: SPACE_CATALOG_CONTRACT_VERSION,
        spaceId,
      }),
    );
    return { ...managed, version: SPACE_CATALOG_CONTRACT_VERSION };
  },
});
