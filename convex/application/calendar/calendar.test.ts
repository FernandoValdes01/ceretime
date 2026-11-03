import { describe, expect, test } from "vitest";
import { CALENDAR_EVENTS_SCOPE } from "../../domain/calendar/calendar_event";
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

function fakeGoogle(outcome: GoogleCalendarCreateOutcome): GoogleCalendarGateway & {
  readonly calls: Array<Parameters<GoogleCalendarGateway["createEvent"]>[0]>;
} {
  const calls: Array<Parameters<GoogleCalendarGateway["createEvent"]>[0]> = [];
  return {
    calls,
    createEvent: async (input) => {
      calls.push(input);
      return outcome;
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
  recorded: Array<{ appointmentId: string; eventId: string; addedAt: number }> = [],
) {
  return {
    loadAppointment: (input: {
      readonly tokenIdentifier: string | null;
      readonly appointmentId: string;
    }) => loadFor(appointmentReader, input.tokenIdentifier, input.appointmentId),
    recordEvent: async (input: {
      readonly appointmentId: string;
      readonly eventId: string;
      readonly addedAt: number;
    }) => {
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
      reader({ calendarEventId: "event-1", calendarEventAddedAt: CREATED_AT + 1 }),
      "token-student",
    );
    expect(loaded?.reference).toEqual({ eventId: "event-1", addedAt: CREATED_AT + 1 });
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

  test("marca alreadyAdded cuando ya existe el evento", async () => {
    const result = await getAppointmentCalendarFile(
      fileDeps(reader({ calendarEventId: "event-1", calendarEventAddedAt: CREATED_AT })),
      input,
    );
    expect(result.status === "ok" && result.data.alreadyAdded).toBe(true);
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
    const recorded: Array<{ appointmentId: string; eventId: string; addedAt: number }> = [];
    const google = fakeGoogle({ status: "created", eventId: "event-1" });
    const result = await addAppointmentToGoogleCalendar(addDeps(reader(), google, recorded), input);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    if (result.data.status === "fallback") throw new Error("Se esperaba un evento creado");
    expect(result.data.status).toBe("created");
    expect(result.data.eventId).toBe("event-1");
    expect(result.data.ics.content).toContain("BEGIN:VCALENDAR");
    expect(google.calls).toHaveLength(1);
    expect(google.calls[0]).toMatchObject({
      title: "Atención programada",
      startAt: START_AT,
      endAt: END_AT,
      timeZone: "America/Santiago",
    });
    expect(google.calls[0]?.googleEventId).toMatch(/^[a-v0-9]{26}$/);
    expect(recorded).toEqual([
      { appointmentId: "appointment-1", eventId: "event-1", addedAt: CREATED_AT + 5_000 },
    ]);
  });

  test("no llama a Google si la atención ya tiene evento", async () => {
    const google = fakeGoogle({ status: "created", eventId: "event-new" });
    const result = await addAppointmentToGoogleCalendar(
      addDeps(reader({ calendarEventId: "event-1", calendarEventAddedAt: CREATED_AT }), google),
      input,
    );

    expect(result.status === "ok" && result.data.status).toBe("already_created");
    if (result.status !== "ok" || result.data.status === "fallback") {
      throw new Error("Se esperaba un evento ya creado");
    }
    expect(result.data.eventId).toBe("event-1");
    expect(google.calls).toHaveLength(0);
  });

  test("trata el 409 del proveedor como evento ya existente", async () => {
    const recorded: Array<{ appointmentId: string; eventId: string; addedAt: number }> = [];
    const google = fakeGoogle({ status: "already_exists", eventId: "event-1" });
    const result = await addAppointmentToGoogleCalendar(addDeps(reader(), google, recorded), input);

    expect(result.status === "ok" && result.data.status).toBe("already_created");
    expect(recorded).toHaveLength(1);
  });

  test("respalda con .ics cuando Calendar no está conectado", async () => {
    const recorded: Array<{ appointmentId: string; eventId: string; addedAt: number }> = [];
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
