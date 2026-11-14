import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import {
  assignAccompaniment,
  revokeAccompaniment,
  updateAccompanimentAssignment,
} from "../application/accompaniments/commands";
import {
  getAccompanimentDetail,
  getInternalNotesUseCase,
  listAssignedAccompanimentsUseCase,
  listOwnedAccompanimentsUseCase,
} from "../application/accompaniments/queries";
import { mutation, query } from "../_generated/server";
import { accompanimentStatusUnion, assignmentRoleUnion } from "../infrastructure/validators";

/**
 * Borde de Presentación: acompañamientos con autorización en Backend (S2)
 * más gestión de practicantes y cuenta de prueba por el profesional (TI2-140).
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
 * silencio. La gestión (asignar, modificar vigencia, revocar) la realiza el
 * profesional autorizado sobre el mismo acompañamiento y registra actor y
 * fecha; la lectura exige ambas condiciones (cuenta habilitada y asignación
 * activa) y el practicante nunca escribe ni ve notas internas.
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

/**
 * Asigna un acompañamiento a un practicante o a una cuenta de prueba (TI2-140).
 *
 * Solo el profesional autorizado sobre el mismo acompañamiento concede, con
 * la cuenta objetivo habilitada y vigente. Rechaza concesiones fuera de su
 * alcance y la vigencia incoherente (`validFrom` posterior a `validUntil`)
 * con el mismo error genérico o un error de regla en español, sin revelar
 * existencia.
 */
export const assignAccompanimentAccess = mutation({
  args: {
    accompanimentId: v.id("accompaniments"),
    userId: v.id("users"),
    assignedRole: assignmentRoleUnion,
    validFrom: v.optional(v.number()),
    validUntil: v.optional(v.number()),
  },
  returns: v.id("accompanimentAssignments"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const { accompanimentId, userId, assignedRole, validFrom, validUntil } = args;
    return await assignAccompaniment(
      ctx,
      identity,
      { accompanimentId, userId, assignedRole },
      {
        ...(validFrom === undefined ? {} : { validFrom }),
        ...(validUntil === undefined ? {} : { validUntil }),
      },
    );
  },
});

/**
 * Modifica la vigencia acordada de una asignación activa (TI2-140).
 *
 * Solo el profesional autorizado sobre el mismo acompañamiento modifica.
 * `null` quita el extremo y deja la asignación sin esa cota; omitido
 * conserva el valor actual. Comprueba la coherencia de la ventana resultante.
 */
export const updateAccompanimentAccess = mutation({
  args: {
    accompanimentId: v.id("accompaniments"),
    userId: v.id("users"),
    assignedRole: assignmentRoleUnion,
    validFrom: v.optional(v.union(v.number(), v.null())),
    validUntil: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.id("accompanimentAssignments"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const { accompanimentId, userId, assignedRole, validFrom, validUntil } = args;
    return await updateAccompanimentAssignment(
      ctx,
      identity,
      { accompanimentId, userId, assignedRole },
      {
        ...(validFrom === undefined ? {} : { validFrom }),
        ...(validUntil === undefined ? {} : { validUntil }),
      },
    );
  },
});

/**
 * Retira el acceso asignado a un practicante o a una cuenta de prueba (TI2-140).
 *
 * Solo el profesional autorizado sobre el mismo acompañamiento retira, aunque
 * el objetivo haya perdido habilitación. Es idempotente y corta las nuevas
 * consultas aunque se conserve el enlace.
 */
export const revokeAccompanimentAccess = mutation({
  args: {
    accompanimentId: v.id("accompaniments"),
    userId: v.id("users"),
    assignedRole: assignmentRoleUnion,
  },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return await revokeAccompaniment(ctx, identity, args);
  },
});
