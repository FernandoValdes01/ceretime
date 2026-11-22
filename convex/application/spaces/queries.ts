import { ConvexError } from "convex/values";
import { SPACE_CATALOG_CONTRACT_VERSION } from "../../domain/spaces/space";
import {
  authorizeSpaceCatalogRead,
  deniedPublicError,
  type AuthorizationReader,
} from "../authorization/authorize";
import type { SpaceCatalogReader } from "./ports";

/**
 * Casos de uso de lectura del catálogo de espacios (TI2-99).
 *
 * Capa de Aplicación: recibe el `tokenIdentifier` ya resuelto en el borde con
 * `ctx.auth.getUserIdentity()`, exige cuenta vigente de cualquier rol con
 * `authorizeSpaceCatalogRead` y lee el catálogo vigente con el puerto
 * `SpaceCatalogReader`. El dominio institucional no autoriza por sí solo: sin
 * perfil vinculado la respuesta es la denegación del contrato común
 * (`unauthorized`, TI2-88). Opera con datos ficticios.
 */

/** Tope de elementos por página: se rechaza el exceso, nunca se trunca en silencio. */
export const SPACE_CATALOG_PAGE_LIMIT_MAX = 100;

/**
 * Lista el catálogo de espacios que puede ver el solicitante, paginado.
 *
 * Solo trae salas vigentes (`isActive`) y solo campos del contrato `Space`:
 * el catálogo no concede acceso a acompañamientos. La versión debe ser la
 * vigente y el límite un entero entre 1 y el máximo; lo demás se rechaza con
 * error de regla en español.
 */
export async function listSpaceCatalogUseCase<SpaceId extends string>(
  auth: AuthorizationReader,
  catalog: SpaceCatalogReader<SpaceId>,
  args: {
    readonly tokenIdentifier: string | null;
    readonly limit: number;
    readonly cursor?: string;
    readonly version: string;
  },
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
  const grant = await authorizeSpaceCatalogRead(auth, { tokenIdentifier: args.tokenIdentifier });
  if (grant.status === "error") {
    const { code, message } = deniedPublicError();
    throw new ConvexError({ code, message });
  }
  const page = await catalog.listActiveSpaces({ limit: args.limit, cursor: args.cursor ?? null });
  return {
    items: page.items,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    version: SPACE_CATALOG_CONTRACT_VERSION,
  };
}
