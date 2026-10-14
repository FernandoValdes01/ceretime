import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import type { QueryCtx } from "../../_generated/server";
import { SPACE_CATALOG_CONTRACT_VERSION } from "../../domain/spaces/space";
import {
  AUTHORIZATION_DENIED_MESSAGE,
  authorizeSpaceCatalogRead,
} from "../authorization/authorize";
import { authorizationReader } from "../../infrastructure/accompaniments/repository";
import { listActiveSpaceRows, toSpace } from "../../infrastructure/spaces/repository";

/**
 * Casos de uso de lectura del catálogo de espacios (TI2-99).
 *
 * Capa de Aplicación: recibe la identidad ya resuelta en el borde con
 * `ctx.auth.getUserIdentity()`, exige cuenta vigente de cualquier rol con
 * `authorizeSpaceCatalogRead` y lee el catálogo vigente con Infraestructura.
 * El dominio institucional no autoriza por sí solo: sin perfil vinculado la
 * respuesta es denegación genérica. Opera con datos ficticios.
 */

/** Tope de elementos por página: se rechaza el exceso, nunca se trunca en silencio. */
export const SPACE_CATALOG_PAGE_LIMIT_MAX = 100;

function deny(): never {
  throw new ConvexError(AUTHORIZATION_DENIED_MESSAGE);
}

/**
 * Lista el catálogo de espacios que puede ver el solicitante, paginado.
 *
 * Solo trae salas vigentes (`isActive`) y solo campos del contrato `Space`:
 * el catálogo no concede acceso a acompañamientos. La versión debe ser la
 * vigente y el límite un entero entre 1 y el máximo; lo demás se rechaza con
 * error de regla en español.
 */
export async function listSpaceCatalogUseCase(
  ctx: QueryCtx,
  identity: UserIdentity | null,
  args: { readonly limit: number; readonly cursor?: string; readonly version: string },
) {
  if (args.version !== SPACE_CATALOG_CONTRACT_VERSION) {
    throw new Error("La versión del contrato de espacios debe ser la vigente.");
  }
  if (!Number.isInteger(args.limit) || args.limit < 1) {
    throw new Error("El límite del catálogo debe ser un entero positivo.");
  }
  if (args.limit > SPACE_CATALOG_PAGE_LIMIT_MAX) {
    throw new Error(
      `El límite del catálogo supera el máximo de ${SPACE_CATALOG_PAGE_LIMIT_MAX} por página.`,
    );
  }
  const grant = await authorizeSpaceCatalogRead(authorizationReader(ctx), {
    tokenIdentifier: identity?.tokenIdentifier ?? null,
  });
  if (grant.status === "error") {
    deny();
  }
  const page = await listActiveSpaceRows(ctx, { limit: args.limit, cursor: args.cursor ?? null });
  return {
    items: page.items.map(toSpace),
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    version: SPACE_CATALOG_CONTRACT_VERSION,
  };
}
