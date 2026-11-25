import { describe, expect, test } from "vitest";
import {
  syncAppointmentToGoogleCalendar,
  type CalendarSyncGoogleGateway,
  type CalendarSyncRecorder,
} from "./sync";
import type { CalendarAppointmentContext } from "./calendar";

const START_AT = Date.UTC(2026, 2, 10, 16, 0, 0);
const END_AT = Date.UTC(2026, 2, 10, 17, 0, 0);
const CREATED_AT = Date.UTC(2026, 2, 1, 12, 0, 0);
const NOW = Date.UTC(2026, 2, 10, 15, 0, 0);

function context(overrides: Partial<CalendarAppointmentContext> = {}): CalendarAppointmentContext {
  return {
    appointmentId: "appointment-1",
    status: "scheduled",
    startAt: START_AT,
    endAt: END_AT,
    createdAt: CREATED_AT,
    reference: null,
    referenceIsCurrent: false,
    ...overrides,
  };
}

function fakeRecorder() {
  const events: {
    readonly appointmentId: string;
    readonly eventId: string;
    readonly addedAt: number;
    readonly startsAt: number;
    readonly endsAt: number;
  }[] = [];
  const synced: number[] = [];
  const errors: { readonly attemptedAt: number; readonly errorCode: string }[] = [];
  const recorder: CalendarSyncRecorder = {
    recordEvent: async (input) => {
      events.push(input);
    },
    recordSynced: async (input) => {
      synced.push(input.attemptedAt);
    },
    recordError: async (input) => {
      errors.push(input);
    },
  };
  return { recorder, events, synced, errors };
}

function fakeGateway(
  overrides: Partial<CalendarSyncGoogleGateway> = {},
): CalendarSyncGoogleGateway & {
  readonly createCalls: number;
  readonly updateCalls: number;
  readonly deleteCalls: number;
} {
  let createCalls = 0;
  let updateCalls = 0;
  let deleteCalls = 0;
  return {
    get createCalls() {
      return createCalls;
    },
    get updateCalls() {
      return updateCalls;
    },
    get deleteCalls() {
      return deleteCalls;
    },
    createEvent: async (input) => {
      createCalls += 1;
      return { status: "created", eventId: input.googleEventId };
    },
    updateEvent: async (input) => {
      updateCalls += 1;
      return { status: "updated", eventId: input.googleEventId };
    },
    deleteEvent: async (input) => {
      deleteCalls += 1;
      return { status: "deleted", eventId: input.googleEventId };
    },
    ...overrides,
  };
}

function depsFor(
  loaded: CalendarAppointmentContext | null,
  google: CalendarSyncGoogleGateway,
  recorder: CalendarSyncRecorder,
  attemptedAt: number = NOW,
) {
  return {
    loadAppointment: async () => loaded,
    google,
    sync: recorder,
    now: () => attemptedAt,
    timeZone: "America/Santiago",
  };
}

describe("sincronización automática con Calendar (TI2-162)", () => {
  test("crea el evento al reservar y lo marca sincronizado", async () => {
    const { recorder, events, synced, errors } = fakeRecorder();
    const google = fakeGateway();
    const result = await syncAppointmentToGoogleCalendar(depsFor(context(), google, recorder));
    expect(result).toEqual({
      status: "ok",
      data: { status: "synced", eventId: expect.any(String) },
    });
    expect(google.createCalls).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      appointmentId: "appointment-1",
      startsAt: START_AT,
      endsAt: END_AT,
    });
    expect(synced).toEqual([NOW]);
    expect(errors).toHaveLength(0);
  });

  test("actualiza el mismo evento al reagendar sin duplicar", async () => {
    const { recorder, events, synced } = fakeRecorder();
    const google = fakeGateway();
    const loaded = context({
      status: "rescheduled",
      startAt: START_AT + 24 * 60 * 60_000,
      endAt: END_AT + 24 * 60 * 60_000,
      reference: { eventId: "event-1", addedAt: CREATED_AT },
      referenceIsCurrent: false,
    });
    const result = await syncAppointmentToGoogleCalendar(depsFor(loaded, google, recorder));
    expect(result.status === "ok" && result.data.status).toBe("synced");
    expect(google.updateCalls).toBe(1);
    expect(google.createCalls).toBe(0);
    expect(events).toEqual([
      {
        appointmentId: "appointment-1",
        eventId: "event-1",
        addedAt: CREATED_AT,
        startsAt: loaded.startAt,
        endsAt: loaded.endAt,
      },
    ]);
    expect(synced).toEqual([NOW]);
  });

  test("no llama a Google si la referencia ya está vigente", async () => {
    const { recorder, synced } = fakeRecorder();
    const google = fakeGateway();
    const loaded = context({
      reference: { eventId: "event-1", addedAt: CREATED_AT },
      referenceIsCurrent: true,
    });
    const result = await syncAppointmentToGoogleCalendar(depsFor(loaded, google, recorder));
    expect(result).toEqual({ status: "ok", data: { status: "synced", eventId: "event-1" } });
    expect(google.createCalls).toBe(0);
    expect(google.updateCalls).toBe(0);
    expect(synced).toEqual([NOW]);
  });

  test("elimina el evento al cancelar y lo marca sincronizado", async () => {
    const { recorder, synced, errors } = fakeRecorder();
    const google = fakeGateway();
    const loaded = context({
      status: "cancelled_by_student",
      reference: { eventId: "event-1", addedAt: CREATED_AT },
      referenceIsCurrent: true,
    });
    const result = await syncAppointmentToGoogleCalendar(depsFor(loaded, google, recorder));
    expect(result).toEqual({ status: "ok", data: { status: "synced", eventId: "event-1" } });
    expect(google.deleteCalls).toBe(1);
    expect(synced).toEqual([NOW]);
    expect(errors).toHaveLength(0);
  });

  test("cancelar sin referencia no toca Google y queda sincronizado", async () => {
    const { recorder, synced } = fakeRecorder();
    const google = fakeGateway();
    const loaded = context({ status: "cancelled_by_cereti", reference: null });
    const result = await syncAppointmentToGoogleCalendar(depsFor(loaded, google, recorder));
    expect(result).toEqual({ status: "ok", data: { status: "synced" } });
    expect(google.deleteCalls).toBe(0);
    expect(synced).toEqual([NOW]);
  });

  test("una atención realizada no toca Google y queda sincronizada", async () => {
    const { recorder, synced } = fakeRecorder();
    const google = fakeGateway();
    const loaded = context({ status: "completed" });
    const result = await syncAppointmentToGoogleCalendar(depsFor(loaded, google, recorder));
    expect(result).toEqual({ status: "ok", data: { status: "synced" } });
    expect(google.createCalls).toBe(0);
    expect(synced).toEqual([NOW]);
  });

  test("`not_connected` pide volver a vincular y `unavailable` permite reintentar", async () => {
    for (const code of ["not_connected", "unavailable"] as const) {
      const { recorder, errors, synced } = fakeRecorder();
      const google = fakeGateway({
        createEvent: async () => ({ status: code }),
      });
      const result = await syncAppointmentToGoogleCalendar(depsFor(context(), google, recorder));
      expect(result).toEqual({ status: "ok", data: { status: "error", errorCode: code } });
      expect(errors).toEqual([{ attemptedAt: NOW, errorCode: code }]);
      expect(synced).toHaveLength(0);
    }
  });

  test("`already_exists` actualiza al horario vigente antes de registrar", async () => {
    const { recorder, events } = fakeRecorder();
    const updateCalls: { googleEventId: string; startAt: number; endAt: number }[] = [];
    const google = fakeGateway({
      createEvent: async (input) => ({ status: "already_exists", eventId: input.googleEventId }),
      updateEvent: async (input) => {
        updateCalls.push(input);
        return { status: "updated", eventId: input.googleEventId };
      },
    });
    const newStart = START_AT + 24 * 60 * 60_000;
    const result = await syncAppointmentToGoogleCalendar(
      depsFor(context({ startAt: newStart, endAt: newStart + 60 * 60_000 }), google, recorder),
    );
    expect(result.status === "ok" && result.data.status).toBe("synced");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({ startAt: newStart });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ startsAt: newStart });
  });

  test("cambios consecutivos sincronizan la última fecha, nunca una anterior", async () => {
    const { recorder, events } = fakeRecorder();
    const seen: number[] = [];
    const google = fakeGateway({
      createEvent: async (input) => {
        seen.push(input.startAt);
        return { status: "created", eventId: input.googleEventId };
      },
    });
    const first = context();
    const second = context({
      status: "rescheduled",
      startAt: START_AT + 48 * 60 * 60_000,
      endAt: END_AT + 48 * 60 * 60_000,
    });
    await syncAppointmentToGoogleCalendar(depsFor(first, google, recorder));
    await syncAppointmentToGoogleCalendar(depsFor(second, google, recorder));
    expect(seen).toEqual([first.startAt, second.startAt]);
    expect(events.at(-1)).toMatchObject({ startsAt: second.startAt });
  });

  test("rechaza con códigos del contrato común, nunca con texto", async () => {
    const { recorder } = fakeRecorder();
    const missing = await syncAppointmentToGoogleCalendar(depsFor(null, fakeGateway(), recorder));
    expect(missing).toEqual({
      status: "error",
      error: { code: "unauthorized", message: "No autorizado" },
    });
    const invalid = await syncAppointmentToGoogleCalendar({
      loadAppointment: async () => context(),
      google: fakeGateway(),
      sync: recorder,
      now: () => Number.NaN,
      timeZone: "America/Santiago",
    });
    expect(invalid).toEqual({
      status: "error",
      error: { code: "conflict", message: expect.any(String) },
    });
  });
});
