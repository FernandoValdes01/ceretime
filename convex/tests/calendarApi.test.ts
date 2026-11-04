/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { APPOINTMENT_CALENDAR_LIST_LIMIT } from "../application/appointments/queries";
import { CONFLICT_ERROR_MESSAGE } from "../domain/errors/api_error";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const ISSUER = "https://accounts.google.com";
const HOUR = 60 * 60_000;
const BASE_START = Date.UTC(2026, 2, 10, 16, 0, 0);
const CREATED_AT = Date.UTC(2026, 2, 1, 12, 0, 0);

/**
 * Pruebas de la API pública de calendario por atención (TI2-122).
 *
 * Usan una base Convex aislada, identidades simuladas y datos ficticios. Se
 * cubren el listado acotado del detalle, la descarga `.ics` del Estudiante
 * dueño, la denegación de los demás roles, la idempotencia y el respaldo
 * cuando Google Calendar no está conectado. La llamada real a Google se prueba
 * en los casos de uso con dobles; acá se verifica el borde Convex.
 */

function identityFor(subject: string, email: string) {
  return {
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    email,
    name: "Ficticio",
  };
}

async function seedUser(
  t: ReturnType<typeof convexTest>,
  input: {
    readonly subject: string;
    readonly role: Doc<"users">["role"];
    readonly institutionalStatus?: Doc<"users">["institutionalStatus"];
    readonly accountStatus?: Doc<"users">["accountStatus"];
    readonly fullName?: string;
  },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: `${input.subject}@uct.cl`,
      fullName: input.fullName ?? "Ficticio",
      role: input.role,
      institutionalStatus: input.institutionalStatus ?? "enabled",
      accountStatus: input.accountStatus ?? "active",
      tokenIdentifier: `${ISSUER}|${input.subject}`,
    });
  });
}

async function seedAgenda(
  t: ReturnType<typeof convexTest>,
  label: string,
  options: {
    readonly accompanimentStatus?: Doc<"accompaniments">["status"];
    readonly assignmentStatus?: Doc<"accompanimentAssignments">["status"];
    readonly studentInstitutionalStatus?: Doc<"users">["institutionalStatus"];
  } = {},
) {
  const proSubject = `ti122-api-pro-${label}`;
  const studentSubject = `ti122-api-est-${label}`;
  const internSubject = `ti122-api-prac-${label}`;
  const pro = await seedUser(t, {
    subject: proSubject,
    role: "professional",
    fullName: "Profesional Secreto",
  });
  const student = await seedUser(t, {
    subject: studentSubject,
    role: "student",
    ...(options.studentInstitutionalStatus === undefined
      ? {}
      : { institutionalStatus: options.studentInstitutionalStatus }),
  });
  const intern = await seedUser(t, { subject: internSubject, role: "intern" });
  const accompanimentId = await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId: student,
      status: options.accompanimentStatus ?? "active",
      objective: "Objetivo ficticio",
      accessNeeds: "Necesidad ficticia",
    });
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("accompanimentAssignments", {
      accompanimentId,
      userId: pro,
      assignedRole: "professional",
      status: options.assignmentStatus ?? "active",
    });
    await ctx.db.insert("accompanimentAssignments", {
      accompanimentId,
      userId: intern,
      assignedRole: "intern",
      status: options.assignmentStatus ?? "active",
    });
  });
  return {
    pro,
    student,
    intern,
    accompanimentId,
    proIdentity: identityFor(proSubject, `${proSubject}@uct.cl`),
    studentIdentity: identityFor(studentSubject, `${studentSubject}@alu.uct.cl`),
    internIdentity: identityFor(internSubject, `${internSubject}@alu.uct.cl`),
  };
}

async function seedAppointment(
  t: ReturnType<typeof convexTest>,
  input: {
    readonly accompanimentId: Id<"accompaniments">;
    readonly studentId: Id<"users">;
    readonly professionalId: Id<"users">;
    readonly startsAt: number;
    readonly endsAt: number;
    readonly status?: Doc<"appointments">["status"];
    readonly modality?: Doc<"appointments">["modality"];
    readonly calendarEventId?: string;
    readonly calendarEventAddedAt?: number;
    readonly calendarEventStartsAt?: number;
    readonly calendarEventEndsAt?: number;
  },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("appointments", {
      accompanimentId: input.accompanimentId,
      studentId: input.studentId,
      professionalId: input.professionalId,
      modality: input.modality ?? "online",
      status: input.status ?? "scheduled",
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      ...(input.calendarEventId === undefined ? {} : { calendarEventId: input.calendarEventId }),
      ...(input.calendarEventAddedAt === undefined
        ? {}
        : { calendarEventAddedAt: input.calendarEventAddedAt }),
      ...(input.calendarEventStartsAt === undefined
        ? {}
        : { calendarEventStartsAt: input.calendarEventStartsAt }),
      ...(input.calendarEventEndsAt === undefined
        ? {}
        : { calendarEventEndsAt: input.calendarEventEndsAt }),
      createdAt: CREATED_AT,
    });
  });
}

async function getAppointment(t: ReturnType<typeof convexTest>, appointmentId: string) {
  return await t.run(async (ctx) => {
    const id = ctx.db.normalizeId("appointments", appointmentId);
    return id === null ? null : await ctx.db.get(id);
  });
}

async function publicErrorData(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(
    () => {
      throw new Error("Se esperaba un error público");
    },
    (error: unknown) => {
      if (error instanceof ConvexError) return error.data;
      if (typeof error === "object" && error !== null && "data" in error) {
        return (error as { readonly data?: unknown }).data;
      }
      throw error;
    },
  );
}

async function expectUnauthorized(promise: Promise<unknown>) {
  expect(await publicErrorData(promise)).toEqual({
    code: "unauthorized",
    message: "No autorizado",
  });
}

test("TI2-122 API: el listado acotado ordena por inicio y distingue el evento vigente", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "list");
  const older = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: BASE_START,
    endsAt: BASE_START + HOUR,
    calendarEventId: "event-1",
    calendarEventAddedAt: CREATED_AT,
    calendarEventStartsAt: BASE_START,
    calendarEventEndsAt: BASE_START + HOUR,
  });
  const newer = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: BASE_START + HOUR,
    endsAt: BASE_START + 2 * HOUR,
    modality: "inPerson",
  });
  const stale = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: BASE_START + 2 * HOUR,
    endsAt: BASE_START + 3 * HOUR,
    calendarEventId: "event-old",
    calendarEventAddedAt: CREATED_AT,
    calendarEventStartsAt: BASE_START + HOUR,
    calendarEventEndsAt: BASE_START + 2 * HOUR,
  });

  const asStudent = t.withIdentity(agenda.studentIdentity);
  const rows = await asStudent.query(api.presentation.appointments.listAccompanimentAppointments, {
    accompanimentId: agenda.accompanimentId,
  });

  expect(rows).toEqual([
    {
      appointmentId: stale,
      status: "scheduled",
      startAt: BASE_START + 2 * HOUR,
      endAt: BASE_START + 3 * HOUR,
      modality: "online",
      calendarAdded: false,
      calendarNeedsUpdate: true,
    },
    {
      appointmentId: newer,
      status: "scheduled",
      startAt: BASE_START + HOUR,
      endAt: BASE_START + 2 * HOUR,
      modality: "inPerson",
      calendarAdded: false,
      calendarNeedsUpdate: false,
    },
    {
      appointmentId: older,
      status: "scheduled",
      startAt: BASE_START,
      endAt: BASE_START + HOUR,
      modality: "online",
      calendarAdded: true,
      calendarNeedsUpdate: false,
    },
  ]);
  expect(Object.keys(rows[0]!).sort()).toEqual([
    "appointmentId",
    "calendarAdded",
    "calendarNeedsUpdate",
    "endAt",
    "modality",
    "startAt",
    "status",
  ]);
}, 20_000);

test("TI2-122 API: el listado respeta el tope y la autorización de lectura", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "list-limit");
  for (let index = 0; index < APPOINTMENT_CALENDAR_LIST_LIMIT + 5; index += 1) {
    await seedAppointment(t, {
      accompanimentId: agenda.accompanimentId,
      studentId: agenda.student,
      professionalId: agenda.pro,
      startsAt: BASE_START + index * HOUR,
      endsAt: BASE_START + (index + 1) * HOUR,
    });
  }

  const asStudent = t.withIdentity(agenda.studentIdentity);
  const rows = await asStudent.query(api.presentation.appointments.listAccompanimentAppointments, {
    accompanimentId: agenda.accompanimentId,
  });
  expect(rows).toHaveLength(APPOINTMENT_CALENDAR_LIST_LIMIT);
  expect(rows[0]?.startAt).toBe(BASE_START + (APPOINTMENT_CALENDAR_LIST_LIMIT + 4) * HOUR);
  expect(rows.at(-1)?.startAt).toBe(BASE_START + 5 * HOUR);

  const asPro = t.withIdentity(agenda.proIdentity);
  expect(
    await asPro.query(api.presentation.appointments.listAccompanimentAppointments, {
      accompanimentId: agenda.accompanimentId,
    }),
  ).toHaveLength(APPOINTMENT_CALENDAR_LIST_LIMIT);

  const asIntern = t.withIdentity(agenda.internIdentity);
  expect(
    await asIntern.query(api.presentation.appointments.listAccompanimentAppointments, {
      accompanimentId: agenda.accompanimentId,
    }),
  ).toHaveLength(APPOINTMENT_CALENDAR_LIST_LIMIT);
});

test("TI2-122 API: el listado deniega a ajenos, administradores y anónimos", async () => {
  expect.hasAssertions();
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "list-denied");
  const other = await seedUser(t, { subject: "ti122-api-list-other", role: "student" });
  await seedUser(t, { subject: "ti122-api-list-admin", role: "admin" });
  const otherAccompaniment = await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId: other,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "",
    });
  });

  // El dueño no puede leer el acompañamiento de otra persona.
  await expectUnauthorized(
    t
      .withIdentity(agenda.studentIdentity)
      .query(api.presentation.appointments.listAccompanimentAppointments, {
        accompanimentId: otherAccompaniment,
      }),
  );

  for (const caller of [
    t.withIdentity(identityFor("ti122-api-list-other", "ti122-api-list-other@alu.uct.cl")),
    t.withIdentity(identityFor("ti122-api-list-admin", "ti122-api-list-admin@uct.cl")),
    t,
  ]) {
    await expectUnauthorized(
      caller.query(api.presentation.appointments.listAccompanimentAppointments, {
        accompanimentId: agenda.accompanimentId,
      }),
    );
  }

  await expectUnauthorized(
    t
      .withIdentity(agenda.studentIdentity)
      .query(api.presentation.appointments.listAccompanimentAppointments, {
        accompanimentId: "no-es-un-id",
      }),
  );
});

test("TI2-122 API: el Estudiante dueño descarga un .ics estable y genérico", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "ics");
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: BASE_START,
    endsAt: BASE_START + HOUR,
  });
  const asStudent = t.withIdentity(agenda.studentIdentity);

  const first = await asStudent.query(api.presentation.appointments.getAppointmentCalendarFile, {
    appointmentId,
  });
  const second = await asStudent.query(api.presentation.appointments.getAppointmentCalendarFile, {
    appointmentId,
  });

  expect(first).toEqual(second);
  expect(first.fileName).toBe("atencion-programada.ics");
  expect(first.alreadyAdded).toBe(false);
  expect(first.content).toContain("BEGIN:VCALENDAR");
  expect(first.content).toContain("DTSTART:20260310T160000Z");
  expect(first.content).toContain("DTEND:20260310T170000Z");
  expect(first.content).toContain("DTSTAMP:20260301T120000Z");
  expect(first.content).toContain("SUMMARY:Atención programada");
  expect(first.content).toContain("X-WR-TIMEZONE:America/Santiago");
  expect(first.content.toLowerCase()).not.toContain("cereti");
  expect(first.content.toLowerCase()).not.toContain("profesional secreto");
  expect(first.content.toLowerCase()).not.toContain("necesidad ficticia");
  expect(first.content).not.toContain("VTIMEZONE");
});

test("TI2-122 API: el .ics marca alreadyAdded cuando el evento está sincronizado", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "ics-added");
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: BASE_START,
    endsAt: BASE_START + HOUR,
    calendarEventId: "event-1",
    calendarEventAddedAt: CREATED_AT,
    calendarEventStartsAt: BASE_START,
    calendarEventEndsAt: BASE_START + HOUR,
  });

  const file = await t
    .withIdentity(agenda.studentIdentity)
    .query(api.presentation.appointments.getAppointmentCalendarFile, { appointmentId });
  expect(file.alreadyAdded).toBe(true);
});

test("TI2-122 API: el .ics no marca alreadyAdded si el evento conserva el horario anterior", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "ics-stale");
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: BASE_START,
    endsAt: BASE_START + HOUR,
    calendarEventId: "event-1",
    calendarEventAddedAt: CREATED_AT,
    calendarEventStartsAt: BASE_START - HOUR,
    calendarEventEndsAt: BASE_START,
  });

  const file = await t
    .withIdentity(agenda.studentIdentity)
    .query(api.presentation.appointments.getAppointmentCalendarFile, { appointmentId });
  expect(file.alreadyAdded).toBe(false);
  expect(file.content).toContain("DTSTART:20260310T160000Z");
});

test("TI2-122 API: una atención no vigente no exporta .ics ni crea evento", async () => {
  expect.hasAssertions();
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "not-actionable");
  const asStudent = t.withIdentity(agenda.studentIdentity);

  for (const status of [
    "cancelled_by_student",
    "cancelled_by_cereti",
    "completed",
    "no_show",
    "no_show_justified",
    "no_show_unjustified",
  ] as const) {
    const appointmentId = await seedAppointment(t, {
      accompanimentId: agenda.accompanimentId,
      studentId: agenda.student,
      professionalId: agenda.pro,
      startsAt: BASE_START,
      endsAt: BASE_START + HOUR,
      status,
    });

    const expectedError = { code: "conflict", message: CONFLICT_ERROR_MESSAGE };
    expect(
      await publicErrorData(
        asStudent.query(api.presentation.appointments.getAppointmentCalendarFile, {
          appointmentId,
        }),
      ),
    ).toEqual(expectedError);
    expect(
      await publicErrorData(
        asStudent.action(api.presentation.appointments.addAppointmentToGoogleCalendar, {
          appointmentId,
        }),
      ),
    ).toEqual(expectedError);

    const row = await getAppointment(t, appointmentId);
    expect(row).toMatchObject({ status });
    expect(row?.calendarEventId).toBeUndefined();
  }
});

test("TI2-122 API: el .ics deniega a otros roles, ajenos y anónimos", async () => {
  expect.hasAssertions();
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "ics-denied");
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: BASE_START,
    endsAt: BASE_START + HOUR,
  });
  const other = await seedUser(t, { subject: "ti122-api-ics-other", role: "student" });
  await seedUser(t, { subject: "ti122-api-ics-admin", role: "admin" });

  for (const caller of [
    t.withIdentity(agenda.proIdentity),
    t.withIdentity(agenda.internIdentity),
    t.withIdentity(identityFor("ti122-api-ics-other", "ti122-api-ics-other@alu.uct.cl")),
    t.withIdentity(identityFor("ti122-api-ics-admin", "ti122-api-ics-admin@uct.cl")),
    t,
  ]) {
    await expectUnauthorized(
      caller.query(api.presentation.appointments.getAppointmentCalendarFile, { appointmentId }),
    );
  }
  await expectUnauthorized(
    t
      .withIdentity(agenda.studentIdentity)
      .query(api.presentation.appointments.getAppointmentCalendarFile, { appointmentId: other }),
  );
});

test("TI2-122 API: sin conexión de Google la acción respalda con .ics y no toca la reserva", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "fallback");
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: BASE_START,
    endsAt: BASE_START + HOUR,
  });
  const before = await getAppointment(t, appointmentId);

  const result = await t
    .withIdentity(agenda.studentIdentity)
    .action(api.presentation.appointments.addAppointmentToGoogleCalendar, { appointmentId });

  expect(result.status).toBe("fallback");
  if (result.status !== "fallback") return;
  expect(result.reason).toBe("not_connected");
  expect(result.ics.fileName).toBe("atencion-programada.ics");
  expect(result.ics.content).toContain("DTSTART:20260310T160000Z");
  expect(JSON.stringify(result).toLowerCase()).not.toMatch(
    /access_token|refresh_token|client_secret|error_description/,
  );
  expect(await getAppointment(t, appointmentId)).toEqual(before);
});

test("TI2-122 API: si la atención ya tiene el evento vigente, la acción no llama a Google", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "already");
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: BASE_START,
    endsAt: BASE_START + HOUR,
    calendarEventId: "event-1",
    calendarEventAddedAt: CREATED_AT,
    calendarEventStartsAt: BASE_START,
    calendarEventEndsAt: BASE_START + HOUR,
  });

  const result = await t
    .withIdentity(agenda.studentIdentity)
    .action(api.presentation.appointments.addAppointmentToGoogleCalendar, { appointmentId });

  expect(result).toMatchObject({
    status: "already_created",
    eventId: "event-1",
  });
  expect(result.status === "already_created" && result.ics.content).toContain("BEGIN:VCALENDAR");
  expect(await getAppointment(t, appointmentId)).toMatchObject({
    calendarEventId: "event-1",
    calendarEventAddedAt: CREATED_AT,
  });
});

test("TI2-122 API: una referencia desactualizada no responde already_created", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "stale");
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: BASE_START,
    endsAt: BASE_START + HOUR,
    calendarEventId: "event-1",
    calendarEventAddedAt: CREATED_AT,
    calendarEventStartsAt: BASE_START - HOUR,
    calendarEventEndsAt: BASE_START,
  });

  const result = await t
    .withIdentity(agenda.studentIdentity)
    .action(api.presentation.appointments.addAppointmentToGoogleCalendar, { appointmentId });

  // Sin conexión de Google no puede actualizar: respalda con el .ics vigente
  // en vez de afirmar que el evento ya está creado.
  expect(result.status).toBe("fallback");
  expect(result.status === "fallback" && result.reason).toBe("not_connected");
  expect(result.status === "fallback" && result.ics.content).toContain("DTSTART:20260310T160000Z");
  expect(await getAppointment(t, appointmentId)).toMatchObject({
    calendarEventStartsAt: BASE_START - HOUR,
    calendarEventEndsAt: BASE_START,
  });
});

test("TI2-122 API: la acción deniega a otros roles, ajenos y anónimos", async () => {
  expect.hasAssertions();
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "action-denied");
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: BASE_START,
    endsAt: BASE_START + HOUR,
  });
  const other = await seedUser(t, { subject: "ti122-api-action-other", role: "student" });
  await seedUser(t, { subject: "ti122-api-action-admin", role: "admin" });

  for (const caller of [
    t.withIdentity(agenda.proIdentity),
    t.withIdentity(agenda.internIdentity),
    t.withIdentity(identityFor("ti122-api-action-other", "ti122-api-action-other@alu.uct.cl")),
    t.withIdentity(identityFor("ti122-api-action-admin", "ti122-api-action-admin@uct.cl")),
    t,
  ]) {
    await expectUnauthorized(
      caller.action(api.presentation.appointments.addAppointmentToGoogleCalendar, {
        appointmentId,
      }),
    );
  }
  await expectUnauthorized(
    t
      .withIdentity(agenda.studentIdentity)
      .action(api.presentation.appointments.addAppointmentToGoogleCalendar, {
        appointmentId: other,
      }),
  );
});

test("TI2-122 API: la conexión de Calendar exige una sesión con perfil vigente", async () => {
  expect.hasAssertions();
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "connection", {
    studentInstitutionalStatus: "disabled",
  });

  await expectUnauthorized(t.query(api.presentation.appointments.getCalendarConnection, {}));
  await expectUnauthorized(
    t
      .withIdentity(agenda.studentIdentity)
      .query(api.presentation.appointments.getCalendarConnection, {}),
  );
});

test("TI2-122 API: una cuenta inhabilitada no descarga ni agrega la atención", async () => {
  expect.hasAssertions();
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "disabled-student", {
    studentInstitutionalStatus: "disabled",
  });
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: BASE_START,
    endsAt: BASE_START + HOUR,
  });
  const asStudent = t.withIdentity(agenda.studentIdentity);

  await expectUnauthorized(
    asStudent.query(api.presentation.appointments.getAppointmentCalendarFile, { appointmentId }),
  );
  await expectUnauthorized(
    asStudent.action(api.presentation.appointments.addAppointmentToGoogleCalendar, {
      appointmentId,
    }),
  );
});
