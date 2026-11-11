import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { conflictError, errResult, okResult, type ApiResult } from "../../domain/errors/api_error";
import type { AccessNeed } from "../../domain/requests/request";
import type { Space } from "../../domain/spaces/space";
import { SPACE_CATALOG_CONTRACT_VERSION } from "../../domain/spaces/space";

/**
 * Repositorio de espacios (TI2-99 catálogo, TI2-95 escritura y lecturas
 * técnicas).
 *
 * Capa de Infraestructura: único lugar que toca la tabla `spaces`. Se organiza
 * por secciones con pertenencia explícita: quien integre después agrega su
 * sección sin tocar la ajena. No decide autorización ni resuelve identidad;
 * consulta con los índices declarados en `convex/schema.ts`, en el orden del
 * índice.
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

/** Contexto con lectura de base de datos (consultas y mutaciones). */
type DbReader = QueryCtx | MutationCtx;

// ── TI2-95: escritura y lecturas técnicas ─────────────────────────────────
//
// Lo que disponibilidad necesita de una sala: resolverla por id para validar
// bloques y excepciones, y crearla sin repetir la misma ubicación. Las
// funciones de filas son para Infraestructura; Aplicación lee con
// `spaceReader(ctx)`, que entrega el contrato `Space` mapeado con `toSpace`.
// TI2-148 suma `updateSpace` y `setSpaceActive` con la misma regla de
// unicidad: retirar conserva la fila y su historial, y no avisa a
// atenciones confirmadas (eso es TI2-156).

/** Sala por id, vigente o retirada; `null` si no existe o el id es de otra tabla. */
export async function getSpaceRow(ctx: DbReader, spaceId: string): Promise<Doc<"spaces"> | null> {
  const id = ctx.db.normalizeId("spaces", spaceId);
  return id === null ? null : await ctx.db.get(id);
}

/** Sala en una ubicación exacta (campus, edificio, piso y sala), o `null`. */
export async function findSpaceRowByLocation(
  ctx: DbReader,
  location: Pick<Space, "campus" | "building" | "floor" | "room">,
): Promise<Doc<"spaces"> | null> {
  return await ctx.db
    .query("spaces")
    .withIndex("by_campus_and_building_and_floor_and_room", (q) =>
      q
        .eq("campus", location.campus)
        .eq("building", location.building)
        .eq("floor", location.floor)
        .eq("room", location.room),
    )
    .first();
}

/**
 * Crea una sala vigente. Recibe el vocabulario del contrato `Space`
 * (`arrivalInstructions`) y lo guarda con el del esquema
 * (`accessInstructions`). Una ubicación ya registrada, vigente o retirada,
 * responde `conflict` sin escribir: es la misma sala.
 */
export async function insertSpace(
  ctx: MutationCtx,
  space: Omit<Space, "id" | "version">,
): Promise<ApiResult<{ readonly spaceId: string }>> {
  if ((await findSpaceRowByLocation(ctx, space)) !== null) {
    return errResult(conflictError());
  }
  const spaceId = await ctx.db.insert("spaces", {
    campus: space.campus,
    building: space.building,
    floor: space.floor,
    room: space.room,
    accessConditions: space.accessConditions,
    accessInstructions: space.arrivalInstructions,
    isActive: true,
  });
  return okResult({ spaceId });
}

/**
 * Reemplaza los campos de una sala sin cambiar su vigencia. La sala
 * inexistente o de otra tabla y la ubicación que ya usa otra sala
 * responden `conflict` sin escribir.
 */
export async function updateSpace(
  ctx: MutationCtx,
  spaceId: string,
  space: Omit<Space, "id" | "version">,
): Promise<ApiResult<null>> {
  const id = ctx.db.normalizeId("spaces", spaceId);
  const row = id === null ? null : await ctx.db.get(id);
  if (row === null) return errResult(conflictError());
  const clash = await findSpaceRowByLocation(ctx, space);
  if (clash !== null && clash._id !== row._id) return errResult(conflictError());
  await ctx.db.patch(row._id, {
    campus: space.campus,
    building: space.building,
    floor: space.floor,
    room: space.room,
    accessConditions: space.accessConditions,
    accessInstructions: space.arrivalInstructions,
  });
  return okResult(null);
}

/**
 * Retira o reactiva una sala sin borrarla ni su historial. La sala
 * inexistente o de otra tabla responde `conflict` sin escribir, sin
 * filtrar la existencia.
 */
export async function setSpaceActive(
  ctx: MutationCtx,
  spaceId: string,
  isActive: boolean,
): Promise<ApiResult<null>> {
  const id = ctx.db.normalizeId("spaces", spaceId);
  const row = id === null ? null : await ctx.db.get(id);
  if (row === null) return errResult(conflictError());
  await ctx.db.patch(row._id, { isActive });
  return okResult(null);
}

/**
 * Escrituras del catálogo para Aplicación (TI2-148). Validan integridad,
 * no autorización: el caso de uso exige administración vigente antes de
 * llamar. Cumplen por forma el puerto `SpaceWriter` sin importarlo.
 */
export function spaceWriter(ctx: MutationCtx) {
  return {
    insertSpace: (space: Omit<Space, "id" | "version">) => insertSpace(ctx, space),
    updateSpace: (spaceId: string, space: Omit<Space, "id" | "version">) =>
      updateSpace(ctx, spaceId, space),
    setSpaceActive: (spaceId: string, isActive: boolean) => setSpaceActive(ctx, spaceId, isActive),
  };
}

/** Contrato `Space` más la vigencia, que el contrato no trae. */
function toStoredSpace(row: Doc<"spaces">) {
  return { ...toSpace(row), isActive: row.isActive };
}

/**
 * Lecturas técnicas de espacios para Aplicación. A diferencia del catálogo
 * publicado, también entregan salas retiradas con `isActive: false`: quien
 * valida una referencia necesita distinguir la retirada de la inexistente.
 */
export function spaceReader(ctx: DbReader) {
  return {
    getSpace: async (spaceId: string) => {
      const row = await getSpaceRow(ctx, spaceId);
      return row === null ? null : toStoredSpace(row);
    },
    findSpaceByLocation: async (
      location: Pick<Space, "campus" | "building" | "floor" | "room">,
    ) => {
      const row = await findSpaceRowByLocation(ctx, location);
      return row === null ? null : toStoredSpace(row);
    },
  };
}

// ── TI2-111/TI2-121: necesidades y condiciones de compatibilidad ──────────
//
// Decisión provisional compartida: el esquema guarda las necesidades del acompañamiento
// (`accessNeeds`) y las condiciones de la sala (`accessConditions`) como
// texto, y la compatibilidad de TI2-82 compara identificadores. Cada línea
// no vacía es una necesidad cuyo identificador es su propio texto, la misma
// forma en que la solicitud une sus etiquetas (`toStoredRequestFields`). Una
// sala cubre una necesidad solo si trae la misma línea: lo que no calza
// queda sin cubrir y la opción se descarta, nunca se rebaja. La plataforma
// en línea no declara apoyos porque el esquema no tiene dónde guardarlos.

/** Necesidades de un texto guardado, una por línea, sin repetir ni vacías. */
export function accessNeedsFromLines(text: string): AccessNeed[] {
  const seen = new Set<string>();
  const needs: AccessNeed[] = [];
  for (const line of text.split("\n")) {
    const label = line.trim();
    if (label === "" || seen.has(label)) continue;
    seen.add(label);
    needs.push({ id: label, label });
  }
  return needs;
}

/**
 * Espacios para la compatibilidad (puerto `CompatibilitySpaceSource` de
 * TI2-97). Una sala retirada, inexistente o de otra tabla responde `null` y
 * no se ofrece.
 */
export function compatibilitySpaceSource(ctx: DbReader) {
  return {
    findCompatibilitySpace: async (spaceId: string) => {
      const row = await getSpaceRow(ctx, spaceId);
      if (row === null || !row.isActive) return null;
      return {
        space: toSpace(row),
        isActive: row.isActive,
        satisfiedNeeds: accessNeedsFromLines(row.accessConditions),
      };
    },
    listOnlineSupports: async (): Promise<readonly AccessNeed[]> => [],
  };
}
