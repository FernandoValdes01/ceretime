import type { PaginationOptions } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

/**
 * Repositorio de lectura de agenda (TI2-83).
 *
 * Capa de Infraestructura: expone una consulta por cada índice de las
 * tablas `spaces`, `availabilityBlocks`, `availabilityExceptions` y
 * `attentions`, recorriendo los campos en el orden declarado en
 * `convex/schema.ts`. No decide autorización, no resuelve identidad y no
 * aplica reglas de negocio: la ocupación atómica de cupo es TI2-84, el
 * catálogo autorizado es TI2-99 y los repositorios de escritura son
 * TI2-95. Las escrituras de las pruebas siembran directo con `ctx.db`
 * para demostrar que cada índice responde desde cero.
 *
 * Opera exclusivamente con DATOS FICTICIOS durante desarrollo y pruebas.
 */

/** Contexto con lectura de base de datos (consultas y mutaciones). */
type DbReader = QueryCtx | MutationCtx;

/** Sala por id, o `null` si no existe. */
export async function getSpaceById(
  ctx: DbReader,
  spaceId: Id<"spaces">,
): Promise<Doc<"spaces"> | null> {
  return await ctx.db.get(spaceId);
}

/** Salas vigentes o retiradas del catálogo, paginadas. */
export async function listSpacesByActive(
  ctx: DbReader,
  isActive: boolean,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("spaces")
    .withIndex("by_isActive", (q) => q.eq("isActive", isActive))
    .paginate(paginationOpts);
}

/**
 * Sala exacta por sede, si existe. Basta una fila para decidir el
 * duplicado lógico sin barrer el catálogo.
 */
export async function findSpaceByRoom(
  ctx: DbReader,
  input: {
    readonly campus: string;
    readonly building: string;
    readonly floor: string;
    readonly room: string;
  },
): Promise<Doc<"spaces"> | null> {
  const rows = await ctx.db
    .query("spaces")
    .withIndex("by_campus_and_building_and_floor_and_room", (q) =>
      q
        .eq("campus", input.campus)
        .eq("building", input.building)
        .eq("floor", input.floor)
        .eq("room", input.room),
    )
    .take(1);
  return rows[0] ?? null;
}

/** Bloques del profesional. */
export async function listBlocksByProfessional(
  ctx: DbReader,
  professionalId: Id<"users">,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("availabilityBlocks")
    .withIndex("by_professional", (q) => q.eq("professionalId", professionalId))
    .paginate(paginationOpts);
}

/** Bloques del profesional en un día de semana. */
export async function listBlocksByProfessionalAndWeekday(
  ctx: DbReader,
  professionalId: Id<"users">,
  weekday: number,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("availabilityBlocks")
    .withIndex("by_professional_and_weekday", (q) =>
      q.eq("professionalId", professionalId).eq("weekday", weekday),
    )
    .paginate(paginationOpts);
}

/** Bloques vigentes del profesional en un día de semana. */
export async function listActiveBlocksByProfessionalAndWeekday(
  ctx: DbReader,
  professionalId: Id<"users">,
  weekday: number,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("availabilityBlocks")
    .withIndex("by_professional_and_weekday_and_isActive", (q) =>
      q.eq("professionalId", professionalId).eq("weekday", weekday).eq("isActive", true),
    )
    .paginate(paginationOpts);
}

/** Bloques que usan una sala. */
export async function listBlocksBySpace(
  ctx: DbReader,
  spaceId: Id<"spaces">,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("availabilityBlocks")
    .withIndex("by_space", (q) => q.eq("spaceId", spaceId))
    .paginate(paginationOpts);
}

/** Excepciones del profesional en un día. */
export async function listExceptionsByProfessionalAndDate(
  ctx: DbReader,
  professionalId: Id<"users">,
  date: number,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("availabilityExceptions")
    .withIndex("by_professional_and_date", (q) =>
      q.eq("professionalId", professionalId).eq("date", date),
    )
    .paginate(paginationOpts);
}

/** Excepciones de todos los profesionales en un día. */
export async function listExceptionsByDate(
  ctx: DbReader,
  date: number,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("availabilityExceptions")
    .withIndex("by_date", (q) => q.eq("date", date))
    .paginate(paginationOpts);
}

/** Atención por id, o `null` si no existe. */
export async function getAttentionById(
  ctx: DbReader,
  attentionId: Id<"attentions">,
): Promise<Doc<"attentions"> | null> {
  return await ctx.db.get(attentionId);
}

/** Atenciones propias del estudiante, paginadas. */
export async function listAttentionsByStudent(
  ctx: DbReader,
  studentId: Id<"users">,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("attentions")
    .withIndex("by_student", (q) => q.eq("studentId", studentId))
    .paginate(paginationOpts);
}

/** Atenciones propias del estudiante desde un instante, paginadas. */
export async function listAttentionsByStudentFrom(
  ctx: DbReader,
  studentId: Id<"users">,
  fromStartsAt: number,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("attentions")
    .withIndex("by_student_and_startsAt", (q) =>
      q.eq("studentId", studentId).gte("startsAt", fromStartsAt),
    )
    .paginate(paginationOpts);
}

/** Agenda del profesional, paginada. */
export async function listAttentionsByProfessional(
  ctx: DbReader,
  professionalId: Id<"users">,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("attentions")
    .withIndex("by_professional", (q) => q.eq("professionalId", professionalId))
    .paginate(paginationOpts);
}

/** Agenda del profesional desde un instante, paginada. */
export async function listAttentionsByProfessionalFrom(
  ctx: DbReader,
  professionalId: Id<"users">,
  fromStartsAt: number,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("attentions")
    .withIndex("by_professional_and_startsAt", (q) =>
      q.eq("professionalId", professionalId).gte("startsAt", fromStartsAt),
    )
    .paginate(paginationOpts);
}

/** Ocupación de la sala, paginada. */
export async function listAttentionsBySpace(
  ctx: DbReader,
  spaceId: Id<"spaces">,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("attentions")
    .withIndex("by_space", (q) => q.eq("spaceId", spaceId))
    .paginate(paginationOpts);
}

/** Ocupación de la sala desde un instante, paginada. */
export async function listAttentionsBySpaceFrom(
  ctx: DbReader,
  spaceId: Id<"spaces">,
  fromStartsAt: number,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("attentions")
    .withIndex("by_space_and_startsAt", (q) =>
      q.eq("spaceId", spaceId).gte("startsAt", fromStartsAt),
    )
    .paginate(paginationOpts);
}

/** Atenciones del acompañamiento, paginadas. */
export async function listAttentionsByAccompaniment(
  ctx: DbReader,
  accompanimentId: Id<"accompaniments">,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("attentions")
    .withIndex("by_accompaniment", (q) => q.eq("accompanimentId", accompanimentId))
    .paginate(paginationOpts);
}
