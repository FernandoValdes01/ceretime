import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import {
  assignAccompaniment,
  revokeAccompaniment,
  updateAccompanimentAssignment,
  type AssignmentScheduler,
} from "../application/accompaniments/commands";
import { updateAccompanimentNeeds as updateAccompanimentNeedsUseCase } from "../application/accompaniments/needs";
import {
  getAccompanimentDetail,
  getInternalNotesUseCase,
  listAssignedAccompanimentsUseCase,
  listOwnedAccompanimentsUseCase,
} from "../application/accompaniments/queries";
import { listAccompanimentProfessionals as listAccompanimentProfessionalsUseCase } from "../application/accompaniments/professionals";
import { listAccompanimentInterns as listAccompanimentInternsUseCase } from "../application/accompaniments/interns";
import {
  closeAccompaniment as closeAccompanimentUseCase,
  pauseAccompaniment as pauseAccompanimentUseCase,
  previewAccompanimentClosure,
  reactivateAccompaniment as reactivateAccompanimentUseCase,
} from "../application/accompaniments/status";
import { mutation, query, type MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  accompanimentAssignmentStore,
  accompanimentInternsReader,
  accompanimentNeedsAtDateReader,
  accompanimentNeedsWriter,
  accompanimentProfessionalsReader,
  accompanimentReadStore,
  accompanimentStatusWriter,
} from "../infrastructure/accompaniments/repository";
import {
  appointmentTransitionRepository,
  futureAppointmentsReader,
  pendingAppointmentsReader,
} from "../infrastructure/appointments/repository";
import { availabilityReader } from "../infrastructure/availability/repository";
import { notificationEventRecorder } from "../infrastructure/notifications/repository";
import { appointmentAuditRecorder } from "../infrastructure/audit/repository";
import { calendarSyncScheduler } from "../infrastructure/calendar/sync_scheduler";
import { compatibilitySpaceSource } from "../infrastructure/spaces/repository";
import { accompanimentStatusUnion, assignmentRoleUnion } from "../infrastructure/validators";
import { unwrapApiResult } from "./session";
import { privacyAwareAuthorizationReader } from "./privacyAuthorization";

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
  // Código de referencia de la coordinación por canal oficial (TI2-144, TI2-183).
  referenceCode: v.string(),
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
    return await getAccompanimentDetail(accompanimentReadStore(ctx), identity, args);
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
    return await listOwnedAccompanimentsUseCase(accompanimentReadStore(ctx), identity, args);
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
    return await listAssignedAccompanimentsUseCase(accompanimentReadStore(ctx), identity, args);
  },
});

/**
 * Profesionales asignados al acompañamiento y los que se le pueden asignar,
 * con su nombre (TI2-165). Solo el profesional de personal asignado; el
 * cambio se hace con `assignAccompanimentAccess` y `revokeAccompanimentAccess`.
 */
export const listAccompanimentProfessionals = query({
  args: { accompanimentId: v.id("accompaniments") },
  returns: v.object({
    assigned: v.array(
      v.object({
        userId: v.id("users"),
        fullName: v.string(),
        assignedAt: v.optional(v.number()),
        isCaller: v.boolean(),
        removable: v.boolean(),
      }),
    ),
    assignable: v.array(v.object({ userId: v.id("users"), fullName: v.string() })),
    assignableComplete: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const result = unwrapApiResult(
      await listAccompanimentProfessionalsUseCase(accompanimentProfessionalsReader(ctx), {
        tokenIdentifier: identity?.tokenIdentifier ?? null,
        accompanimentId: args.accompanimentId,
      }),
    );
    return {
      ...result,
      assigned: [...result.assigned],
      assignable: [...result.assignable],
    };
  },
});

/**
 * Practicantes asignados al acompañamiento y los que se le pueden asignar,
 * con su nombre y su vigencia acordada (TI2-170). Solo el profesional de
 * personal asignado; el cambio se hace con `assignAccompanimentAccess`,
 * `updateAccompanimentAccess` y `revokeAccompanimentAccess`.
 */
export const listAccompanimentInterns = query({
  args: { accompanimentId: v.id("accompaniments") },
  returns: v.object({
    assigned: v.array(
      v.object({
        userId: v.id("users"),
        fullName: v.string(),
        assignedAt: v.optional(v.number()),
        validFrom: v.optional(v.number()),
        validUntil: v.optional(v.number()),
      }),
    ),
    assignable: v.array(v.object({ userId: v.id("users"), fullName: v.string() })),
    assignableComplete: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const result = unwrapApiResult(
      await listAccompanimentInternsUseCase(accompanimentInternsReader(ctx), {
        tokenIdentifier: identity?.tokenIdentifier ?? null,
        accompanimentId: args.accompanimentId,
      }),
    );
    return {
      ...result,
      assigned: [...result.assigned],
      assignable: [...result.assignable],
    };
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
    return await getInternalNotesUseCase(accompanimentReadStore(ctx), identity, args);
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
        accompanimentAssignmentStore(ctx),
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
        accompanimentAssignmentStore(ctx),
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
    return unwrapApiResult(
      await revokeAccompaniment(accompanimentAssignmentStore(ctx), identity, args),
    );
  },
});

const statusChangeArgs = {
  accompanimentId: v.id("accompaniments"),
};

const statusChangeResultValidator = v.object({
  accompanimentId: v.id("accompaniments"),
  status: accompanimentStatusUnion,
});

/**
 * Pausa un acompañamiento activo (TI2-152).
 *
 * Solo el Profesional vigente con asignación activa. Las atenciones
 * existentes se mantienen, pero mientras dure la pausa no se reservan,
 * cancelan ni cambian, ni se registra su resultado. No recibe motivo: el MER
 * no lo guarda. `unauthorized` genérico sin permiso o ante un acompañamiento
 * ajeno o inexistente; `conflict` si no está activo.
 */
export const pauseAccompaniment = mutation({
  args: statusChangeArgs,
  returns: statusChangeResultValidator,
  handler: async (ctx, { accompanimentId }) => {
    const identity = await ctx.auth.getUserIdentity();
    const result = unwrapApiResult(
      await pauseAccompanimentUseCase(
        {
          auth: privacyAwareAuthorizationReader(ctx),
          accompaniments: accompanimentStatusWriter(ctx),
        },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, accompanimentId },
      ),
    );
    return { accompanimentId, status: result.status };
  },
});

/**
 * Reactiva un acompañamiento en pausa (TI2-152), con las mismas reglas de
 * permiso y errores que la pausa, y tampoco recibe motivo. `conflict` si no
 * está en pausa: un acompañamiento cerrado no se reabre.
 */
export const reactivateAccompaniment = mutation({
  args: statusChangeArgs,
  returns: statusChangeResultValidator,
  handler: async (ctx, { accompanimentId }) => {
    const identity = await ctx.auth.getUserIdentity();
    const result = unwrapApiResult(
      await reactivateAccompanimentUseCase(
        {
          auth: privacyAwareAuthorizationReader(ctx),
          accompaniments: accompanimentStatusWriter(ctx),
        },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, accompanimentId },
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
        {
          auth: privacyAwareAuthorizationReader(ctx),
          appointments: pendingAppointmentsReader(ctx),
        },
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
 * no se reabre. El motivo es opcional y queda en el acompañamiento junto a
 * quién cerró y cuándo, como `motivoCierre?` del MER. `conflict` si ya está
 * cerrado, si queda una atención vigente cuya hora ya pasó o si el motivo
 * supera el tope, y entonces no se guarda nada.
 */
export const closeAccompaniment = mutation({
  args: { ...statusChangeArgs, reason: v.optional(v.string()) },
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
          auth: privacyAwareAuthorizationReader(ctx),
          accompaniments: accompanimentStatusWriter(ctx),
          appointments: pendingAppointmentsReader(ctx),
          persister: appointmentTransitionRepository(ctx).persister,
          audit: appointmentAuditRecorder(ctx),
          notifications: notificationEventRecorder(ctx),
          calendarSync: calendarSyncScheduler(ctx),
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

/**
 * Actualiza las necesidades de acceso del estudiante (TI2-156).
 *
 * Solo el estudiante dueño, sobre un acompañamiento activo o en pausa. El
 * cambio se aplica a atenciones futuras sin alterar lo registrado antes: las
 * anteriores conservan su fila. Las futuras que dejan de ser compatibles se
 * avisan a sus profesionales para coordinar una solución, sin cancelarlas.
 */
export const updateAccompanimentNeeds = mutation({
  args: {
    accompanimentId: v.id("accompaniments"),
    accessNeeds: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { accompanimentId, accessNeeds }) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await updateAccompanimentNeedsUseCase(
        privacyAwareAuthorizationReader(ctx),
        accompanimentNeedsWriter(ctx),
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          accompanimentId,
          accessNeeds,
        },
        {
          future: futureAppointmentsReader(ctx),
          availability: availabilityReader(ctx),
          needs: accompanimentNeedsAtDateReader(ctx),
          compatibility: compatibilitySpaceSource(ctx),
          notifications: notificationEventRecorder(ctx),
        },
      ),
    );
  },
});
