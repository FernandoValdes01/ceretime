import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { SPACE_CATALOG_CONTRACT_VERSION, type Space } from "../../domain/spaces/space";
import {
  AUTHORIZATION_DENIED_MESSAGE,
  authorizeSpaceCatalogManage,
  authorizeSpaceCatalogRead,
  type AuthorizationReader,
} from "../authorization/authorize";
import { authorizationReader } from "../../infrastructure/accompaniments/repository";
import {
  listActiveSpaceRows,
  toSpace,
  type SpaceCatalogRowPage,
} from "../../infrastructure/spaces/repository";
import {
  conflictError,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";

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

/**
 * Lista las salas retiradas para Administración (TI2-156, nota TI2-169).
 *
 * Solo administración con cuenta vigente, con el mismo permiso que gestiona
 * el catálogo. Sigue puertos (sin importar Infraestructura) y devuelve
 * `ApiResult` para que Presentación lo traduzca con `unwrapApiResult`.
 */
export interface InactiveSpaceReader {
  listInactiveSpaces(input: {
    readonly limit: number;
    readonly cursor: string | null;
  }): Promise<SpaceCatalogRowPage>;
}

export async function listInactiveSpaceCatalogUseCase(
  auth: AuthorizationReader,
  store: InactiveSpaceReader,
  input: {
    readonly tokenIdentifier: string | null;
    readonly limit: number;
    readonly cursor?: string;
    readonly version: string;
  },
): Promise<
  ApiResult<{
    readonly items: (Space & { readonly id: Id<"spaces"> })[];
    readonly hasMore: boolean;
    readonly nextCursor: string | null;
    readonly version: typeof SPACE_CATALOG_CONTRACT_VERSION;
  }>
> {
  if (input.version !== SPACE_CATALOG_CONTRACT_VERSION) return errResult(conflictError());
  if (!Number.isInteger(input.limit) || input.limit < 1) return errResult(conflictError());
  if (input.limit > SPACE_CATALOG_PAGE_LIMIT_MAX) return errResult(conflictError());
  const grant = await authorizeSpaceCatalogManage(auth, {
    tokenIdentifier: input.tokenIdentifier,
  });
  if (grant.status === "error") return errResult(unauthorizedError());
  const page = await store.listInactiveSpaces({ limit: input.limit, cursor: input.cursor ?? null });
  return okResult({
    items: page.items.map(toSpace),
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    version: SPACE_CATALOG_CONTRACT_VERSION,
  });
}
