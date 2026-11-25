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
import { env, internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { loadCalendarAppointment } from "../application/calendar/calendar";
import { syncAppointmentToGoogleCalendar } from "../application/calendar/sync";
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
import {
  markCalendarSyncPending as markSyncPendingRow,
  recordCalendarSyncAttempt as recordSyncAttemptRow,
} from "../infrastructure/calendar/repository";
import {
  calendarOAuthClientConfigFromEnv,
  googleCalendarGatewayWithToken,
  resolveBackgroundCalendarAccess,
} from "../infrastructure/calendar/google_calendar";
import { AGENDA_TIME_ZONE } from "../domain/availability/availability";
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

/**
 * Contexto de sincronización sin autorización (TI2-162).
 *
 * La sincronización automática corre en segundo plano sin sesión: lee la
 * atención vigente y los `subject` de sus participantes desde las filas
 * `users`, sin aceptar identificadores del cliente. Los tokens se resuelven
 * después por `subject` en la acción, nunca se devuelven.
 */
export const loadAppointmentSyncContext = internalQuery({
  args: { appointmentId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      ...calendarAppointmentContextShape.fields,
      studentSubject: v.string(),
      professionalSubjects: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const appointmentId = normalizeAppointmentId(ctx, args.appointmentId);
    if (appointmentId === null) return null;
    const doc = await ctx.db.get(appointmentId);
    if (doc === null) return null;
    const student = await ctx.db.get(doc.studentId);
    const studentSubject = subjectOf(student?.tokenIdentifier ?? null);
    if (studentSubject === null) return null;
    const professionals = await ctx.db
      .query("appointmentProfessionals")
      .withIndex("by_appointmentId_and_professionalId", (q) => q.eq("appointmentId", appointmentId))
      .take(10);
    const subjects: string[] = [];
    const seen = new Set<string>();
    const pushSubject = (subject: string | null) => {
      if (subject === null || seen.has(subject)) return;
      seen.add(subject);
      subjects.push(subject);
    };
    const responsible = await ctx.db.get(doc.professionalId);
    pushSubject(subjectOf(responsible?.tokenIdentifier ?? null));
    for (const row of professionals) {
      const user = await ctx.db.get(row.professionalId);
      pushSubject(subjectOf(user?.tokenIdentifier ?? null));
    }
    const reference =
      doc.calendarEventId === undefined
        ? null
        : {
            eventId: doc.calendarEventId,
            addedAt: doc.calendarEventAddedAt ?? 0,
          };
    return {
      appointmentId: doc._id,
      status: doc.status,
      startAt: doc.startsAt,
      endAt: doc.endsAt,
      createdAt: doc.createdAt,
      reference,
      referenceIsCurrent:
        reference !== null &&
        doc.calendarEventStartsAt === doc.startsAt &&
        doc.calendarEventEndsAt === doc.endsAt,
      studentSubject,
      professionalSubjects: subjects.filter((subject) => subject !== studentSubject),
    };
  },
});

function subjectOf(tokenIdentifier: string | null): string | null {
  if (tokenIdentifier === null) return null;
  const separator = tokenIdentifier.lastIndexOf("|");
  if (separator < 0) return null;
  const subject = tokenIdentifier.slice(separator + 1).trim();
  return subject === "" ? null : subject;
}

/** Marca `pending` sin contar un intento, tras confirmar el cambio. */
export const markAppointmentSyncPending = internalMutation({
  args: { appointmentId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const appointmentId = normalizeAppointmentId(ctx, args.appointmentId);
    if (appointmentId === null) return null;
    await markSyncPendingRow(ctx, appointmentId);
    return null;
  },
});

/** Registra la referencia del evento tras un éxito en Google. */
export const recordSyncEventReference = internalMutation({
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

/** Registra un intento de sincronización, exitoso o fallido. */
export const recordSyncAttempt = internalMutation({
  args: {
    appointmentId: v.string(),
    status: v.union(v.literal("synced"), v.literal("error")),
    attemptedAt: v.number(),
    errorCode: v.optional(v.union(v.literal("not_connected"), v.literal("unavailable"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const appointmentId = normalizeAppointmentId(ctx, args.appointmentId);
    if (appointmentId === null) return null;
    if (!Number.isFinite(args.attemptedAt) || args.attemptedAt <= 0) return null;
    if (args.status === "synced") {
      await recordSyncAttemptRow(ctx, appointmentId, {
        status: "synced",
        attemptedAt: args.attemptedAt,
      });
      return null;
    }
    if (args.errorCode === undefined) return null;
    await recordSyncAttemptRow(ctx, appointmentId, {
      status: "error",
      attemptedAt: args.attemptedAt,
      errorCode: args.errorCode,
    });
    return null;
  },
});

const syncActionResultValidator = v.union(
  v.object({ status: v.literal("synced"), eventId: v.optional(v.string()) }),
  v.object({
    status: v.literal("error"),
    errorCode: v.union(v.literal("not_connected"), v.literal("unavailable")),
  }),
  v.object({ status: v.literal("skipped") }),
);

/**
 * Sincronización automática en segundo plano (TI2-162).
 *
 * Lee la atención vigente en el momento de ejecutar, así dos cambios seguidos
 * sincronizan la última fecha. Sincroniza al Estudiante dueño y a los
 * profesionales de la atención que tengan vínculo: el `id` determinista evita
 * duplicados en reintentos. Un fallo no deshace la reserva: registra `error`
 * con el código genérico y la atención sigue vigente.
 */
export const syncAppointmentCalendar = internalAction({
  args: { appointmentId: v.string() },
  returns: syncActionResultValidator,
  handler: async (ctx, args) => {
    const loaded: {
      readonly appointmentId: string;
      readonly status: typeof appointmentStatusUnion.type;
      readonly startAt: number;
      readonly endAt: number;
      readonly createdAt: number;
      readonly reference: { readonly eventId: string; readonly addedAt: number } | null;
      readonly referenceIsCurrent: boolean;
      readonly studentSubject: string;
      readonly professionalSubjects: readonly string[];
    } | null = await ctx.runQuery(internal.operations.calendar.loadAppointmentSyncContext, {
      appointmentId: args.appointmentId,
    });
    if (loaded === null) return { status: "skipped" as const };

    const client = calendarOAuthClientConfigFromEnv({
      GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    });
    const subjects = [loaded.studentSubject, ...loaded.professionalSubjects];
    const attemptedAt = Date.now();

    const loadAppointment = async () => ({
      appointmentId: loaded.appointmentId,
      status: loaded.status,
      startAt: loaded.startAt,
      endAt: loaded.endAt,
      createdAt: loaded.createdAt,
      reference: loaded.reference,
      referenceIsCurrent: loaded.referenceIsCurrent,
    });

    let lastError: "not_connected" | "unavailable" | null = null;
    let syncedEventId: string | undefined;
    let attempted = false;

    for (const subject of subjects) {
      const access = await resolveBackgroundCalendarAccess(ctx, subject, client);
      if (access.status !== "ok") {
        lastError = access.status;
        continue;
      }
      attempted = true;
      const gateway = googleCalendarGatewayWithToken(access.accessToken);
      const outcome = await syncAppointmentToGoogleCalendar({
        loadAppointment,
        google: gateway,
        sync: {
          recordEvent: async (input) => {
            await ctx.runMutation(internal.operations.calendar.recordSyncEventReference, input);
          },
          recordSynced: async (input) => {
            await ctx.runMutation(internal.operations.calendar.recordSyncAttempt, {
              appointmentId: args.appointmentId,
              status: "synced",
              attemptedAt: input.attemptedAt,
            });
          },
          recordError: async (input) => {
            await ctx.runMutation(internal.operations.calendar.recordSyncAttempt, {
              appointmentId: args.appointmentId,
              status: "error",
              attemptedAt: input.attemptedAt,
              errorCode: input.errorCode,
            });
          },
        },
        now: () => attemptedAt,
        timeZone: AGENDA_TIME_ZONE,
      });
      if (outcome.status === "error") {
        // Rechazo del contrato común (`unauthorized`, `conflict`): no es un
        // fallo del proveedor y no se registra como `error` de sincronización.
        return { status: "skipped" as const };
      }
      if (outcome.data.status === "error") {
        lastError = outcome.data.errorCode;
        continue;
      }
      syncedEventId = outcome.data.eventId;
      lastError = null;
      break;
    }

    if (!attempted && lastError === null) {
      await ctx.runMutation(internal.operations.calendar.recordSyncAttempt, {
        appointmentId: args.appointmentId,
        status: "error",
        attemptedAt,
        errorCode: "not_connected",
      });
      return { status: "error" as const, errorCode: "not_connected" as const };
    }
    if (lastError !== null) {
      return { status: "error" as const, errorCode: lastError };
    }
    return syncedEventId === undefined
      ? { status: "synced" as const }
      : { status: "synced" as const, eventId: syncedEventId };
  },
});

/**
 * Reintento de sincronizaciones pendientes o con fallo recuperable (TI2-162).
 *
 * Solo reintenta `pending` y `error` con `unavailable`: `not_connected` pide
 * volver a vincular y espera una acción de la persona, no un reintento
 * automático. Lee por el índice de estado con un tope, sin barrer la tabla.
 */
export const scheduleDueCalendarSyncs = internalMutation({
  args: {},
  returns: v.object({ pending: v.number(), retried: v.number() }),
  handler: async (ctx) => {
    const pendingRows = await ctx.db
      .query("appointments")
      .withIndex("by_calendarSyncStatus", (q) => q.eq("calendarSyncStatus", "pending"))
      .take(50);
    let scheduled = 0;
    for (const row of pendingRows) {
      await ctx.scheduler.runAfter(0, internal.operations.calendar.syncAppointmentCalendar, {
        appointmentId: row._id,
      });
      scheduled += 1;
    }
    const errorRows = await ctx.db
      .query("appointments")
      .withIndex("by_calendarSyncStatus", (q) => q.eq("calendarSyncStatus", "error"))
      .take(50);
    let retried = 0;
    for (const row of errorRows) {
      if (row.calendarSyncErrorCode !== "unavailable") continue;
      await ctx.scheduler.runAfter(0, internal.operations.calendar.syncAppointmentCalendar, {
        appointmentId: row._id,
      });
      retried += 1;
    }
    return { pending: scheduled, retried };
  },
});
