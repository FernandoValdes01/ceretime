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
import {
  syncAppointmentToGoogleCalendar,
  type CalendarSyncAccess,
} from "../application/calendar/sync";
import type { PrivacyBlockGuardDeps } from "../application/privacy/blocking";
import {
  checkCalendarLinkAccess as checkCalendarLinkAccessUseCase,
  markCalendarDisconnected as markCalendarDisconnectedUseCase,
} from "../application/calendar/calendar_link";
import { authorizationReader } from "../infrastructure/accompaniments/repository";
import {
  calendarLinkStore,
  readCalendarConnectionMetadata,
} from "../infrastructure/calendar/repository";
import {
  appointmentCalendarReader,
  normalizeAppointmentId,
  recordCalendarEvent,
} from "../infrastructure/appointments/repository";
import { markCalendarSyncPending as markSyncPendingRow } from "../infrastructure/calendar/repository";
import {
  calendarOAuthClientConfigFromEnv,
  deleteCalendarEvent,
  patchCalendarEvent,
  postCalendarEvent,
  resolveBackgroundCalendarAccess,
} from "../infrastructure/calendar/google_calendar";
import { AGENDA_TIME_ZONE } from "../domain/availability/availability";
import { isCalendarActionableStatus } from "../domain/appointments/appointment";
import { appointmentStatusUnion } from "../infrastructure/validators";

/** Tamaño de página del recorrido de atenciones futuras al vincular. */
const LINKED_USER_SYNC_PAGE_SIZE = 50;

/** Espera mínima tras programar antes de que el cron tome un `pending`. */
const SYNC_DISPATCH_GRACE_MS = 60_000;

/** Tope de reintentos de un fallo recuperable antes de dejar de insistir. */
const MAX_SYNC_ATTEMPTS = 10;

/** Espera base entre reintentos, con duplicación y tope de una hora. */
function syncRetryBackoffMs(attempts: number): number {
  const doubled = 5 * 60_000 * 2 ** Math.max(0, attempts - 1);
  return Math.min(doubled, 60 * 60_000);
}

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
 * queda obsoleta, sin confirmar que la nueva fecha está agregada. Resuelve el
 * dueño desde el estudiante de la atención (el flujo explícito solo lo usa
 * él) para que la sincronización use siempre ese calendario.
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
    const doc = await ctx.db.get(appointmentId);
    const student = doc === null ? null : await ctx.db.get(doc.studentId);
    const ownerId = subjectOf(student?.tokenIdentifier ?? null);
    await recordCalendarEvent(ctx, appointmentId, {
      eventId: args.eventId,
      addedAt: args.addedAt,
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      ...(ownerId === null ? {} : { ownerId }),
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
 * `users`, sin aceptar identificadores del cliente. Incluye el dueño del
 * evento y si cada participante vinculó alguna vez, para pedir volver a
 * vincular solo cuando se perdió un permiso. Los tokens se resuelven después por
 * `subject` en la acción, nunca se devuelven.
 */
export const loadAppointmentSyncContext = internalQuery({
  args: { appointmentId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      ...calendarAppointmentContextShape.fields,
      studentId: v.string(),
      ownerId: v.union(v.string(), v.null()),
      participants: v.array(v.object({ subject: v.string(), everLinked: v.boolean() })),
    }),
  ),
  handler: async (ctx, args) => {
    const appointmentId = normalizeAppointmentId(ctx, args.appointmentId);
    if (appointmentId === null) return null;
    const doc = await ctx.db.get(appointmentId);
    if (doc === null) return null;
    const participantIds = [doc.studentId, doc.professionalId];
    const professionals = await ctx.db
      .query("appointmentProfessionals")
      .withIndex("by_appointmentId_and_professionalId", (q) => q.eq("appointmentId", appointmentId))
      .take(10);
    for (const row of professionals) {
      if (!participantIds.some((id) => id === row.professionalId)) {
        participantIds.push(row.professionalId);
      }
    }
    const participants: { readonly subject: string; readonly everLinked: boolean }[] = [];
    const seen = new Set<string>();
    for (const userId of participantIds) {
      const user = await ctx.db.get(userId);
      const subject = subjectOf(user?.tokenIdentifier ?? null);
      if (subject === null || seen.has(subject)) continue;
      seen.add(subject);
      const metadata = await readCalendarConnectionMetadata(ctx, userId);
      participants.push({ subject, everLinked: metadata !== null });
    }
    if (participants.length === 0) return null;
    const reference =
      doc.calendarEventId === undefined
        ? null
        : {
            eventId: doc.calendarEventId,
            addedAt: doc.calendarEventAddedAt ?? 0,
          };
    return {
      appointmentId: doc._id,
      studentId: doc.studentId,
      status: doc.status,
      startAt: doc.startsAt,
      endAt: doc.endsAt,
      createdAt: doc.createdAt,
      reference,
      referenceIsCurrent:
        reference !== null &&
        doc.calendarEventStartsAt === doc.startsAt &&
        doc.calendarEventEndsAt === doc.endsAt,
      ownerId: doc.calendarEventOwnerId ?? null,
      participants,
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
    await markSyncPendingRow(ctx, appointmentId, Date.now());
    return null;
  },
});

const syncExpectationValidator = v.object({
  startsAt: v.number(),
  endsAt: v.number(),
  status: appointmentStatusUnion,
});

const syncOutcomeValidator = v.union(
  v.object({
    kind: v.literal("success"),
    eventId: v.string(),
    ownerId: v.string(),
  }),
  v.object({ kind: v.literal("noop"), eventId: v.optional(v.string()) }),
  v.object({
    kind: v.literal("failure"),
    errorCode: v.union(v.literal("not_connected"), v.literal("unavailable")),
  }),
  v.object({ kind: v.literal("not_linked") }),
  v.object({ kind: v.literal("blocked"), retryAt: v.number() }),
);

/**
 * Registra el resultado de un despacho verificando vigencia (TI2-162).
 *
 * Compara en la misma transacción el horario y el estado esperados con la
 * fila vigente: si otro despacho terminó antes con un cambio más nuevo,
 * responde `stale` sin escribir el resultado viejo. Además limpia el horario
 * registrado y deja `pending`, así el seguimiento no confía la referencia y
 * actualiza Google con lo vigente en vez de confirmar una fecha vieja como
 * sincronizada. La última acción siempre gana.
 */
export const recordCalendarSyncOutcome = internalMutation({
  args: {
    appointmentId: v.string(),
    attemptedAt: v.number(),
    expected: syncExpectationValidator,
    outcome: syncOutcomeValidator,
  },
  returns: v.union(v.literal("recorded"), v.literal("stale"), v.literal("invalid")),
  handler: async (ctx, args) => {
    const appointmentId = normalizeAppointmentId(ctx, args.appointmentId);
    if (appointmentId === null) return "invalid" as const;
    const doc = await ctx.db.get(appointmentId);
    if (doc === null) return "invalid" as const;
    if (!Number.isFinite(args.attemptedAt) || args.attemptedAt <= 0) {
      return "invalid" as const;
    }
    if (
      doc.startsAt !== args.expected.startsAt ||
      doc.endsAt !== args.expected.endsAt ||
      doc.status !== args.expected.status
    ) {
      await ctx.db.patch(appointmentId, {
        calendarSyncStatus: "pending",
        calendarSyncErrorCode: undefined,
        calendarSyncScheduledAt: args.attemptedAt,
        calendarEventStartsAt: undefined,
        calendarEventEndsAt: undefined,
      });
      return "stale" as const;
    }
    if (
      args.outcome.kind === "success" &&
      (args.outcome.eventId.length === 0 ||
        args.outcome.eventId.length > 1024 ||
        args.outcome.ownerId.length === 0)
    ) {
      return "invalid" as const;
    }
    const attempts = (doc.calendarSyncAttempts ?? 0) + 1;
    if (args.outcome.kind === "failure") {
      await ctx.db.patch(appointmentId, {
        calendarSyncStatus: "error",
        calendarSyncAttempts: attempts,
        calendarSyncLastAttemptAt: args.attemptedAt,
        calendarSyncErrorCode: args.outcome.errorCode,
        calendarSyncFailures: (doc.calendarSyncFailures ?? 0) + 1,
      });
      return "recorded" as const;
    }
    if (args.outcome.kind === "not_linked") {
      await ctx.db.patch(appointmentId, {
        calendarSyncStatus: "not_linked",
        calendarSyncAttempts: attempts,
        calendarSyncLastAttemptAt: args.attemptedAt,
        calendarSyncErrorCode: undefined,
        calendarSyncFailures: 0,
      });
      return "recorded" as const;
    }
    if (args.outcome.kind === "blocked") {
      // El bloqueo suspende el tratamiento: la fila sigue pendiente y vuelve
      // a programarse al terminar, sin marcar `synced` ni borrar la referencia.
      await ctx.db.patch(appointmentId, {
        calendarSyncStatus: "pending",
        calendarSyncLastAttemptAt: args.attemptedAt,
        calendarSyncErrorCode: undefined,
        calendarSyncScheduledAt: args.outcome.retryAt,
        calendarEventStartsAt: undefined,
        calendarEventEndsAt: undefined,
      });
      return "recorded" as const;
    }
    await ctx.db.patch(appointmentId, {
      calendarSyncStatus: "synced",
      calendarSyncAttempts: attempts,
      calendarSyncLastAttemptAt: args.attemptedAt,
      calendarSyncErrorCode: undefined,
      calendarSyncFailures: 0,
      ...(args.outcome.kind === "success"
        ? {
            calendarEventId: args.outcome.eventId,
            calendarEventAddedAt: args.attemptedAt,
            calendarEventStartsAt: args.expected.startsAt,
            calendarEventEndsAt: args.expected.endsAt,
            calendarEventOwnerId: args.outcome.ownerId,
          }
        : {}),
    });
    return "recorded" as const;
  },
});

/** Registra un estado terminal que no pide nada (TI2-162). */
export const markCalendarSyncNotLinked = internalMutation({
  args: { appointmentId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const appointmentId = normalizeAppointmentId(ctx, args.appointmentId);
    if (appointmentId === null) return null;
    const doc = await ctx.db.get(appointmentId);
    if (doc === null) return null;
    await ctx.db.patch(appointmentId, {
      calendarSyncStatus: "not_linked",
      calendarSyncErrorCode: undefined,
      calendarSyncFailures: 0,
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
  v.object({ status: v.literal("pending") }),
  v.object({ status: v.literal("skipped") }),
);

/**
 * Sincronización automática en segundo plano (TI2-162).
 *
 * Lee la atención vigente en el momento de ejecutar, así dos cambios seguidos
 * sincronizan la última fecha. Con referencia usa siempre el calendario del
 * dueño; sin referencia prueba los participantes en orden y el primero con
 * éxito queda como dueño. Eliminar prueba todos los calendarios con acceso.
 * Cuando nadie vinculó queda registrado como `not_linked` sin pedir nada; con
 * vínculo perdido responde `not_connected` y con fallo temporal `unavailable`. Un fallo no
 * deshace la reserva: registra `error` con el código genérico y la atención
 * sigue vigente.
 */
export const syncAppointmentCalendar = internalAction({
  args: { appointmentId: v.string() },
  returns: syncActionResultValidator,
  handler: async (ctx, args) => {
    const loaded: {
      readonly appointmentId: string;
      readonly studentId: string;
      readonly status: typeof appointmentStatusUnion.type;
      readonly startAt: number;
      readonly endAt: number;
      readonly createdAt: number;
      readonly reference: { readonly eventId: string; readonly addedAt: number } | null;
      readonly referenceIsCurrent: boolean;
      readonly ownerId: string | null;
      readonly participants: readonly { readonly subject: string; readonly everLinked: boolean }[];
    } | null = await ctx.runQuery(internal.operations.calendar.loadAppointmentSyncContext, {
      appointmentId: args.appointmentId,
    });
    if (loaded === null) {
      // Sin atención o sin sujeto no hay nada que sincronizar: estado terminal
      // que no pide nada y que el reintento no vuelve a programar.
      await ctx.runMutation(internal.operations.calendar.markCalendarSyncNotLinked, {
        appointmentId: args.appointmentId,
      });
      return { status: "skipped" as const };
    }

    const client = calendarOAuthClientConfigFromEnv({
      GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    });
    const attemptedAt = Date.now();
    const everLinkedBySubject = new Map(
      loaded.participants.map((participant) => [participant.subject, participant.everLinked]),
    );

    const privacyGuard: PrivacyBlockGuardDeps<string> = {
      blocks: {
        listActiveBlocksForSubject: (subjectId, now) =>
          ctx.runQuery(internal.operations.notifications.listActivePrivacyBlocks, {
            subjectId,
            now,
          }),
      },
      now: () => attemptedAt,
    };
    const outcome = await syncAppointmentToGoogleCalendar({
      loadAppointment: async () => ({
        appointmentId: loaded.appointmentId,
        studentId: loaded.studentId,
        status: loaded.status,
        startAt: loaded.startAt,
        endAt: loaded.endAt,
        createdAt: loaded.createdAt,
        reference: loaded.reference,
        referenceIsCurrent: loaded.referenceIsCurrent,
        ownerId: loaded.ownerId,
        participants: [...loaded.participants],
      }),
      resolveAccess: async (subject): Promise<CalendarSyncAccess> => {
        const access = await resolveBackgroundCalendarAccess(
          ctx,
          subject,
          client,
          everLinkedBySubject.get(subject) ?? false,
        );
        return access;
      },
      calendarApi: (accessToken) => ({
        createEvent: (input) => postCalendarEvent(accessToken, input),
        updateEvent: (input) => patchCalendarEvent(accessToken, input),
        deleteEvent: (input) => deleteCalendarEvent(accessToken, input),
      }),
      store: {
        record: async (input) => {
          const stored: "recorded" | "stale" | "invalid" = await ctx.runMutation(
            internal.operations.calendar.recordCalendarSyncOutcome,
            {
              appointmentId: input.appointmentId,
              attemptedAt: input.attemptedAt,
              expected: { ...input.expected },
              outcome: input.outcome,
            },
          );
          return stored === "recorded" ? "recorded" : "stale";
        },
      },
      reschedule: async () => {
        await ctx.scheduler.runAfter(0, internal.operations.calendar.syncAppointmentCalendar, {
          appointmentId: args.appointmentId,
        });
      },
      now: () => attemptedAt,
      timeZone: AGENDA_TIME_ZONE,
      privacy: privacyGuard,
    });
    if (outcome.status === "error") {
      // Rechazo del contrato común (`unauthorized`, `conflict`): no es un
      // fallo del proveedor; queda terminal sin pedir nada ni reintentar.
      await ctx.runMutation(internal.operations.calendar.markCalendarSyncNotLinked, {
        appointmentId: args.appointmentId,
      });
      return { status: "skipped" as const };
    }
    if (outcome.data.status === "synced") {
      return outcome.data.eventId === undefined
        ? { status: "synced" as const }
        : { status: "synced" as const, eventId: outcome.data.eventId };
    }
    if (outcome.data.status === "error") {
      return { status: "error" as const, errorCode: outcome.data.errorCode };
    }
    return { status: "pending" as const };
  },
});

/**
 * Reintento de sincronizaciones pendientes o con fallo recuperable (TI2-162).
 *
 * Solo reintenta `pending` cuyo despacho ya debería haber corrido (gracia de un
 * minuto, para no duplicar uno en curso) y `error` con `unavailable` con
 * espera creciente y tope de intentos. `not_connected` pide volver a vincular
 * y espera una acción de la persona, no un reintento automático. Lee por los
 * índices de estado ordenado por el intento más antiguo, sin barrer la tabla.
 */
export const scheduleDueCalendarSyncs = internalMutation({
  args: {},
  returns: v.object({ pending: v.number(), retried: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const pendingRows = await ctx.db
      .query("appointments")
      .withIndex("by_calendarSyncStatus_and_scheduledAt", (q) =>
        q
          .eq("calendarSyncStatus", "pending")
          .lt("calendarSyncScheduledAt", now - SYNC_DISPATCH_GRACE_MS),
      )
      .order("asc")
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
      .withIndex("by_calendarSyncStatus_and_lastAttemptAt", (q) =>
        q.eq("calendarSyncStatus", "error"),
      )
      .order("asc")
      .take(50);
    let retried = 0;
    for (const row of errorRows) {
      if (row.calendarSyncErrorCode !== "unavailable") continue;
      const failures = row.calendarSyncFailures ?? row.calendarSyncAttempts ?? 0;
      if (failures >= MAX_SYNC_ATTEMPTS) continue;
      if ((row.calendarSyncLastAttemptAt ?? 0) > now - syncRetryBackoffMs(failures)) continue;
      await ctx.scheduler.runAfter(0, internal.operations.calendar.syncAppointmentCalendar, {
        appointmentId: row._id,
      });
      retried += 1;
    }
    return { pending: scheduled, retried };
  },
});

const linkedUserSyncPhaseValidator = v.union(
  v.literal("student"),
  v.literal("responsible"),
  v.literal("additional"),
);

const nextStepValidator = v.union(
  v.null(),
  v.object({
    phase: linkedUserSyncPhaseValidator,
    cursor: v.union(v.string(), v.null()),
  }),
);

/**
 * Recorrido por páginas de las atenciones futuras vigentes al confirmar el
 * vínculo (TI2-162).
 *
 * Pagina por estudiante dueño, por profesional responsable y por profesional
 * adicional (`appointmentProfessionals`), marcando `pending` y programando
 * cada futura vigente. Si una página no termina, programa la siguiente: la
 * confirmación del vínculo sigue liviana y no se trunca ninguna atención.
 */
export const scheduleLinkedUserSyncs = internalMutation({
  args: {
    userId: v.string(),
    now: v.number(),
    phase: linkedUserSyncPhaseValidator,
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({
    scheduled: v.number(),
    done: v.boolean(),
    next: nextStepValidator,
  }),
  handler: async (ctx, args) => {
    const userId = ctx.db.normalizeId("users", args.userId);
    if (userId === null || !Number.isFinite(args.now)) {
      return { scheduled: 0, done: true, next: null };
    }
    const scheduledAt = Date.now();
    let scheduled = 0;
    const enqueueIfEligible = async (
      appointmentId: typeof userId extends never ? never : string,
    ) => {
      const id = normalizeAppointmentId(ctx, appointmentId);
      if (id === null) return;
      const doc = await ctx.db.get(id);
      if (doc === null) return;
      if (!isCalendarActionableStatus(doc.status) || doc.startsAt < args.now) return;
      if (
        doc.calendarSyncStatus === "synced" &&
        doc.calendarEventId !== undefined &&
        doc.calendarEventStartsAt === doc.startsAt &&
        doc.calendarEventEndsAt === doc.endsAt
      ) {
        return;
      }
      await markSyncPendingRow(ctx, id, scheduledAt);
      await ctx.scheduler.runAfter(0, internal.operations.calendar.syncAppointmentCalendar, {
        appointmentId: id,
      });
      scheduled += 1;
    };

    const advance = async (next: {
      readonly phase: "student" | "responsible" | "additional";
      readonly cursor: string | null;
    }) => {
      await ctx.scheduler.runAfter(0, internal.operations.calendar.scheduleLinkedUserSyncs, {
        userId: args.userId,
        now: args.now,
        phase: next.phase,
        cursor: next.cursor,
      });
      return { scheduled, done: false, next };
    };

    if (args.phase === "student") {
      const page = await ctx.db
        .query("appointments")
        .withIndex("by_studentId_and_startsAt", (q) =>
          q.eq("studentId", userId).gte("startsAt", args.now),
        )
        .order("asc")
        .paginate({ numItems: LINKED_USER_SYNC_PAGE_SIZE, cursor: args.cursor });
      for (const row of page.page) {
        await enqueueIfEligible(row._id);
      }
      return await advance({
        phase: page.isDone ? "responsible" : "student",
        cursor: page.isDone ? null : page.continueCursor,
      });
    }

    if (args.phase === "responsible") {
      const page = await ctx.db
        .query("appointments")
        .withIndex("by_professionalId_and_startsAt", (q) =>
          q.eq("professionalId", userId).gte("startsAt", args.now),
        )
        .order("asc")
        .paginate({ numItems: LINKED_USER_SYNC_PAGE_SIZE, cursor: args.cursor });
      for (const row of page.page) {
        await enqueueIfEligible(row._id);
      }
      return await advance({
        phase: page.isDone ? "additional" : "responsible",
        cursor: page.isDone ? null : page.continueCursor,
      });
    }

    const page = await ctx.db
      .query("appointmentProfessionals")
      .withIndex("by_professionalId", (q) => q.eq("professionalId", userId))
      .paginate({ numItems: LINKED_USER_SYNC_PAGE_SIZE, cursor: args.cursor });
    for (const row of page.page) {
      const doc = await ctx.db.get(row.appointmentId);
      // Si ya es responsable, el segundo tramo lo tomó: acá solo adicionales.
      if (doc === null || doc.professionalId === userId) continue;
      await enqueueIfEligible(row.appointmentId);
    }
    if (!page.isDone) {
      return await advance({ phase: "additional", cursor: page.continueCursor });
    }
    return { scheduled, done: true, next: null };
  },
});
