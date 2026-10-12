import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { conflictError, errResult, okResult, type ApiResult } from "../../domain/errors/api_error";
import type { Space } from "../../domain/spaces/space";

/**
 * Repositorio de espacios (TI2-95 escritura y lecturas técnicas, TI2-99
 * catálogo).
 *
 * Capa de Infraestructura: único lugar que toca la tabla `spaces`. Se organiza
 * por secciones con pertenencia explícita: quien integre después agrega su
 * sección sin tocar la ajena. No decide autorización ni resuelve identidad;
 * consulta con los índices declarados en `convex/schema.ts`, en el orden del
 * índice.
 *
 * Opera con datos ficticios.
 */

/** Contexto con lectura de base de datos (consultas y mutaciones). */
type DbReader = QueryCtx | MutationCtx;

// ── TI2-95: escritura y lecturas técnicas ─────────────────────────────────
//
// Lo que disponibilidad necesita de una sala: resolverla por id para validar
// bloques y excepciones, y crearla sin repetir la misma ubicación. Devuelve
// filas: el mapeo al contrato `Space` es el de la sección del catálogo. Retirar
// una sala del catálogo no está aquí: exige decidir qué pasa con los bloques,
// excepciones y atenciones que la usan, y esa gestión no tiene productor en
// S2 (TI2-104).

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
