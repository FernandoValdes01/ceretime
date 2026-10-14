import type { Doc } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import type { Space } from "../../domain/spaces/space";
import { SPACE_CATALOG_CONTRACT_VERSION } from "../../domain/spaces/space";

/**
 * Repositorio del catálogo de espacios (TI2-99 lectura, TI2-95 escritura).
 *
 * Capa de Infraestructura: único lugar que toca la tabla `spaces`. Se organiza
 * por secciones con pertenencia explícita: quien integre después agrega su
 * sección sin tocar la ajena. No decide autorización ni resuelve identidad;
 * solo lee con los índices declarados en `convex/schema.ts`, consultando los
 * campos en el orden del índice.
 *
 * Opera con datos ficticios.
 */

/**
 * Convierte una fila de `spaces` al contrato público `Space` (TI2-95, uso compartido).
 *
 * Mapeo único para no escribirlo dos veces: el esquema nombra
 * `accessInstructions` y el contrato `arrivalInstructions`; el identificador
 * de fila sale como `id` plano. La vigencia (`isActive`) no viaja en el
 * contrato: el catálogo publicado solo trae salas vigentes. El genérico
 * preserva la marca del identificador (p. ej. `Id<"spaces">`) para los
 * validadores del borde, igual que `toAccompanimentRequest`.
 */
export function toSpace<SpaceId extends string>(doc: {
  readonly _id: SpaceId;
  readonly campus: string;
  readonly building: string;
  readonly floor: string;
  readonly room: string;
  readonly accessConditions: string;
  readonly accessInstructions: string;
}): Space & { readonly id: SpaceId } {
  return {
    id: doc._id,
    campus: doc.campus,
    building: doc.building,
    floor: doc.floor,
    room: doc.room,
    accessConditions: doc.accessConditions,
    arrivalInstructions: doc.accessInstructions,
    version: SPACE_CATALOG_CONTRACT_VERSION,
  };
}

/** Página cruda del catálogo vigente con cursor de continuación. */
export interface SpaceCatalogRowPage {
  readonly items: ReadonlyArray<Doc<"spaces">>;
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

/**
 * Lee el catálogo vigente, paginado (TI2-99).
 *
 * Usa el índice `by_isActive` por igualdad: el resultado contiene solo salas
 * vigentes, sin filtrar en memoria. El cursor es el opaco de Convex: uno
 * ajeno o corrupto lo rechaza la plataforma. Nunca trunca en silencio: si
 * hay más filas, `hasMore` lo dice y `nextCursor` las alcanza.
 */
export async function listActiveSpaceRows(
  ctx: QueryCtx,
  input: { readonly limit: number; readonly cursor: string | null },
): Promise<SpaceCatalogRowPage> {
  const result = await ctx.db
    .query("spaces")
    .withIndex("by_isActive", (q) => q.eq("isActive", true))
    .order("asc")
    .paginate({ numItems: input.limit, cursor: input.cursor });
  return {
    items: result.page,
    hasMore: !result.isDone,
    nextCursor: result.isDone ? null : result.continueCursor,
  };
}
