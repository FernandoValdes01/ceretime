import { describe, expect, test } from "vitest";
import {
  syncAppointmentToGoogleCalendar,
  type CalendarSyncAccess,
  type CalendarSyncAppointmentContext,
  type CalendarSyncGateway,
  type CalendarSyncStore,
  type GoogleCalendarSyncCreateOutcome,
} from "./sync";

const START_AT = Date.UTC(2026, 2, 10, 16, 0, 0);
const END_AT = Date.UTC(2026, 2, 10, 17, 0, 0);
const CREATED_AT = Date.UTC(2026, 2, 1, 12, 0, 0);
const NOW = Date.UTC(2026, 2, 10, 15, 0, 0);

const STUDENT = "subject-student";
const PRO = "subject-pro";

function participant(subject: string, everLinked = true) {
  return { subject, everLinked };
}

function context(
  overrides: Partial<CalendarSyncAppointmentContext> = {},
): CalendarSyncAppointmentContext {
  return {
    appointmentId: "appointment-1",
    status: "scheduled",
    startAt: START_AT,
    endAt: END_AT,
    createdAt: CREATED_AT,
    reference: null,
    referenceIsCurrent: false,
    ownerId: null,
    participants: [participant(STUDENT), participant(PRO)],
    ...overrides,
  };
}

/** Fila vigente simulada: el almacén verifica como la mutación real. */
function fakeStore(row: { startsAt: number; endsAt: number; status: string }) {
  const recorded: unknown[] = [];
  let reschedules = 0;
  const store: CalendarSyncStore = {
    record: async (input) => {
      if (
        row.startsAt !== input.expected.startsAt ||
        row.endsAt !== input.expected.endsAt ||
        row.status !== input.expected.status
      ) {
        return "stale";
      }
      recorded.push(input.outcome);
      return "recorded";
    },
  };
  return {
    store,
    recorded,
    reschedule: async () => {
      reschedules += 1;
    },
    reschedules: () => reschedules,
  };
}

function fakeApi(
  outcomes: {
    readonly create?: GoogleCalendarSyncCreateOutcome;
    readonly failWith?: "not_connected" | "unavailable";
    readonly deleted?: boolean;
  } = {},
) {
  const calls: { readonly op: string; readonly token: string; readonly id: string }[] = [];
  const api = (token: string): CalendarSyncGateway => ({
    createEvent: async (input) => {
      calls.push({ op: "create", token, id: input.googleEventId });
      if (outcomes.failWith !== undefined) return { status: outcomes.failWith };
      if (outcomes.create !== undefined) return outcomes.create;
      return { status: "created", eventId: input.googleEventId };
    },
    updateEvent: async (input) => {
      calls.push({ op: "update", token, id: input.googleEventId });
      if (outcomes.failWith !== undefined) return { status: outcomes.failWith };
      return { status: "updated", eventId: input.googleEventId };
    },
    deleteEvent: async (input) => {
      calls.push({ op: "delete", token, id: input.googleEventId });
      if (outcomes.failWith !== undefined) return { status: outcomes.failWith };
      if (outcomes.deleted === false) return { status: "not_found", eventId: input.googleEventId };
      return { status: "deleted", eventId: input.googleEventId };
    },
  });
  return { api, calls };
}

function accessFor(entries: Record<string, CalendarSyncAccess>) {
  const seen: string[] = [];
  return {
    seen,
    resolve: async (subject: string): Promise<CalendarSyncAccess> => {
      seen.push(subject);
      return entries[subject] ?? { status: "never_linked" as const };
    },
  };
}

function okToken(token: string): CalendarSyncAccess {
  return { status: "ok", accessToken: token };
}

function depsFor(
  loaded: CalendarSyncAppointmentContext | null,
  options: {
    readonly access?: Record<string, CalendarSyncAccess>;
    readonly apiOutcomes?: Parameters<typeof fakeApi>[0];
    readonly row?: { startsAt: number; endsAt: number; status: string };
    readonly now?: number;
  } = {},
) {
  const row = options.row ?? { startsAt: START_AT, endsAt: END_AT, status: loaded?.status ?? "" };
  const store = fakeStore(row);
  const api = fakeApi(options.apiOutcomes);
  const access = accessFor(options.access ?? { [STUDENT]: okToken("token-student") });
  return {
    deps: {
      loadAppointment: async () => loaded,
      resolveAccess: access.resolve,
      calendarApi: api.api,
      store: store.store,
      reschedule: store.reschedule,
      now: () => options.now ?? NOW,
      timeZone: "America/Santiago",
    },
    calls: api.calls,
    seen: access.seen,
    recorded: store.recorded,
    reschedules: store.reschedules,
  };
}

describe("sincronización automática con Calendar (TI2-162)", () => {
  test("crea el evento al reservar y guarda al dueño", async () => {
    const { deps, calls, recorded } = depsFor(context());
    const result = await syncAppointmentToGoogleCalendar(deps);
    expect(result).toEqual({
      status: "ok",
      data: { status: "synced", eventId: expect.any(String) },
    });
    expect(calls.filter((call) => call.op === "create")).toHaveLength(1);
    expect(recorded).toEqual([{ kind: "success", eventId: expect.any(String), ownerId: STUDENT }]);
  });

  test("actualiza el mismo evento en el calendario del dueño", async () => {
    const newStart = START_AT + 24 * 60 * 60_000;
    const loaded = context({
      status: "rescheduled",
      startAt: newStart,
      endAt: newStart + 60 * 60_000,
      reference: { eventId: "event-1", addedAt: CREATED_AT },
      referenceIsCurrent: false,
      ownerId: PRO,
      participants: [participant(STUDENT, false), participant(PRO)],
    });
    const { deps, calls, seen, recorded } = depsFor(loaded, {
      access: { [PRO]: okToken("token-pro") },
      row: { startsAt: newStart, endsAt: newStart + 60 * 60_000, status: "rescheduled" },
    });
    const result = await syncAppointmentToGoogleCalendar(deps);
    expect(result).toEqual({ status: "ok", data: { status: "synced", eventId: "event-1" } });
    expect(seen).toEqual([PRO]);
    expect(calls).toEqual([{ op: "update", token: "token-pro", id: "event-1" }]);
    expect(recorded).toEqual([{ kind: "success", eventId: "event-1", ownerId: PRO }]);
  });

  test("no llama a Google si la referencia ya está vigente", async () => {
    const loaded = context({
      reference: { eventId: "event-1", addedAt: CREATED_AT },
      referenceIsCurrent: true,
      ownerId: STUDENT,
    });
    const { deps, calls } = depsFor(loaded, {
      row: { startsAt: START_AT, endsAt: END_AT, status: "scheduled" },
    });
    const result = await syncAppointmentToGoogleCalendar(deps);
    expect(result).toEqual({ status: "ok", data: { status: "synced", eventId: "event-1" } });
    expect(calls).toHaveLength(0);
  });

  test("elimina el evento al cancelar en el calendario del dueño", async () => {
    const loaded = context({
      status: "cancelled_by_student",
      reference: { eventId: "event-1", addedAt: CREATED_AT },
      referenceIsCurrent: true,
      ownerId: STUDENT,
    });
    const { deps, calls, seen } = depsFor(loaded, {
      row: { startsAt: START_AT, endsAt: END_AT, status: "cancelled_by_student" },
    });
    const result = await syncAppointmentToGoogleCalendar(deps);
    expect(result).toEqual({ status: "ok", data: { status: "synced", eventId: "event-1" } });
    expect(seen).toEqual([STUDENT]);
    expect(calls).toEqual([{ op: "delete", token: "token-student", id: "event-1" }]);
  });

  test("cancelar sin referencia no toca Google y queda sincronizado", async () => {
    const loaded = context({ status: "cancelled_by_cereti", reference: null });
    const { deps, calls } = depsFor(loaded, {
      row: { startsAt: START_AT, endsAt: END_AT, status: "cancelled_by_cereti" },
    });
    const result = await syncAppointmentToGoogleCalendar(deps);
    expect(result).toEqual({ status: "ok", data: { status: "synced" } });
    expect(calls).toHaveLength(0);
  });

  test("una atención realizada no toca Google y queda sincronizada", async () => {
    const loaded = context({ status: "completed" });
    const { deps, calls } = depsFor(loaded, {
      row: { startsAt: START_AT, endsAt: END_AT, status: "completed" },
    });
    const result = await syncAppointmentToGoogleCalendar(deps);
    expect(result).toEqual({ status: "ok", data: { status: "synced" } });
    expect(calls).toHaveLength(0);
  });

  test("`not_connected` pide volver a vincular y `unavailable` permite reintentar", async () => {
    for (const code of ["not_connected", "unavailable"] as const) {
      const { deps, recorded } = depsFor(context(), {
        access: { [STUDENT]: { status: code }, [PRO]: { status: code } },
      });
      const result = await syncAppointmentToGoogleCalendar(deps);
      expect(result).toEqual({ status: "ok", data: { status: "error", errorCode: code } });
      expect(recorded).toEqual([{ kind: "failure", errorCode: code }]);
    }
  });

  test("cuando nadie vinculó queda registrado sin pedir nada", async () => {
    const { deps, recorded, reschedules } = depsFor(context(), { access: {} });
    const result = await syncAppointmentToGoogleCalendar(deps);
    expect(result).toEqual({ status: "ok", data: { status: "pending" } });
    expect(recorded).toEqual([{ kind: "not_linked" }]);
    expect(reschedules()).toBe(0);
  });

  test("`unavailable` prima sobre `not_connected`", async () => {
    const { deps, recorded } = depsFor(context(), {
      access: {
        [STUDENT]: { status: "unavailable" },
        [PRO]: { status: "not_connected" },
      },
    });
    const result = await syncAppointmentToGoogleCalendar(deps);
    expect(result).toEqual({
      status: "ok",
      data: { status: "error", errorCode: "unavailable" },
    });
    expect(recorded).toEqual([{ kind: "failure", errorCode: "unavailable" }]);
  });

  test("con dueño conocido, perder el vínculo pide volver a vincular", async () => {
    const loaded = context({
      status: "rescheduled",
      startAt: START_AT + 24 * 60 * 60_000,
      endAt: END_AT + 24 * 60 * 60_000,
      reference: { eventId: "event-1", addedAt: CREATED_AT },
      referenceIsCurrent: false,
      ownerId: STUDENT,
    });
    const { deps } = depsFor(loaded, {
      access: {},
      row: {
        startsAt: START_AT + 24 * 60 * 60_000,
        endsAt: END_AT + 24 * 60 * 60_000,
        status: "rescheduled",
      },
    });
    const result = await syncAppointmentToGoogleCalendar(deps);
    expect(result).toEqual({
      status: "ok",
      data: { status: "error", errorCode: "not_connected" },
    });
  });

  test("`already_exists` actualiza al horario vigente antes de registrar", async () => {
    const newStart = START_AT + 24 * 60 * 60_000;
    const loaded = context({ startAt: newStart, endAt: newStart + 60 * 60_000 });
    const { deps, calls, recorded } = depsFor(loaded, {
      apiOutcomes: {
        create: { status: "already_exists", eventId: "event-1" },
      },
      row: { startsAt: newStart, endsAt: newStart + 60 * 60_000, status: "scheduled" },
    });
    const result = await syncAppointmentToGoogleCalendar(deps);
    expect(result).toEqual({ status: "ok", data: { status: "synced", eventId: "event-1" } });
    expect(calls.map((call) => call.op)).toEqual(["create", "update"]);
    expect(recorded).toEqual([{ kind: "success", eventId: "event-1", ownerId: STUDENT }]);
  });

  test("eliminar prueba todos los calendarios con acceso (legado sin dueño)", async () => {
    const loaded = context({
      status: "cancelled_by_cereti",
      reference: { eventId: "event-9", addedAt: CREATED_AT },
      referenceIsCurrent: true,
      ownerId: null,
    });
    const { deps, calls, seen } = depsFor(loaded, {
      access: { [STUDENT]: { status: "unavailable" }, [PRO]: okToken("token-pro") },
      row: { startsAt: START_AT, endsAt: END_AT, status: "cancelled_by_cereti" },
    });
    const result = await syncAppointmentToGoogleCalendar(deps);
    expect(result).toEqual({ status: "ok", data: { status: "synced", eventId: "event-9" } });
    expect(seen).toEqual([STUDENT, PRO]);
    expect(calls).toEqual([{ op: "delete", token: "token-pro", id: "event-9" }]);
  });

  test("eliminar sigue al próximo calendario si el primero no tiene el evento", async () => {
    const loaded = context({
      status: "cancelled_by_cereti",
      reference: { eventId: "event-9", addedAt: CREATED_AT },
      referenceIsCurrent: true,
      ownerId: null,
    });
    const order: string[] = [];
    const api = (token: string): CalendarSyncGateway => ({
      createEvent: async (input) => ({ status: "created", eventId: input.googleEventId }),
      updateEvent: async (input) => ({ status: "updated", eventId: input.googleEventId }),
      deleteEvent: async (input) => {
        order.push(token);
        if (token === "token-student") {
          return { status: "not_found", eventId: input.googleEventId };
        }
        return { status: "deleted", eventId: input.googleEventId };
      },
    });
    const access = accessFor({ [STUDENT]: okToken("token-student"), [PRO]: okToken("token-pro") });
    const row = { startsAt: START_AT, endsAt: END_AT, status: "cancelled_by_cereti" };
    const store = fakeStore(row);
    const result = await syncAppointmentToGoogleCalendar({
      loadAppointment: async () => loaded,
      resolveAccess: access.resolve,
      calendarApi: api,
      store: store.store,
      reschedule: store.reschedule,
      now: () => NOW,
      timeZone: "America/Santiago",
    });
    expect(result).toEqual({ status: "ok", data: { status: "synced", eventId: "event-9" } });
    expect(order).toEqual(["token-student", "token-pro"]);
    expect(store.recorded).toEqual([{ kind: "noop", eventId: "event-9" }]);
  });

  test("sin dueño, `not_found` más `unavailable` deja error recuperable", async () => {
    const loaded = context({
      status: "cancelled_by_cereti",
      reference: { eventId: "event-9", addedAt: CREATED_AT },
      referenceIsCurrent: true,
      ownerId: null,
    });
    const api = (token: string): CalendarSyncGateway => ({
      createEvent: async (input) => ({ status: "created", eventId: input.googleEventId }),
      updateEvent: async (input) => ({ status: "updated", eventId: input.googleEventId }),
      deleteEvent: async (input) => {
        if (token === "token-student") {
          return { status: "not_found", eventId: input.googleEventId };
        }
        return { status: "unavailable" };
      },
    });
    const access = accessFor({ [STUDENT]: okToken("token-student"), [PRO]: okToken("token-pro") });
    const row = { startsAt: START_AT, endsAt: END_AT, status: "cancelled_by_cereti" };
    const store = fakeStore(row);
    const result = await syncAppointmentToGoogleCalendar({
      loadAppointment: async () => loaded,
      resolveAccess: access.resolve,
      calendarApi: api,
      store: store.store,
      reschedule: store.reschedule,
      now: () => NOW,
      timeZone: "America/Santiago",
    });
    expect(result).toEqual({
      status: "ok",
      data: { status: "error", errorCode: "unavailable" },
    });
    expect(store.recorded).toEqual([{ kind: "failure", errorCode: "unavailable" }]);
  });

  test("dos despachos: el viejo no pisa al nuevo y el siguiente repara Google", async () => {
    const newStart = START_AT + 60 * 60_000;
    const newEnd = newStart + 60 * 60_000;
    // Fila que ya avanzó: otro despacho terminó primero con el horario nuevo.
    const row: {
      startsAt: number;
      endsAt: number;
      status: string;
      refEventId?: string;
      refStartsAt?: number;
      refEndsAt?: number;
    } = { startsAt: newStart, endsAt: newEnd, status: "rescheduled" };
    const loadFresh = async (): Promise<CalendarSyncAppointmentContext> => ({
      appointmentId: "appointment-1",
      status: row.status as CalendarSyncAppointmentContext["status"],
      startAt: row.startsAt,
      endAt: row.endsAt,
      createdAt: CREATED_AT,
      reference:
        row.refEventId === undefined ? null : { eventId: row.refEventId, addedAt: CREATED_AT },
      referenceIsCurrent:
        row.refEventId !== undefined &&
        row.refStartsAt === row.startsAt &&
        row.refEndsAt === row.endsAt,
      ownerId: null,
      participants: [participant(STUDENT), participant(PRO)],
    });
    const recorded: unknown[] = [];
    let reschedules = 0;
    const store: CalendarSyncStore = {
      record: async (input) => {
        if (
          row.startsAt !== input.expected.startsAt ||
          row.endsAt !== input.expected.endsAt ||
          row.status !== input.expected.status
        ) {
          // Como la mutación real: limpia y deja pendiente para reparar.
          row.refStartsAt = undefined;
          row.refEndsAt = undefined;
          return "stale";
        }
        recorded.push(input.outcome);
        if (input.outcome.kind === "success") {
          row.refEventId = input.outcome.eventId;
          row.refStartsAt = input.expected.startsAt;
          row.refEndsAt = input.expected.endsAt;
        }
        return "recorded";
      },
    };
    const access = accessFor({ [STUDENT]: okToken("token-student") });
    // Google real: el `id` determinista hace que el segundo crear responda
    // `already_exists` y el turno actualice al horario vigente.
    const seenIds = new Set<string>();
    const googleCalls: string[] = [];
    const statefulApi = (_token: string): CalendarSyncGateway => ({
      createEvent: async (input) => {
        googleCalls.push(`create@${input.startAt}`);
        if (seenIds.has(input.googleEventId)) {
          return { status: "already_exists", eventId: input.googleEventId };
        }
        seenIds.add(input.googleEventId);
        return { status: "created", eventId: input.googleEventId };
      },
      updateEvent: async (input) => {
        googleCalls.push(`update@${input.startAt}`);
        return { status: "updated", eventId: input.googleEventId };
      },
      deleteEvent: async (input) => {
        googleCalls.push(`delete@${input.googleEventId}`);
        return { status: "deleted", eventId: input.googleEventId };
      },
    });
    const runWith = (loaded: CalendarSyncAppointmentContext) =>
      syncAppointmentToGoogleCalendar({
        loadAppointment: async () => loaded,
        resolveAccess: access.resolve,
        calendarApi: statefulApi,
        store,
        reschedule: async () => {
          reschedules += 1;
        },
        now: () => NOW,
        timeZone: "America/Santiago",
      });

    // Despacho viejo con el horario anterior: no escribe y pide seguimiento.
    const staleResult = await runWith(context());
    expect(staleResult).toEqual({ status: "ok", data: { status: "pending" } });
    expect(recorded).toHaveLength(0);
    expect(reschedules).toBe(1);

    // Seguimiento con lo vigente: Google termina con el horario nuevo.
    const freshResult = await runWith(await loadFresh());
    expect(freshResult).toEqual({
      status: "ok",
      data: { status: "synced", eventId: expect.any(String) },
    });
    expect(googleCalls).toEqual([`create@${START_AT}`, `create@${newStart}`, `update@${newStart}`]);
    expect(recorded).toEqual([{ kind: "success", eventId: expect.any(String), ownerId: STUDENT }]);
  });

  test("rechaza con códigos del contrato común, nunca con texto", async () => {
    const { deps } = depsFor(null);
    const missing = await syncAppointmentToGoogleCalendar(deps);
    expect(missing).toEqual({
      status: "error",
      error: { code: "unauthorized", message: "No autorizado" },
    });
    const invalid = await syncAppointmentToGoogleCalendar({
      ...deps,
      loadAppointment: async () => context(),
      now: () => Number.NaN,
    });
    expect(invalid).toEqual({
      status: "error",
      error: { code: "conflict", message: expect.any(String) },
    });
  });
});

describe("bloqueo de privacidad en la sincronización con Calendar (TI2-168)", () => {
  function blockedGuard(
    subject: string,
  ): import("../privacy/blocking").PrivacyBlockGuardDeps<string> {
    return {
      blocks: {
        listActiveBlocksForSubject: async (id) =>
          id === subject
            ? [
                {
                  id: "block-calendar",
                  scope: "calendar",
                  startsAt: NOW - 1000,
                  endsAt: NOW + 1000,
                },
              ]
            : [],
      },
      now: () => NOW,
    };
  }

  test("un bloqueo vigente impide crear el evento y deja la fila pendiente hasta su término", async () => {
    const { deps, calls, recorded, reschedules } = depsFor(context(), {
      access: { [STUDENT]: okToken("token-student") },
    });

    const result = await syncAppointmentToGoogleCalendar({
      ...deps,
      privacy: blockedGuard(STUDENT),
    });

    expect(result).toEqual({ status: "ok", data: { status: "pending" } });
    expect(calls).toHaveLength(0);
    expect(recorded).toEqual([{ kind: "blocked", retryAt: NOW + 1000 }]);
    expect(reschedules()).toBe(0);
  });

  test("con el dueño bloqueado tampoco se actualiza el evento existente", async () => {
    const { deps, calls, recorded } = depsFor(
      context({
        ownerId: STUDENT,
        reference: { eventId: "event-1", addedAt: CREATED_AT },
        referenceIsCurrent: false,
      }),
      { access: { [STUDENT]: okToken("token-student") } },
    );

    const result = await syncAppointmentToGoogleCalendar({
      ...deps,
      privacy: blockedGuard(STUDENT),
    });

    expect(result).toEqual({ status: "ok", data: { status: "pending" } });
    expect(calls).toHaveLength(0);
    expect(recorded).toEqual([{ kind: "blocked", retryAt: NOW + 1000 }]);
  });

  test("sin bloqueo la sincronización escribe y guarda al dueño como antes", async () => {
    const { deps, calls, recorded } = depsFor(context(), {
      access: { [STUDENT]: okToken("token-student") },
    });
    const guard: import("../privacy/blocking").PrivacyBlockGuardDeps<string> = {
      blocks: { listActiveBlocksForSubject: async () => [] },
      now: () => NOW,
    };

    const result = await syncAppointmentToGoogleCalendar({ ...deps, privacy: guard });

    expect(result).toEqual({
      status: "ok",
      data: { status: "synced", eventId: expect.any(String) },
    });
    expect(calls.filter((call) => call.op === "create")).toHaveLength(1);
    expect(recorded).toEqual([{ kind: "success", eventId: expect.any(String), ownerId: STUDENT }]);
  });
});
