import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import {
  assignAccompaniment,
  revokeAccompaniment,
  updateAccompanimentAssignment,
  type AssignmentScheduler,
} from "../application/accompaniments/commands";
import {
  getAccompanimentDetail,
  getInternalNotesUseCase,
  listAssignedAccompanimentsUseCase,
  listOwnedAccompanimentsUseCase,
} from "../application/accompaniments/queries";
import {
  closeAccompaniment as closeAccompanimentUseCase,
  pauseAccompaniment as pauseAccompanimentUseCase,
  previewAccompanimentClosure,
  reactivateAccompaniment as reactivateAccompanimentUseCase,
} from "../application/accompaniments/status";
import { mutation, query, type MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  accompanimentStatusWriter,
  authorizationReader,
} from "../infrastructure/accompaniments/repository";
import {
  appointmentTransitionRepository,
  pendingAppointmentsReader,
} from "../infrastructure/appointments/repository";
import { appointmentAuditRecorder } from "../infrastructure/audit/repository";
import { accompanimentStatusUnion, assignmentRoleUnion } from "../infrastructure/validators";
import { unwrapApiResult } from "./session";

/**
 * Programación del vencimiento para la vía pública (TI2-140).
 *
 * Implementa el puerto `AssignmentScheduler` con `ctx.scheduler.runAt`:
 * presentar solo compone; la decisión de qué programar vive en Aplicación
 * (`scheduleValidityWindow`).
 */
function schedulingFor(ctx: MutationCtx): AssignmentScheduler {
  return {
    scheduleExpiry: async (input) => {
      await ctx.scheduler.runAt(
        input.validUntil,
        internal.operations.assignments.expireAssignment,
        input,
      );
    },
  };
}

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
 * profesional de personal autorizado sobre el mismo acompañamiento y registra
 * actor y fecha; la lectura exige cuenta habilitada y asignación activa y
 * vigente, y el practicante nunca escribe ni ve notas internas.
 */

const fullAccompanimentValidator = v.object({
  _id: v.id("accompaniments"),
  studentId: v.id("users"),
  status: accompanimentStatusUnion,
  objective: v.string(),
  accessNeeds: v.string(),
  // Solicitud aceptada que lo abrió (TI2-183); falta si no nació de una.
  requestId: v.optional(v.id("requests")),
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
 * Asigna un acompañamiento a un practicante, a una cuenta de prueba o a otro
 * profesional (TI2-140).
 *
 * Solo el profesional de personal autorizado sobre el mismo acompañamiento
 * concede, con la cuenta objetivo habilitada y vigente y alcance en todos los
 * casos. Los errores usan el contrato común de TI2-88: `unauthorized` genérico
 * (sin identidad, perfil, vigencia, alcance o existencia), `conflict` ante rol
 * distinto o fila duplicada, y `assignment_fields_invalid` ante vigencia
 * incoherente.
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
    const schedule = schedulingFor(ctx);
    return unwrapApiResult(
      await assignAccompaniment(
        ctx,
        identity,
        { accompanimentId, userId, assignedRole },
        { validFrom, validUntil },
        { schedule },
      ),
    );
  },
});

/**
 * Modifica la vigencia acordada de una asignación activa (TI2-140).
 *
 * Solo el profesional de personal autorizado sobre el mismo acompañamiento
 * modifica. `null` quita el extremo y deja la asignación sin esa cota;
 * omitido conserva el valor actual. `unauthorized` genérico ante permiso,
 * alcance, existencia o fila inactiva; `conflict` ante rol distinto y
 * `assignment_fields_invalid` ante ventana incoherente.
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
    const schedule = schedulingFor(ctx);
    return unwrapApiResult(
      await updateAccompanimentAssignment(
        ctx,
        identity,
        { accompanimentId, userId, assignedRole },
        { validFrom, validUntil },
        { schedule },
      ),
    );
  },
});

/**
 * Retira el acceso asignado a un practicante, a una cuenta de prueba o a otro
 * profesional (TI2-140).
 *
 * Solo el profesional de personal autorizado sobre el mismo acompañamiento
 * retira, aunque el objetivo haya perdido habilitación. Es idempotente y
 * corta las nuevas consultas aunque se conserve el enlace.
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
    return unwrapApiResult(await revokeAccompaniment(ctx, identity, args));
  },
});

const statusChangeArgs = {
  accompanimentId: v.id("accompaniments"),
  reason: v.optional(v.string()),
};

const statusChangeResultValidator = v.object({
  accompanimentId: v.id("accompaniments"),
  status: accompanimentStatusUnion,
});

/**
 * Pausa un acompañamiento activo (TI2-152).
 *
 * Solo el Profesional vigente con asignación activa. Las atenciones
 * existentes se mantienen: mientras dure la pausa se rechazan reservas y
 * cambios de horario, pero el Estudiante dueño y el Profesional a cargo
 * todavía cancelan, y el Profesional registra el resultado. El motivo es
 * opcional. `unauthorized` genérico sin permiso o ante un
 * acompañamiento ajeno o inexistente; `conflict` si no está activo o el motivo
 * supera el tope.
 */
export const pauseAccompaniment = mutation({
  args: statusChangeArgs,
  returns: statusChangeResultValidator,
  handler: async (ctx, { accompanimentId, reason }) => {
    const identity = await ctx.auth.getUserIdentity();
    const result = unwrapApiResult(
      await pauseAccompanimentUseCase(
        { auth: authorizationReader(ctx), accompaniments: accompanimentStatusWriter(ctx) },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          accompanimentId,
          ...(reason === undefined ? {} : { reason }),
        },
      ),
    );
    return { accompanimentId, status: result.status };
  },
});

/**
 * Reactiva un acompañamiento en pausa (TI2-152), con las mismas reglas de
 * permiso y errores que la pausa. `conflict` si no está en pausa: un
 * acompañamiento cerrado no se reabre.
 */
export const reactivateAccompaniment = mutation({
  args: statusChangeArgs,
  returns: statusChangeResultValidator,
  handler: async (ctx, { accompanimentId, reason }) => {
    const identity = await ctx.auth.getUserIdentity();
    const result = unwrapApiResult(
      await reactivateAccompanimentUseCase(
        { auth: authorizationReader(ctx), accompaniments: accompanimentStatusWriter(ctx) },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          accompanimentId,
          ...(reason === undefined ? {} : { reason }),
        },
      ),
    );
    return { accompanimentId, status: result.status };
  },
});

/**
 * Cuántas atenciones cancelaría el cierre (TI2-152), para mostrarlo antes de
 * confirmar. `unrecordedAppointments` cuenta las atenciones vigentes cuya hora
 * ya pasó: mientras no sea cero, el cierre responde `conflict`. La cifra es
 * informativa y no se actualiza sola con el paso del tiempo; el cierre
 * devuelve la real.
 */
export const getAccompanimentClosurePreview = query({
  args: { accompanimentId: v.id("accompaniments") },
  returns: v.object({
    appointmentsToCancel: v.number(),
    unrecordedAppointments: v.number(),
  }),
  handler: async (ctx, { accompanimentId }) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await previewAccompanimentClosure(
        { auth: authorizationReader(ctx), appointments: pendingAppointmentsReader(ctx) },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, accompanimentId },
      ),
    );
  },
});

/**
 * Cierra un acompañamiento activo o en pausa (TI2-152).
 *
 * Cancela sus atenciones futuras como `cancelled_by_cereti`, libera cada cupo
 * y devuelve cuántas canceló. Después el acompañamiento es de solo lectura y
 * no se reabre. `conflict` si ya está cerrado o si queda una atención vigente
 * cuya hora ya pasó, y entonces no se guarda nada.
 */
export const closeAccompaniment = mutation({
  args: statusChangeArgs,
  returns: v.object({
    accompanimentId: v.id("accompaniments"),
    status: accompanimentStatusUnion,
    cancelledAppointments: v.number(),
  }),
  handler: async (ctx, { accompanimentId, reason }) => {
    const identity = await ctx.auth.getUserIdentity();
    const result = unwrapApiResult(
      await closeAccompanimentUseCase(
        {
          auth: authorizationReader(ctx),
          accompaniments: accompanimentStatusWriter(ctx),
          appointments: pendingAppointmentsReader(ctx),
          persister: appointmentTransitionRepository(ctx).persister,
          audit: appointmentAuditRecorder(ctx),
        },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          accompanimentId,
          ...(reason === undefined ? {} : { reason }),
        },
      ),
    );
    return {
      accompanimentId,
      status: result.status,
      cancelledAppointments: result.cancelledAppointments,
    };
  },
});
