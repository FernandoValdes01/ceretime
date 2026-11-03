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
 * solo registra el identificador determinista ya creado por el proveedor.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { loadCalendarAppointment } from "../application/calendar/calendar";
import { authorizationReader } from "../infrastructure/accompaniments/repository";
import {
  appointmentCalendarReader,
  normalizeAppointmentId,
  recordCalendarEvent,
} from "../infrastructure/appointments/repository";

const calendarAppointmentContextValidator = v.union(
  v.null(),
  v.object({
    appointmentId: v.string(),
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
  }),
);

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

/** Guarda la referencia del evento después de una creación exitosa. */
export const recordCalendarEventReference = internalMutation({
  args: {
    appointmentId: v.string(),
    eventId: v.string(),
    addedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const appointmentId = normalizeAppointmentId(ctx, args.appointmentId);
    if (appointmentId === null) return null;
    if (args.eventId.length === 0 || args.eventId.length > 1024) return null;
    if (!Number.isFinite(args.addedAt)) return null;
    await recordCalendarEvent(ctx, appointmentId, args.eventId, args.addedAt);
    return null;
  },
});
