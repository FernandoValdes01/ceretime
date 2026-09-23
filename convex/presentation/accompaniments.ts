import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import {
  getAccompanimentDetail,
  getInternalNotesUseCase,
  listAssignedAccompanimentsUseCase,
  listOwnedAccompanimentsUseCase,
} from "../application/accompaniments/queries";
import { query } from "../_generated/server";
import { accompanimentStatusUnion } from "../validators";

/**
 * Borde de Presentación: acompañamientos con autorización en Backend (S2).
 *
 * Adaptador delgado: valida la entrada, resuelve la identidad en el servidor
 * con `ctx.auth.getUserIdentity()` y delega en Aplicación, que carga el
 * perfil y los datos con Infraestructura y decide con Dominio. Nunca acepta
 * un `userId` del cliente como prueba ni toca `ctx.db` directamente.
 *
 * Toda denegación (sin identidad, sin perfil, cuenta inhabilitada, fuera de
 * alcance, acompañamiento inexistente o acceso general de Administrador)
 * responde con el mismo error genérico, sin exponer el motivo ni la
 * existencia del recurso. Los listados se paginan: nunca se truncan en
 * silencio.
 */

const fullAccompanimentValidator = v.object({
  _id: v.id("accompaniments"),
  studentId: v.id("users"),
  status: accompanimentStatusUnion,
  objective: v.string(),
  accessNeeds: v.string(),
  view: v.literal("full"),
});

/** Vista completa reutilizable: la apertura por aceptación (TI2-24) la devuelve. */
export const acceptedAccompanimentValidator = fullAccompanimentValidator;

const minimizedAccompanimentValidator = v.object({
  _id: v.id("accompaniments"),
  status: accompanimentStatusUnion,
  objective: v.string(),
  view: v.literal("minimized"),
});

const accompanimentViewValidator = v.union(
  fullAccompanimentValidator,
  minimizedAccompanimentValidator,
);

const internalNoteValidator = v.object({
  _id: v.id("followUpNotes"),
  accompanimentId: v.id("accompaniments"),
  body: v.string(),
});

const assignedListValidator = v.object({
  items: v.array(accompanimentViewValidator),
  hasMore: v.boolean(),
  lastId: v.union(v.id("accompaniments"), v.null()),
});

/**
 * Lee un acompañamiento con vista completa o minimizada según el rol.
 * El Administrador siempre recibe denegación, sin acceso general.
 */
export const getAccompaniment = query({
  args: { accompanimentId: v.id("accompaniments") },
  returns: accompanimentViewValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return await getAccompanimentDetail(ctx, identity, args);
  },
});

/**
 * Lista los acompañamientos propios del Estudiante, paginado.
 * Cualquier otro rol recibe denegación.
 */
export const listOwnedAccompaniments = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(accompanimentViewValidator),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return await listOwnedAccompanimentsUseCase(ctx, identity, args);
  },
});

/**
 * Lista los acompañamientos asignados al Profesional o Practicante con
 * paginación keyset sobre el acompañamiento. Estudiante y Administrador
 * reciben denegación.
 */
export const listAssignedAccompaniments = query({
  args: {
    limit: v.number(),
    after: v.optional(v.id("accompaniments")),
  },
  returns: assignedListValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return await listAssignedAccompanimentsUseCase(ctx, identity, args);
  },
});

/**
 * Lee notas internas breves, paginadas. Solo Profesional con asignación
 * activa. Estudiante, Practicante y Administrador siempre reciben
 * denegación.
 */
export const getInternalNotes = query({
  args: { accompanimentId: v.id("accompaniments"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(internalNoteValidator),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return await getInternalNotesUseCase(ctx, identity, args);
  },
});
