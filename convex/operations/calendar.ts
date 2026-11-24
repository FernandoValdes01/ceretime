/**
 * Operaciones internas de la integración con Google Calendar (TI2-122).
 *
 * Una acción pública no tiene acceso a `ctx.db`; estas funciones son el único
 * puente para que la acción lea la atención autorizada y guarde la referencia
 * del evento. Son `internal*`: no forman parte de la API que consumen Web o
 * Mobile y solo las invoca la acción del borde de Presentación.
 *
 * La lectura reutiliza la autorización de Aplicación y la identidad de la
 * sesión que la acción pasa desde `ctx.auth.getUserIdentity()`. La escritura
 * solo registra el identificador determinista y el horario con el que quedó
 * el evento: al reagendar la atención, la referencia conserva el horario
 * anterior y queda obsoleta hasta que la persona la actualice.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { loadCalendarAppointment } from "../application/calendar/calendar";
import {
  checkCalendarLinkAccess as checkCalendarLinkAccessUseCase,
  markCalendarDisconnected as markCalendarDisconnectedUseCase,
} from "../application/calendar/calendar_link";
import { authorizationReader } from "../infrastructure/accompaniments/repository";
import { calendarLinkStore } from "../infrastructure/calendar/repository";
import {
  appointmentCalendarReader,
  normalizeAppointmentId,
  recordCalendarEvent,
} from "../infrastructure/appointments/repository";
import { appointmentStatusUnion } from "../infrastructure/validators";

const calendarAppointmentContextShape = v.object({
  appointmentId: v.string(),
  status: appointmentStatusUnion,
  startAt: v.number(),
  endAt: v.number(),
  createdAt: v.number(),
  reference: v.union(
    v.null(),
    v.object({
      eventId: v.string(),
      addedAt: v.number(),
    }),
  ),
  referenceIsCurrent: v.boolean(),
});

const calendarAppointmentContextValidator = v.union(v.null(), calendarAppointmentContextShape);

/** Carga y autoriza la atención antes de llamar al proveedor externo. */
export const loadAppointmentCalendarContext = internalQuery({
  args: {
    tokenIdentifier: v.union(v.string(), v.null()),
    appointmentId: v.string(),
  },
  returns: calendarAppointmentContextValidator,
  handler: async (ctx, args) => {
    return await loadCalendarAppointment(
      {
        auth: authorizationReader(ctx),
        appointments: appointmentCalendarReader(ctx),
      },
      args,
    );
  },
});

/**
 * Guarda la referencia del evento después de una creación o actualización
 * exitosa. El horario guardado es el que realmente tiene el evento: al
 * reagendar la atención después, la referencia conserva el horario anterior y
 * queda obsoleta, sin confirmar que la nueva fecha está agregada.
 */
export const recordCalendarEventReference = internalMutation({
  args: {
    appointmentId: v.string(),
    eventId: v.string(),
    addedAt: v.number(),
    startsAt: v.number(),
    endsAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const appointmentId = normalizeAppointmentId(ctx, args.appointmentId);
    if (appointmentId === null) return null;
    if (args.eventId.length === 0 || args.eventId.length > 1024) return null;
    if (![args.addedAt, args.startsAt, args.endsAt].every(Number.isFinite)) return null;
    await recordCalendarEvent(ctx, appointmentId, {
      eventId: args.eventId,
      addedAt: args.addedAt,
      startsAt: args.startsAt,
      endsAt: args.endsAt,
    });
    return null;
  },
});

/**
 * Acceso al vínculo propio para la desconexión (TI2-161).
 *
 * La acción lo consulta antes de revocar en Google, para no tocar un acceso
 * ajeno al rol aunque exista una fila heredada.
 */
export const checkCalendarLinkAccess = internalQuery({
  args: { tokenIdentifier: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return await checkCalendarLinkAccessUseCase(
      { auth: authorizationReader(ctx) },
      { tokenIdentifier: args.tokenIdentifier },
    );
  },
});

/**
 * Marca la desconexión local del vínculo propio (TI2-161).
 *
 * La invoca la acción pública tras revocar el permiso en Google: la acción no
 * tiene base de datos y esta mutación resuelve el perfil de la sesión,
 * registra `revokedAt` y devuelve el aviso de eventos previos. Solo toca la
 * fila propia. Solo Estudiante y Profesional (RF-27, `calendar:disconnect`).
 */
export const markCalendarDisconnected = internalMutation({
  args: {
    tokenIdentifier: v.string(),
    revoked: v.union(v.literal("revoked"), v.literal("not_found")),
  },
  returns: v.union(
    v.object({
      status: v.literal("ok"),
      data: v.object({
        disconnected: v.boolean(),
        status: v.union(
          v.literal("unlinked"),
          v.literal("already_unlinked"),
          v.literal("not_found"),
        ),
        revokedAt: v.optional(v.number()),
        staleEventsMayRemain: v.boolean(),
      }),
    }),
    v.object({
      status: v.literal("error"),
      error: v.object({ code: v.string(), message: v.string() }),
    }),
  ),
  handler: async (ctx, args) => {
    return await markCalendarDisconnectedUseCase(
      {
        auth: authorizationReader(ctx),
        store: calendarLinkStore(ctx),
        now: () => Date.now(),
      },
      { tokenIdentifier: args.tokenIdentifier, revoked: args.revoked },
    );
  },
});
