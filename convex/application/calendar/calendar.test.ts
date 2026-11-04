import { describe, expect, test } from "vitest";
import { CALENDAR_EVENTS_SCOPE } from "../../domain/calendar/calendar_event";
import { CONFLICT_ERROR_MESSAGE } from "../../domain/errors/api_error";
import type {
  AuthorizableAgendaAccompaniment,
  AuthorizableAssignment,
  AuthorizableProfile,
  AuthorizationReader,
} from "../authorization/authorize";
import {
  addAppointmentToGoogleCalendar,
  getAppointmentCalendarFile,
  getCalendarConnection,
  loadCalendarAppointment,
  type CalendarAppointmentContext,
  type CalendarAppointmentReader,
  type CalendarConnectionReader,
  type GoogleCalendarCreateOutcome,
  type GoogleCalendarGateway,
  type GoogleCalendarUpdateOutcome,
} from "./calendar";

/**
 * Pruebas de los casos de uso del calendario (TI2-122).
 *
 * Dobles en memoria: no se llama a Google ni a Convex. Se cubre la
 * autorización por pertenencia, el `.ics` estable, la creación sin duplicados, el
 * respaldo cuando el proveedor no está vinculado o falla, y que nunca se
 * expongan respuestas del proveedor.
 */

type FakeProfile = AuthorizableProfile & { readonly tokenIdentifier: string };

const student: FakeProfile = {
  _id: "user-student",
  role: "student",
  institutionalStatus: "enabled",
  accountStatus: "active",
  tokenIdentifier: "token-student",
};

const otherStudent: FakeProfile = {
  _id: "user-other",
  role: "student",
  institutionalStatus: "enabled",
  accountStatus: "active",
  tokenIdentifier: "token-other",
};

const professional: FakeProfile = {
  _id: "user-pro",
  role: "professional",
  institutionalStatus: "enabled",
  accountStatus: "active",
  tokenIdentifier: "token-pro",
};

const intern: FakeProfile = {
  _id: "user-intern",
  role: "intern",
  institutionalStatus: "enabled",
  accountStatus: "active",
  tokenIdentifier: "token-intern",
};

const admin: FakeProfile = {
  _id: "user-admin",
  role: "admin",
  institutionalStatus: "enabled",
  accountStatus: "active",
  tokenIdentifier: "token-admin",
};

const inactiveStudent: FakeProfile = {
  _id: "user-inactive",
  role: "student",
  institutionalStatus: "disabled",
  accountStatus: "active",
  tokenIdentifier: "token-inactive",
};

const activeAccompaniment: AuthorizableAgendaAccompaniment = {
  _id: "acc-1",
  studentId: "user-student",
  status: "active",
};

const closedAccompaniment: AuthorizableAgendaAccompaniment = {
  _id: "acc-closed",
  studentId: "user-student",
  status: "closed",
};

function assignment(overrides: Partial<AuthorizableAssignment>): AuthorizableAssignment {
  return {
    accompanimentId: "acc-1",
    userId: "user-pro",
    assignedRole: "professional",
    status: "active",
    ...overrides,
  };
}

function fakeAuth(): AuthorizationReader {
  const profiles = [student, otherStudent, professional, intern, admin, inactiveStudent];
  const accompaniments = [activeAccompaniment, closedAccompaniment];
  const assignments = [
    assignment({}),
    assignment({ userId: "user-intern", assignedRole: "intern" }),
  ];
  return {
    findProfileByTokenIdentifier: async (tokenIdentifier) =>
      profiles.find((row) => row.tokenIdentifier === tokenIdentifier) ?? null,
    getProfileById: async (userId) => profiles.find((row) => row._id === userId) ?? null,
    getAccompaniment: async (accompanimentId) =>
      accompaniments.find((row) => row._id === accompanimentId) ?? null,
    findActiveAssignments: async (accompanimentId, userId) =>
      assignments.filter((row) => row.accompanimentId === accompanimentId && row.userId === userId),
  };
}

const START_AT = Date.UTC(2026, 2, 10, 16, 0, 0);
const END_AT = Date.UTC(2026, 2, 10, 17, 0, 0);
const CREATED_AT = Date.UTC(2026, 2, 1, 12, 0, 0);

type StoredRow = Awaited<ReturnType<CalendarAppointmentReader["getAppointment"]>>;

function row(overrides: Partial<NonNullable<StoredRow>> = {}): NonNullable<StoredRow> {
  return {
    _id: "appointment-1",
    accompanimentId: "acc-1",
    studentId: "user-student",
    professionalId: "user-pro",
    status: "scheduled",
    startAt: START_AT,
    endAt: END_AT,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function reader(overrides: Partial<NonNullable<StoredRow>> = {}): CalendarAppointmentReader {
  const stored = row(overrides);
  return {
    getAppointment: async (appointmentId) => (appointmentId === stored._id ? stored : null),
    recordCalendarEvent: async () => undefined,
  };
}

function loadFor(
  appointmentReader: CalendarAppointmentReader,
  tokenIdentifier: string | null,
  appointmentId = "appointment-1",
): Promise<CalendarAppointmentContext | null> {
  return loadCalendarAppointment(
    { auth: fakeAuth(), appointments: appointmentReader },
    { tokenIdentifier, appointmentId },
  );
}

type CreateCall = Parameters<GoogleCalendarGateway["createEvent"]>[0];
type UpdateCall = Parameters<GoogleCalendarGateway["updateEvent"]>[0];
type RecordedReference = {
  appointmentId: string;
  eventId: string;
  addedAt: number;
  startsAt: number;
  endsAt: number;
};

function fakeGoogle(
  createOutcome: GoogleCalendarCreateOutcome,
  updateOutcome: GoogleCalendarUpdateOutcome = { status: "updated", eventId: "event-1" },
): GoogleCalendarGateway & {
  readonly createCalls: CreateCall[];
  readonly updateCalls: UpdateCall[];
} {
  const createCalls: CreateCall[] = [];
  const updateCalls: UpdateCall[] = [];
  return {
    createCalls,
    updateCalls,
    createEvent: async (input) => {
      createCalls.push(input);
      return createOutcome;
    },
    updateEvent: async (input) => {
      updateCalls.push(input);
      return updateOutcome;
    },
  };
}

function fileDeps(appointmentReader: CalendarAppointmentReader) {
  return {
    loadAppointment: (input: {
      readonly tokenIdentifier: string | null;
      readonly appointmentId: string;
    }) => loadFor(appointmentReader, input.tokenIdentifier, input.appointmentId),
  };
}

function addDeps(
  appointmentReader: CalendarAppointmentReader,
  google: GoogleCalendarGateway,
  recorded: RecordedReference[] = [],
) {
  return {
    loadAppointment: (input: {
      readonly tokenIdentifier: string | null;
      readonly appointmentId: string;
    }) => loadFor(appointmentReader, input.tokenIdentifier, input.appointmentId),
    recordEvent: async (input: RecordedReference) => {
      recorded.push(input);
    },
    google,
    now: () => CREATED_AT + 5_000,
  };
}

const input = {
  tokenIdentifier: "token-student",
  appointmentId: "appointment-1",
  timeZone: "America/Santiago",
} as const;

describe("loadCalendarAppointment", () => {
  test("autoriza solo al Estudiante dueño con acompañamiento activo", async () => {
    expect(await loadFor(reader(), "token-student")).toMatchObject({
      appointmentId: "appointment-1",
      startAt: START_AT,
      endAt: END_AT,
      createdAt: CREATED_AT,
      reference: null,
    });
  });

  test("deniega a otro estudiante, al profesional, al practicante y al administrador", async () => {
    for (const token of ["token-other", "token-pro", "token-intern", "token-admin", null]) {
      expect(await loadFor(reader(), token)).toBeNull();
    }
  });

  test("deniega una atención de un acompañamiento cerrado o inexistente", async () => {
    expect(await loadFor(reader({ accompanimentId: "acc-closed" }), "token-student")).toBeNull();
    expect(await loadFor(reader({ accompanimentId: "acc-missing" }), "token-student")).toBeNull();
  });

  test("deniega una atención de otro estudiante aunque el acompañamiento sea propio", async () => {
    expect(await loadFor(reader({ studentId: "user-other" }), "token-student")).toBeNull();
  });

  test("deniega una cuenta inhabilitada", async () => {
    expect(await loadFor(reader(), "token-inactive")).toBeNull();
  });

  test("devuelve la referencia guardada sin exponer otros campos", async () => {
    const loaded = await loadFor(
      reader({
        calendarEventId: "event-1",
        calendarEventAddedAt: CREATED_AT + 1,
        calendarEventStartsAt: START_AT,
        calendarEventEndsAt: END_AT,
      }),
      "token-student",
    );
    expect(loaded?.reference).toEqual({ eventId: "event-1", addedAt: CREATED_AT + 1 });
    expect(loaded?.referenceIsCurrent).toBe(true);
  });

  test("marca como obsoleta una referencia con el horario anterior o sin horario", async () => {
    for (const stale of [
      reader({ calendarEventId: "event-1", calendarEventAddedAt: CREATED_AT }),
      reader({
        calendarEventId: "event-1",
        calendarEventAddedAt: CREATED_AT,
        calendarEventStartsAt: START_AT - 60_000,
        calendarEventEndsAt: END_AT - 60_000,
      }),
    ]) {
      const loaded = await loadFor(stale, "token-student");
      expect(loaded?.reference).toEqual({ eventId: "event-1", addedAt: CREATED_AT });
      expect(loaded?.referenceIsCurrent).toBe(false);
    }
  });
});

describe("getAppointmentCalendarFile", () => {
  test("entrega el .ics del dueño con fechas UTC y UID estable", async () => {
    const result = await getAppointmentCalendarFile(fileDeps(reader()), input);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.fileName).toBe("atencion-programada.ics");
    expect(result.data.content).toContain("DTSTART:20260310T160000Z");
    expect(result.data.content).toContain("DTEND:20260310T170000Z");
    expect(result.data.content).toContain("SUMMARY:Atención programada");
    expect(result.data.alreadyAdded).toBe(false);
  });

  test("marca alreadyAdded cuando el evento está sincronizado con el horario vigente", async () => {
    const result = await getAppointmentCalendarFile(
      fileDeps(
        reader({
          calendarEventId: "event-1",
          calendarEventAddedAt: CREATED_AT,
          calendarEventStartsAt: START_AT,
          calendarEventEndsAt: END_AT,
        }),
      ),
      input,
    );
    expect(result.status === "ok" && result.data.alreadyAdded).toBe(true);
  });

  test("no marca alreadyAdded cuando el evento conserva el horario anterior", async () => {
    const result = await getAppointmentCalendarFile(
      fileDeps(
        reader({
          calendarEventId: "event-1",
          calendarEventAddedAt: CREATED_AT,
          calendarEventStartsAt: START_AT - 60_000,
          calendarEventEndsAt: END_AT - 60_000,
        }),
      ),
      input,
    );
    expect(result.status === "ok" && result.data.alreadyAdded).toBe(false);
    expect(result.status === "ok" && result.data.content).toContain("DTSTART:20260310T160000Z");
  });

  test("rechaza el .ics de una atención que ya no está vigente", async () => {
    for (const status of ["cancelled_by_student", "completed", "no_show"] as const) {
      const result = await getAppointmentCalendarFile(fileDeps(reader({ status })), input);
      expect(result).toEqual({
        status: "error",
        error: { code: "conflict", message: CONFLICT_ERROR_MESSAGE },
      });
    }
  });

  test("entrega el .ics de una atención reagendada", async () => {
    const result = await getAppointmentCalendarFile(
      fileDeps(reader({ status: "rescheduled" })),
      input,
    );
    expect(result.status).toBe("ok");
  });

  test("responde unauthorized sin revelar si la atención existe", async () => {
    const result = await getAppointmentCalendarFile(fileDeps(reader()), {
      ...input,
      tokenIdentifier: "token-other",
    });
    expect(result).toEqual({
      status: "error",
      error: { code: "unauthorized", message: "No autorizado" },
    });
  });
});

describe("addAppointmentToGoogleCalendar", () => {
  test("crea el evento, guarda la referencia y devuelve el .ics", async () => {
    const recorded: RecordedReference[] = [];
    const google = fakeGoogle({ status: "created", eventId: "event-1" });
    const result = await addAppointmentToGoogleCalendar(addDeps(reader(), google, recorded), input);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    if (result.data.status === "fallback") throw new Error("Se esperaba un evento creado");
    expect(result.data.status).toBe("created");
    expect(result.data.eventId).toBe("event-1");
    expect(result.data.ics.content).toContain("BEGIN:VCALENDAR");
    expect(google.createCalls).toHaveLength(1);
    expect(google.createCalls[0]).toMatchObject({
      title: "Atención programada",
      startAt: START_AT,
      endAt: END_AT,
      timeZone: "America/Santiago",
    });
    expect(google.createCalls[0]?.googleEventId).toMatch(/^[a-v0-9]{26}$/);
    expect(google.updateCalls).toHaveLength(0);
    expect(recorded).toEqual([
      {
        appointmentId: "appointment-1",
        eventId: "event-1",
        addedAt: CREATED_AT + 5_000,
        startsAt: START_AT,
        endsAt: END_AT,
      },
    ]);
  });

  test("actualiza el evento existente cuando la referencia quedó obsoleta", async () => {
    const recorded: RecordedReference[] = [];
    const google = fakeGoogle(
      { status: "created", eventId: "event-new" },
      { status: "updated", eventId: "event-1" },
    );
    const result = await addAppointmentToGoogleCalendar(
      addDeps(
        reader({
          calendarEventId: "event-1",
          calendarEventAddedAt: CREATED_AT,
          calendarEventStartsAt: START_AT - 60_000,
          calendarEventEndsAt: END_AT - 60_000,
        }),
        google,
        recorded,
      ),
      input,
    );

    expect(result.status === "ok" && result.data.status).toBe("updated");
    expect(google.createCalls).toHaveLength(0);
    expect(google.updateCalls).toEqual([
      {
        googleEventId: "event-1",
        title: "Atención programada",
        startAt: START_AT,
        endAt: END_AT,
        timeZone: "America/Santiago",
      },
    ]);
    expect(recorded).toEqual([
      {
        appointmentId: "appointment-1",
        eventId: "event-1",
        addedAt: CREATED_AT,
        startsAt: START_AT,
        endsAt: END_AT,
      },
    ]);
  });

  test("respalda con .ics si no puede actualizar el evento obsoleto", async () => {
    for (const outcome of ["not_connected", "unavailable"] as const) {
      const google = fakeGoogle({ status: "created", eventId: "event-new" }, { status: outcome });
      const result = await addAppointmentToGoogleCalendar(
        addDeps(
          reader({
            calendarEventId: "event-1",
            calendarEventAddedAt: CREATED_AT,
            calendarEventStartsAt: START_AT - 60_000,
            calendarEventEndsAt: END_AT - 60_000,
          }),
          google,
        ),
        input,
      );
      expect(result.status === "ok" && result.data.status).toBe("fallback");
      expect(
        result.status === "ok" && result.data.status === "fallback" && result.data.reason,
      ).toBe(outcome);
      expect(google.createCalls).toHaveLength(0);
    }
  });

  test("rechaza crear el evento de una atención que ya no está vigente", async () => {
    for (const status of ["cancelled_by_cereti", "completed", "no_show_justified"] as const) {
      const google = fakeGoogle({ status: "created", eventId: "event-1" });
      const result = await addAppointmentToGoogleCalendar(
        addDeps(reader({ status }), google),
        input,
      );
      expect(result).toEqual({
        status: "error",
        error: { code: "conflict", message: CONFLICT_ERROR_MESSAGE },
      });
      expect(google.createCalls).toHaveLength(0);
      expect(google.updateCalls).toHaveLength(0);
    }
  });

  test("no llama a Google si la atención ya tiene evento vigente", async () => {
    const google = fakeGoogle({ status: "created", eventId: "event-new" });
    const result = await addAppointmentToGoogleCalendar(
      addDeps(
        reader({
          calendarEventId: "event-1",
          calendarEventAddedAt: CREATED_AT,
          calendarEventStartsAt: START_AT,
          calendarEventEndsAt: END_AT,
        }),
        google,
      ),
      input,
    );

    expect(result.status === "ok" && result.data.status).toBe("already_created");
    if (result.status !== "ok" || result.data.status === "fallback") {
      throw new Error("Se esperaba un evento ya creado");
    }
    expect(result.data.eventId).toBe("event-1");
    expect(google.createCalls).toHaveLength(0);
    expect(google.updateCalls).toHaveLength(0);
  });

  test("trata el 409 del proveedor como evento ya existente", async () => {
    const recorded: RecordedReference[] = [];
    const google = fakeGoogle({ status: "already_exists", eventId: "event-1" });
    const result = await addAppointmentToGoogleCalendar(addDeps(reader(), google, recorded), input);

    expect(result.status === "ok" && result.data.status).toBe("already_created");
    expect(recorded).toHaveLength(1);
  });

  test("respalda con .ics cuando Calendar no está conectado", async () => {
    const recorded: RecordedReference[] = [];
    const result = await addAppointmentToGoogleCalendar(
      addDeps(reader(), fakeGoogle({ status: "not_connected" }), recorded),
      input,
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.status).toBe("fallback");
    expect(result.data.status === "fallback" && result.data.reason).toBe("not_connected");
    expect(result.data.ics.content).toContain("BEGIN:VCALENDAR");
    expect(recorded).toHaveLength(0);
  });

  test("respalda con .ics sin filtrar la respuesta del proveedor", async () => {
    const result = await addAppointmentToGoogleCalendar(
      addDeps(reader(), fakeGoogle({ status: "unavailable" })),
      input,
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.status).toBe("fallback");
    expect(JSON.stringify(result.data)).not.toMatch(/error|stack|token|google/i);
  });

  test("la reserva sigue en pie aunque falle el guardado de la referencia", async () => {
    const result = await addAppointmentToGoogleCalendar(
      {
        ...addDeps(reader(), fakeGoogle({ status: "created", eventId: "event-1" })),
        recordEvent: async () => {
          throw new Error("fallo interno de persistencia");
        },
      },
      input,
    );

    expect(result.status === "ok" && result.data.status).toBe("created");
  });

  test("deniega a cualquier rol que no sea el Estudiante dueño", async () => {
    for (const token of ["token-other", "token-pro", "token-intern", "token-admin", null]) {
      const result = await addAppointmentToGoogleCalendar(
        addDeps(reader(), fakeGoogle({ status: "created", eventId: "event-1" })),
        { ...input, tokenIdentifier: token },
      );
      expect(result.status).toBe("error");
    }
  });
});

describe("agregar → reagendar → consultar sin sincronización automática", () => {
  type MutableRow = {
    -readonly [K in keyof NonNullable<StoredRow>]: NonNullable<StoredRow>[K];
  };

  function mutableReader(stored: MutableRow, recorded: RecordedReference[]) {
    const appointmentReader: CalendarAppointmentReader = {
      getAppointment: async (appointmentId) =>
        appointmentId === stored._id ? { ...stored } : null,
      recordCalendarEvent: async () => undefined,
    };
    const recordEvent = async (reference: RecordedReference) => {
      recorded.push(reference);
      stored.calendarEventId = reference.eventId;
      stored.calendarEventAddedAt = reference.addedAt;
      stored.calendarEventStartsAt = reference.startsAt;
      stored.calendarEventEndsAt = reference.endsAt;
    };
    return {
      appointmentReader,
      load: (tokenIdentifier: string | null) =>
        loadFor(appointmentReader, tokenIdentifier, "appointment-1"),
      recordEvent,
    };
  }

  test("la referencia queda obsoleta y no confirma la nueva fecha como agregada", async () => {
    const stored: MutableRow = { ...row() };
    const recorded: RecordedReference[] = [];
    const google = fakeGoogle(
      { status: "created", eventId: "event-1" },
      { status: "updated", eventId: "event-1" },
    );
    const { appointmentReader, load, recordEvent } = mutableReader(stored, recorded);
    const deps = {
      loadAppointment: (loadInput: {
        readonly tokenIdentifier: string | null;
        readonly appointmentId: string;
      }) => loadFor(appointmentReader, loadInput.tokenIdentifier, loadInput.appointmentId),
      recordEvent,
      google,
      now: () => CREATED_AT + 5_000,
    };

    const added = await addAppointmentToGoogleCalendar(deps, input);
    expect(added.status === "ok" && added.data.status).toBe("created");
    expect((await load("token-student"))?.referenceIsCurrent).toBe(true);

    const newStart = START_AT + 24 * 60 * 60_000;
    const newEnd = END_AT + 24 * 60 * 60_000;
    stored.status = "rescheduled";
    stored.startAt = newStart;
    stored.endAt = newEnd;

    const afterReschedule = await load("token-student");
    expect(afterReschedule?.referenceIsCurrent).toBe(false);
    expect(afterReschedule?.reference).toEqual({ eventId: "event-1", addedAt: CREATED_AT + 5_000 });

    const file = await getAppointmentCalendarFile(
      {
        loadAppointment: (loadInput: {
          readonly tokenIdentifier: string | null;
          readonly appointmentId: string;
        }) => loadFor(appointmentReader, loadInput.tokenIdentifier, loadInput.appointmentId),
      },
      input,
    );
    expect(file.status === "ok" && file.data.alreadyAdded).toBe(false);
    expect(file.status === "ok" && file.data.content).toContain("DTSTART:20260311T160000Z");

    const again = await addAppointmentToGoogleCalendar(deps, input);
    expect(again.status === "ok" && again.data.status).toBe("updated");
    expect(google.updateCalls).toEqual([
      {
        googleEventId: "event-1",
        title: "Atención programada",
        startAt: newStart,
        endAt: newEnd,
        timeZone: "America/Santiago",
      },
    ]);
    expect(google.createCalls).toHaveLength(1);
    expect((await load("token-student"))?.referenceIsCurrent).toBe(true);
  });
});

describe("getCalendarConnection", () => {
  function connection(scopes: readonly string[] | null): CalendarConnectionReader {
    return { listGoogleScopes: async () => scopes };
  }

  test("confirma la conexión solo con el alcance de Calendar", async () => {
    const result = await getCalendarConnection(
      { auth: fakeAuth(), connection: connection(["openid", CALENDAR_EVENTS_SCOPE]) },
      { tokenIdentifier: "token-student" },
    );
    expect(result).toEqual({ status: "ok", data: { connected: true } });
  });

  test("no confunde el inicio institucional con Calendar", async () => {
    const result = await getCalendarConnection(
      { auth: fakeAuth(), connection: connection(["openid", "email", "profile"]) },
      { tokenIdentifier: "token-student" },
    );
    expect(result).toEqual({ status: "ok", data: { connected: false } });
  });

  test("sin cuenta vinculada responde desconectado", async () => {
    const result = await getCalendarConnection(
      { auth: fakeAuth(), connection: connection(null) },
      { tokenIdentifier: "token-student" },
    );
    expect(result).toEqual({ status: "ok", data: { connected: false } });
  });

  test("exige una sesión con perfil vigente", async () => {
    for (const tokenIdentifier of [null, "token-inactive", "token-missing"]) {
      const result = await getCalendarConnection(
        { auth: fakeAuth(), connection: connection([CALENDAR_EVENTS_SCOPE]) },
        { tokenIdentifier },
      );
      expect(result.status).toBe("error");
    }
  });
});
