/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { AGENDA_TIME_ZONE, civilRangeToInstantRange } from "../domain/availability/availability";
import { noAvailabilityError, unauthorizedError } from "../domain/errors/api_error";
import { SPRINT_1_REQUEST_STATES } from "../domain/requests/state";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

/**
 * Dataset ficticio del Sprint 1 (TI2-30) y de agenda (TI2-108). Cada prueba
 * fija el interruptor de semillas: vacío reproduce producción.
 */

/** Identidad del dataset: el emisor inventado no coincide con una sesión real. */
function identityOf(subject: string) {
  return { issuer: "dataset-ficticio", subject, tokenIdentifier: `dataset-ficticio|${subject}` };
}

/**
 * Instante de una fecha y minuto civiles en la zona de la agenda, la misma
 * conversión que usa la API. Comprueba que las semillas no se generaron en UTC.
 */
function agendaInstant(day: string, minuteOfDay: number): number {
  const { startAt } = civilRangeToInstantRange({ from: day, to: day, timeZone: AGENDA_TIME_ZONE });
  return startAt + minuteOfDay * 60_000;
}

/** Datos del error público lanzado, o falla si la llamada no se rechazó. */
async function publicError(promise: Promise<unknown>) {
  return await promise.then(
    () => {
      throw new Error("Se esperaba un error público");
    },
    (error: unknown) => (error instanceof ConvexError ? error.data : error),
  );
}

async function snapshot(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ({
    users: await ctx.db.query("users").collect(),
    requests: await ctx.db.query("requests").collect(),
    transitions: await ctx.db.query("requestTransitions").collect(),
    accompaniments: await ctx.db.query("accompaniments").collect(),
    assignments: await ctx.db.query("accompanimentAssignments").collect(),
    spaces: await ctx.db.query("spaces").collect(),
    availabilityBlocks: await ctx.db.query("availabilityBlocks").collect(),
    availabilityExceptions: await ctx.db.query("availabilityExceptions").collect(),
    appointments: await ctx.db.query("appointments").collect(),
  }));
}

test("sin interruptor (producción) rechaza la carga del dataset", async () => {
  vi.stubEnv("TEST_SEEDS_ENABLED", "");
  const t = convexTest(schema, modules);
  await expect(t.mutation(internal.operations.fictitiousData.load, {})).rejects.toThrow(
    "no están habilitadas en este entorno",
  );
});

test("sin interruptor (producción) rechaza crear solicitudes de prueba", async () => {
  vi.stubEnv("TEST_SEEDS_ENABLED", "");
  const t = convexTest(schema, modules);
  const studentId = await t.run((ctx) =>
    ctx.db.insert("users", {
      email: "guardia.solicitud@alu.uct.cl",
      fullName: "Guardia Solicitud",
      role: "student",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: "https://accounts.google.com|guardia-solicitud",
    }),
  );
  await expect(
    t.mutation(internal.operations.requests.createTestRequest, {
      studentId,
      status: "received",
      accessNeeds: "Necesidad de acceso ficticia",
    }),
  ).rejects.toThrow("no están habilitadas en este entorno");
});

test("carga una solicitud por estado del Sprint 1 y un acompañamiento con Practicante", async () => {
  vi.stubEnv("TEST_SEEDS_ENABLED", "true");
  const t = convexTest(schema, modules);
  expect(await t.mutation(internal.operations.fictitiousData.load, {})).toEqual({ loaded: true });

  const data = await snapshot(t);
  expect(data.users.map((user) => user.role).sort()).toEqual([
    "intern",
    "professional",
    "student",
    "student",
    "student",
    "student",
  ]);
  expect(data.users.every((user) => user.tokenIdentifier.startsWith("dataset-ficticio|"))).toBe(
    true,
  );
  expect(data.requests.map((request) => request.status).sort()).toEqual(
    [...SPRINT_1_REQUEST_STATES].sort(),
  );
  // Tomar, pedir información y aceptar registran cada cambio de estado.
  expect(data.transitions).toHaveLength(5);

  const accepted = data.requests.find((request) => request.status === "accepted");
  expect(data.accompaniments).toHaveLength(1);
  expect(data.accompaniments[0]?.requestId).toBe(accepted?._id);
  expect(
    data.assignments
      .filter((assignment) => assignment.status === "active")
      .map((assignment) => assignment.assignedRole)
      .sort(),
  ).toEqual(["intern", "professional"]);

  // La sala cubre la necesidad vigente del acompañamiento: los cupos
  // presenciales resultan compatibles en la búsqueda real.
  expect(data.spaces).toHaveLength(1);
  expect(data.spaces[0]?.accessConditions).toBe(accepted?.accessNeeds);
  expect(data.availabilityBlocks.map((block) => block.modality).sort()).toEqual([
    "inPerson",
    "online",
  ]);

  // Una excepción cancela el bloque presencial de un lunes y otra agrega una
  // ventana el sábado, ambas con fechas deterministas.
  expect(data.availabilityExceptions.map((exception) => exception.kind).sort()).toEqual([
    "added",
    "cancelled",
  ]);
  const cancelledException = data.availabilityExceptions.find(
    (exception) => exception.kind === "cancelled",
  );
  expect(cancelledException?.date).toBe(Date.UTC(2026, 9, 12));
  expect(cancelledException?.blockId).toBeDefined();
  const addedException = data.availabilityExceptions.find(
    (exception) => exception.kind === "added",
  );
  expect(addedException).toMatchObject({
    date: Date.UTC(2026, 9, 17),
    startMinute: 600,
    endMinute: 660,
    slotMinutes: 60,
    modality: "inPerson",
  });

  expect(data.appointments.map((appointment) => appointment.status).sort()).toEqual([
    "cancelled_by_student",
    "completed",
    "no_show",
    "scheduled",
  ]);
  // Las atenciones se generan en la zona de la agenda: las 10:00 civiles de
  // cada lunes, la misma hora que el bloque presencial.
  expect(
    data.appointments.map((appointment) => appointment.startsAt).sort((a, b) => a - b),
  ).toEqual(
    ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"].map((day) => agendaInstant(day, 600)),
  );
});

test("una segunda carga no escribe nada", async () => {
  vi.stubEnv("TEST_SEEDS_ENABLED", "true");
  const t = convexTest(schema, modules);
  await t.mutation(internal.operations.fictitiousData.load, {});
  const first = await snapshot(t);

  expect(await t.mutation(internal.operations.fictitiousData.load, {})).toEqual({ loaded: false });
  expect(await snapshot(t)).toEqual(first);
});

test("las atenciones sembradas quedan completas para la auditoría (TI2-138)", async () => {
  vi.stubEnv("TEST_SEEDS_ENABLED", "true");
  const t = convexTest(schema, modules);
  await t.mutation(internal.operations.fictitiousData.load, {});

  // La semilla no pasa por `occupySlotAtomically`, pero deja las atenciones
  // con la misma forma: la auditoría no encuentra nada pendiente de migrar.
  const audit = await t.query(internal.operations.migrations.auditAppointmentParticipants, {
    paginationOpts: { numItems: 20, cursor: null },
  });
  expect(audit).toMatchObject({
    scanned: 4,
    missingAppliedAccessNeeds: 0,
    missingParticipants: 0,
    isDone: true,
    sampleLegacyIds: [],
  });

  const data = await t.run(async (ctx) => ({
    appointments: await ctx.db.query("appointments").collect(),
    participants: await ctx.db.query("appointmentProfessionals").collect(),
    professionals: await ctx.db.query("users").collect(),
  }));
  const expectedNeeds = [
    {
      id: "Sala con acceso sin escaleras para las clases prácticas.",
      label: "Sala con acceso sin escaleras para las clases prácticas.",
    },
  ];
  const professionalId = data.professionals.find((user) => user.role === "professional")?._id;
  expect(professionalId).toBeDefined();
  expect(data.appointments).toHaveLength(4);
  expect(data.participants).toHaveLength(4);
  for (const appointment of data.appointments) {
    expect(appointment.appliedAccessNeeds).toEqual(expectedNeeds);
    const participants = data.participants.filter(
      (participant) => participant.appointmentId === appointment._id,
    );
    expect(participants).toHaveLength(1);
    expect(participants[0]).toMatchObject({
      professionalId,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
    });
  }
});

test("consultas por rol respetan aislamiento sobre el dataset cargado", async () => {
  vi.stubEnv("TEST_SEEDS_ENABLED", "true");
  const t = convexTest(schema, modules);
  await t.mutation(internal.operations.fictitiousData.load, {});

  // Estudiante propio (Estudiante Cuatro, dueño del acompañamiento y atenciones)
  const asStudent = t.withIdentity(identityOf("estudiante-4"));
  const accompanimentId = (await t.run(
    async (ctx) => (await ctx.db.query("accompaniments").first())?._id,
  ))!;
  const studentAccompaniment = await asStudent.query(
    api.presentation.accompaniments.getAccompaniment,
    {
      accompanimentId,
    },
  );
  expect(studentAccompaniment.view).toBe("full");

  // Estudiante ajeno (Estudiante Uno no debe tener acceso al acompañamiento de Cuatro)
  const asStrangerStudent = t.withIdentity(identityOf("estudiante-1"));
  await expect(
    asStrangerStudent.query(api.presentation.accompaniments.getAccompaniment, {
      accompanimentId,
    }),
  ).rejects.toThrow("No autorizado");

  // Profesional asignado
  const asProfessional = t.withIdentity(identityOf("profesional-1"));
  const proAccompaniment = await asProfessional.query(
    api.presentation.accompaniments.getAccompaniment,
    {
      accompanimentId,
    },
  );
  expect(proAccompaniment.view).toBe("full");

  // Practicante asignado (ve vista minimizada)
  const asIntern = t.withIdentity(identityOf("practicante-1"));
  const internAccompaniment = await asIntern.query(
    api.presentation.accompaniments.getAccompaniment,
    {
      accompanimentId,
    },
  );
  expect(internAccompaniment.view).toBe("minimized");

  // Administrador sin acceso general a acompañamientos individuales sin rol clínico/asignación
  await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "admin.ficticio@uct.cl",
      fullName: "Administrador Ficticio",
      role: "admin",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: "dataset-ficticio|admin-1",
    });
  });
  const asAdmin = t.withIdentity(identityOf("admin-1"));
  await expect(
    asAdmin.query(api.presentation.accompaniments.getAccompaniment, {
      accompanimentId,
    }),
  ).rejects.toThrow("No autorizado");
});

test("las atenciones sembradas se consultan con la vista y el alcance de cada rol (TI2-112)", async () => {
  vi.stubEnv("TEST_SEEDS_ENABLED", "true");
  const t = convexTest(schema, modules);
  await t.mutation(internal.operations.fictitiousData.load, {});

  const seed = await t.run(async (ctx) => {
    const accompanimentId = (await ctx.db.query("accompaniments").first())!._id;
    const appointments = (await ctx.db.query("appointments").collect()).sort(
      (a, b) => a.startsAt - b.startsAt,
    );
    return { accompanimentId, appointments };
  });
  const range = { from: "2026-09-21", to: "2026-11-08", limit: 10, version: "v1" as const };
  const scoped = { ...range, accompanimentId: seed.accompanimentId };
  const ids = seed.appointments.map((appointment) => String(appointment._id));
  const cancelledId = String(
    seed.appointments.find((appointment) => appointment.status === "cancelled_by_student")!._id,
  );

  // Estudiante dueño: vista compartida, sin el motivo de cancelación ni
  // datos de terceros en la lista ni en el detalle.
  const asStudent = t.withIdentity(identityOf("estudiante-4"));
  const studentPage = await asStudent.query(api.presentation.appointments.listAppointments, scoped);
  expect(studentPage.items.map((item) => item.id)).toEqual(ids);
  expect(studentPage.items.every((item) => item.view === "shared")).toBe(true);
  for (const item of studentPage.items) {
    expect(item).not.toHaveProperty("cancelReason");
    expect(item).not.toHaveProperty("studentId");
    expect(item).not.toHaveProperty("notes");
  }
  const studentDetail = await asStudent.query(api.presentation.appointments.getAppointment, {
    appointmentId: cancelledId,
    version: "v1",
  });
  expect(studentDetail.view).toBe("shared");
  expect(studentDetail).not.toHaveProperty("cancelReason");

  // Profesional asignado: vista completa, con el motivo que el Estudiante no ve.
  const asProfessional = t.withIdentity(identityOf("profesional-1"));
  const proDetail = await asProfessional.query(api.presentation.appointments.getAppointment, {
    appointmentId: cancelledId,
    version: "v1",
  });
  expect(proDetail).toMatchObject({ view: "full", cancelReason: expect.any(String) });

  // Practicante asignado: vista minimizada, sin vínculos, fechas originales
  // ni motivos. Su agenda propia no existe: solo lee por acompañamiento.
  const asIntern = t.withIdentity(identityOf("practicante-1"));
  const internPage = await asIntern.query(api.presentation.appointments.listAppointments, scoped);
  for (const item of internPage.items) {
    expect(Object.keys(item).sort()).toEqual([
      "endAt",
      "id",
      "modality",
      "startAt",
      "status",
      "view",
    ]);
    expect(item.view).toBe("minimized");
    expect(item).not.toHaveProperty("notes");
  }
  expect(
    await publicError(asIntern.query(api.presentation.appointments.listAppointments, range)),
  ).toStrictEqual(unauthorizedError());

  // Estudiante ajeno, Administrador y sesión sin identidad: el mismo error
  // genérico, sin revelar el recurso.
  const asStranger = t.withIdentity(identityOf("estudiante-1"));
  expect(
    await publicError(asStranger.query(api.presentation.appointments.listAppointments, scoped)),
  ).toStrictEqual(unauthorizedError());
  expect(
    await publicError(
      asStranger.query(api.presentation.appointments.getAppointment, {
        appointmentId: cancelledId,
        version: "v1",
      }),
    ),
  ).toStrictEqual(unauthorizedError());

  await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "admin.ficticio@uct.cl",
      fullName: "Administrador Ficticio",
      role: "admin",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: "dataset-ficticio|admin-1",
    });
  });
  const asAdmin = t.withIdentity(identityOf("admin-1"));
  expect(
    await publicError(asAdmin.query(api.presentation.appointments.listAppointments, scoped)),
  ).toStrictEqual(unauthorizedError());
  expect(
    await publicError(asAdmin.query(api.presentation.appointments.listAppointments, range)),
  ).toStrictEqual(unauthorizedError());
  expect(
    await publicError(t.query(api.presentation.appointments.listAppointments, range)),
  ).toStrictEqual(unauthorizedError());

  // Revocar la asignación del Practicante le quita el alcance en la llamada
  // siguiente, sin tocar las atenciones ni las demás asignaciones.
  await t.run(async (ctx) => {
    const assignments = await ctx.db.query("accompanimentAssignments").collect();
    const internAssignment = assignments.find(
      (assignment) =>
        assignment.accompanimentId === seed.accompanimentId &&
        assignment.assignedRole === "intern" &&
        assignment.status === "active",
    )!;
    await ctx.db.patch(internAssignment._id, { status: "revoked" });
  });
  expect(
    await publicError(asIntern.query(api.presentation.appointments.listAppointments, scoped)),
  ).toStrictEqual(unauthorizedError());
  expect(
    await publicError(
      asIntern.query(api.presentation.appointments.getAppointment, {
        appointmentId: ids[0]!,
        version: "v1",
      }),
    ),
  ).toStrictEqual(unauthorizedError());
});

test("la disponibilidad sembrada distingue el bloque cancelado y la ventana agregada", async () => {
  vi.stubEnv("TEST_SEEDS_ENABLED", "true");
  const t = convexTest(schema, modules);
  await t.mutation(internal.operations.fictitiousData.load, {});

  const ids = await t.run(async (ctx) => {
    const accompanimentId = (await ctx.db.query("accompaniments").first())!._id;
    const professionalId = (await ctx.db.query("users").collect()).find(
      (user) => user.role === "professional",
    )!._id;
    return { accompanimentId, professionalId };
  });

  const asStudent = t.withIdentity(identityOf("estudiante-4"));
  const search = (from: string, to: string) =>
    asStudent.query(api.presentation.availability.searchSlots, {
      accompanimentId: ids.accompanimentId,
      professionalId: ids.professionalId,
      from,
      to,
      limit: 10,
      version: "v1",
    });

  // El lunes 2026-10-12 el bloque presencial está cancelado y el bloque en
  // línea no cubre las necesidades: no queda cupo compatible.
  expect(await publicError(search("2026-10-12", "2026-10-12"))).toStrictEqual(
    noAvailabilityError(),
  );

  // La ventana agregada del sábado 2026-10-17 sí ofrece el cupo presencial,
  // en las 10:00 civiles de la agenda.
  const added = await search("2026-10-17", "2026-10-17");
  expect(added.items).toHaveLength(1);
  expect(added.items[0]).toMatchObject({
    date: "2026-10-17",
    startAt: agendaInstant("2026-10-17", 600),
    endAt: agendaInstant("2026-10-17", 660),
    modality: "inPerson",
    spaceId: String(await t.run(async (ctx) => (await ctx.db.query("spaces").first())!._id)),
  });

  // Un lunes sin excepciones recupera el cupo recurrente en la misma hora
  // civil que las atenciones sembradas.
  const recurring = await search("2026-10-26", "2026-10-26");
  expect(recurring.items).toHaveLength(1);
  expect(recurring.items[0]?.startAt).toBe(agendaInstant("2026-10-26", 600));

  // El Profesional ve sus bloques y las dos excepciones por la misma API.
  const asProfessional = t.withIdentity(identityOf("profesional-1"));
  const own = await asProfessional.query(api.presentation.availability.listOwnAvailability, {
    from: "2026-10-01",
    to: "2026-10-31",
    version: "v1",
  });
  expect(own.blocks.map((block) => block.modality).sort()).toEqual(["inPerson", "online"]);
  expect(own.exceptions.map((exception) => exception.kind).sort()).toEqual(["added", "cancelled"]);
  expect(own.exceptions.find((exception) => exception.kind === "cancelled")?.blockId).toBeDefined();
  const addedOwn = own.exceptions.find((exception) => exception.kind === "added");
  expect(
    addedOwn !== undefined && "windows" in addedOwn ? addedOwn.windows : undefined,
  ).toHaveLength(1);
});
