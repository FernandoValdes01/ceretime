import { v } from "convex/values";
import { bookAppointment as bookAppointmentUseCase } from "../application/appointments/booking";
import {
  cancelAppointment as cancelAppointmentUseCase,
  recordAppointmentAttendance as recordAppointmentAttendanceUseCase,
  rescheduleAppointment as rescheduleAppointmentUseCase,
} from "../application/appointments/changes";
import {
  getAppointment as getAppointmentUseCase,
  listAppointments as listAppointmentsUseCase,
} from "../application/appointments/queries";
import { mutation, query } from "../_generated/server";
import { APPOINTMENT_CONTRACT_VERSION } from "../domain/appointments/appointment";
import { AGENDA_TIME_ZONE } from "../domain/availability/availability";
import {
  accompanimentNeedsReader,
  authorizationReader,
} from "../infrastructure/accompaniments/repository";
import {
  appointmentAgendaReader,
  appointmentChangeReader,
  appointmentOccupier,
  appointmentTransitionRepository,
} from "../infrastructure/appointments/repository";
import { availabilityReader } from "../infrastructure/availability/repository";
import { compatibilitySpaceSource } from "../infrastructure/spaces/repository";
import {
  appointmentAttendanceOutcomeUnion,
  appointmentStatusUnion,
  modalityUnion,
} from "../infrastructure/validators";
import { unwrapApiResult } from "./session";

/**
 * Borde de Presentación: reserva, cambios y consulta de atenciones
 * (TI2-111/TI2-121/TI2-112).
 *
 * Adaptadores delgados bajo `api.presentation.appointments`: validan la forma
 * del contrato v1 de TI2-87, resuelven la identidad en el servidor con
 * `ctx.auth.getUserIdentity()` y delegan en los casos de uso de TI2-98,
 * TI2-109, TI2-110 y TI2-112, compuestos con los adaptadores de TI2-86, TI2-95
 * y TI2-96. No tocan `ctx.db` ni deciden reglas: la pertenencia sale de la fila
 * leída en el servidor y el actor, del perfil de la sesión. Nunca aceptan un
 * `userId` del cliente como prueba.
 *
 * La reserva y el reagendamiento revalidan el destino contra la disponibilidad
 * vigente, siempre en la zona de la agenda (`AGENDA_TIME_ZONE`) que fija el
 * servidor: el cliente no envía zona horaria y no puede correr un cupo fuera
 * del horario publicado. La cancelación conserva la fila con su estado
 * terminal y el motivo; el reagendamiento mueve la misma fila; el registro
 * declara solo realización o inasistencia pendiente. La justificación posterior
 * es TI2-119 y todavía no tiene caso de uso persistido en `main`, así que no se
 * publica acá.
 *
 * Los errores se lanzan con la traducción compartida de TI2-88
 * (`ConvexError({code, message})`): `unauthorized` sin permiso o con un
 * identificador ajeno o inexistente, `conflict` ante una entrada inválida, un
 * estado que no admite el cambio o un cruce de ocupación, y `no_availability`
 * cuando el destino ya no existe o no es compatible. La respuesta de éxito es
 * la misma atención, sin datos de terceros.
 *
 * Las consultas entregan solo la vista que autoriza el servidor, `full` o
 * `minimized`, y nunca `studentId`, notas ni necesidades de acceso. Opera con
 * datos ficticios.
 */

/** Éxito de una reserva o cambio: la misma atención, con identificador genérico. */
const appointmentResultValidator = v.object({ appointmentId: v.string() });

/** Reserva el cupo elegido para un acompañamiento activo del Estudiante. */
export const bookAppointment = mutation({
  args: {
    accompanimentId: v.string(),
    professionalId: v.string(),
    modality: modalityUnion,
    spaceId: v.optional(v.string()),
    startAt: v.number(),
    endAt: v.number(),
    version: v.literal(APPOINTMENT_CONTRACT_VERSION),
  },
  returns: appointmentResultValidator,
  handler: async (ctx, { version: _version, ...slot }) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await bookAppointmentUseCase(
        {
          auth: authorizationReader(ctx),
          availability: availabilityReader(ctx),
          needs: accompanimentNeedsReader(ctx),
          compatibility: compatibilitySpaceSource(ctx),
          occupier: appointmentOccupier(ctx),
        },
        { ...slot, timeZone: AGENDA_TIME_ZONE, tokenIdentifier: identity?.tokenIdentifier ?? null },
      ),
    );
  },
});

/**
 * Cancela una atención propia o a cargo del Profesional asignado. El destino
 * (`cancelled_by_student` o `cancelled_by_cereti`) lo decide el rol de la
 * sesión; el motivo es obligatorio para CERETI y opcional para el Estudiante.
 */
export const cancelAppointment = mutation({
  args: {
    appointmentId: v.string(),
    reason: v.optional(v.string()),
    version: v.literal(APPOINTMENT_CONTRACT_VERSION),
  },
  returns: appointmentResultValidator,
  handler: async (ctx, { version: _version, appointmentId, reason }) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await cancelAppointmentUseCase(
        {
          auth: authorizationReader(ctx),
          appointments: appointmentChangeReader(ctx),
          persister: appointmentTransitionRepository(ctx).persister,
        },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          appointmentId,
          ...(reason === undefined ? {} : { reason }),
        },
      ),
    );
  },
});

/**
 * Mueve una atención a un cupo vigente y compatible. El cliente elige el
 * Profesional, la modalidad, la sala y el horario; el servidor revalida todo
 * con la misma regla de la reserva y descuenta la atención que se mueve. La
 * zona horaria no viaja en la entrada.
 */
export const rescheduleAppointment = mutation({
  args: {
    appointmentId: v.string(),
    professionalId: v.string(),
    modality: modalityUnion,
    spaceId: v.optional(v.string()),
    startAt: v.number(),
    endAt: v.number(),
    version: v.literal(APPOINTMENT_CONTRACT_VERSION),
  },
  returns: appointmentResultValidator,
  handler: async (ctx, { version: _version, appointmentId, ...slot }) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await rescheduleAppointmentUseCase(
        {
          auth: authorizationReader(ctx),
          appointments: appointmentChangeReader(ctx),
          persister: appointmentTransitionRepository(ctx).persister,
          occupier: appointmentOccupier(ctx),
          availability: availabilityReader(ctx),
          needs: accompanimentNeedsReader(ctx),
          compatibility: compatibilitySpaceSource(ctx),
        },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          appointmentId,
          ...slot,
          timeZone: AGENDA_TIME_ZONE,
        },
      ),
    );
  },
});

/**
 * Registra que la atención se realizó o que el Estudiante no asistió. Solo el
 * Profesional asignado que la tiene a su cargo puede declararlo; la
 * justificación de la inasistencia queda para TI2-119.
 */
export const recordAppointmentAttendance = mutation({
  args: {
    appointmentId: v.string(),
    outcome: appointmentAttendanceOutcomeUnion,
    version: v.literal(APPOINTMENT_CONTRACT_VERSION),
  },
  returns: appointmentResultValidator,
  handler: async (ctx, { version: _version, appointmentId, outcome }) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await recordAppointmentAttendanceUseCase(
        {
          auth: authorizationReader(ctx),
          appointments: appointmentChangeReader(ctx),
          persister: appointmentTransitionRepository(ctx).persister,
        },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          appointmentId,
          outcome,
        },
      ),
    );
  },
});

const version = v.literal(APPOINTMENT_CONTRACT_VERSION);

/** Proyección de la atención: las claves de cada vista son el contrato con los clientes. */
const appointmentProjectionValidator = v.union(
  v.object({
    id: v.string(),
    accompanimentId: v.string(),
    professionalId: v.string(),
    modality: modalityUnion,
    spaceId: v.optional(v.string()),
    startAt: v.number(),
    endAt: v.number(),
    originalStartAt: v.optional(v.number()),
    cancelReason: v.optional(v.string()),
    status: appointmentStatusUnion,
    version,
    view: v.literal("full"),
  }),
  v.object({
    id: v.string(),
    status: appointmentStatusUnion,
    startAt: v.number(),
    endAt: v.number(),
    modality: modalityUnion,
    view: v.literal("minimized"),
  }),
);

/**
 * Atenciones por rango civil y con paginación. Sin `accompanimentId` es la
 * agenda propia del Estudiante o del Profesional; con él, las atenciones de ese
 * acompañamiento con la vista de quien consulta. Las fechas se leen en la zona
 * de la agenda (`AGENDA_TIME_ZONE`), que fija el servidor.
 */
export const listAppointments = query({
  args: {
    accompanimentId: v.optional(v.string()),
    from: v.string(),
    to: v.string(),
    limit: v.number(),
    cursor: v.optional(v.string()),
    version,
  },
  returns: v.object({
    items: v.array(appointmentProjectionValidator),
    hasMore: v.boolean(),
    nextCursor: v.union(v.string(), v.null()),
    version,
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const page = unwrapApiResult(
      await listAppointmentsUseCase(
        { auth: authorizationReader(ctx), appointments: appointmentAgendaReader(ctx) },
        { ...args, timeZone: AGENDA_TIME_ZONE, tokenIdentifier: identity?.tokenIdentifier ?? null },
      ),
    );
    // La página del dominio es de solo lectura; el validador espera un arreglo.
    return { ...page, items: [...page.items] };
  },
});

/** Detalle de una atención con la vista de su acompañamiento. */
export const getAppointment = query({
  args: { appointmentId: v.string(), version },
  returns: appointmentProjectionValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await getAppointmentUseCase(
        { auth: authorizationReader(ctx), appointments: appointmentAgendaReader(ctx) },
        { ...args, tokenIdentifier: identity?.tokenIdentifier ?? null },
      ),
    );
  },
});
