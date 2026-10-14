import { v } from "convex/values";
import { listSpaceCatalogUseCase } from "../application/spaces/queries";
import { query } from "../_generated/server";
import { SPACE_CATALOG_CONTRACT_VERSION } from "../domain/spaces/space";

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
