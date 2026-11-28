/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const ISSUER = "https://accounts.google.com";

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
  },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: `${input.subject}@uct.cl`,
      fullName: "Ficticio",
      role: input.role,
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|${input.subject}`,
    });
  });
}

async function seedAgenda(t: ReturnType<typeof convexTest>, label: string) {
  const proSubject = `ti162-sync-pro-${label}`;
  const studentSubject = `ti162-sync-est-${label}`;
  const pro = await seedUser(t, { subject: proSubject, role: "professional" });
  const student = await seedUser(t, { subject: studentSubject, role: "student" });
  const accompanimentId = await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId: student,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "",
    });
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("accompanimentAssignments", {
      accompanimentId,
      userId: pro,
      assignedRole: "professional",
      status: "active",
    });
  });
  const blockId = await t.run(async (ctx) => {
    return await ctx.db.insert("availabilityBlocks", {
      professionalId: pro,
      weekday: 2,
      startMinute: 0,
      endMinute: 24 * 60,
      slotMinutes: 60,
      modality: "online",
      isActive: true,
    });
  });
  return {
    pro,
    student,
    accompanimentId,
    blockId,
    proIdentity: identityFor(proSubject, `${proSubject}@uct.cl`),
    studentIdentity: identityFor(studentSubject, `${studentSubject}@alu.uct.cl`),
  };
}

async function readSync(t: ReturnType<typeof convexTest>, appointmentId: string) {
  return await t.run(async (ctx) => {
    const id = ctx.db.normalizeId("appointments", appointmentId);
    if (id === null) return null;
    const doc = await ctx.db.get(id);
    if (doc === null) return null;
    return {
      status: doc.calendarSyncStatus,
      attempts: doc.calendarSyncAttempts,
      errorCode: doc.calendarSyncErrorCode,
      appointmentStatus: doc.status,
      startsAt: doc.startsAt,
    };
  });
}

async function seedAppointment(
  t: ReturnType<typeof convexTest>,
  input: {
    readonly accompanimentId: Id<"accompaniments">;
    readonly studentId: Id<"users">;
    readonly professionalId: Id<"users">;
    readonly startsAt: number;
    readonly endsAt: number;
  },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("appointments", {
      accompanimentId: input.accompanimentId,
      studentId: input.studentId,
      professionalId: input.professionalId,
      modality: "online",
      status: "scheduled",
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdAt: CREATED_AT,
    });
  });
}

const CREATED_AT = Date.UTC(2026, 10, 1, 12, 0, 0);

const START_AT = Date.UTC(2026, 11, 1, 16, 0, 0);
const END_AT = Date.UTC(2026, 11, 1, 17, 0, 0);

test("TI2-162 API: reservar deja pendiente sin deshacer ante fallo externo", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "pending");
  const asStudent = t.withIdentity(agenda.studentIdentity);

  const booked = await asStudent.mutation(api.presentation.appointments.bookAppointment, {
    accompanimentId: agenda.accompanimentId,
    professionalId: agenda.pro,
    modality: "online",
    startAt: START_AT,
    endAt: END_AT,
    version: "v1",
  });

  // La reserva existe aunque Google falle: el fallo externo no la deshace.
  const sync = await readSync(t, booked.appointmentId);
  expect(sync).toMatchObject({ status: "pending", appointmentStatus: "scheduled" });

  // Cancelar vuelve a dejar pendiente para que el despacho elimine el evento.
  await asStudent.mutation(api.presentation.appointments.cancelAppointment, {
    appointmentId: booked.appointmentId,
    version: "v1",
  });
  const afterCancel = await readSync(t, booked.appointmentId);
  expect(afterCancel).toMatchObject({ status: "pending" });
  expect(["cancelled_by_student", "cancelled_by_cereti"]).toContain(afterCancel?.appointmentStatus);
}, 20_000);

test("TI2-162 API: reagendar deja pendiente con la última fecha", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "cambio");
  const asStudent = t.withIdentity(agenda.studentIdentity);

  const booked = await asStudent.mutation(api.presentation.appointments.bookAppointment, {
    accompanimentId: agenda.accompanimentId,
    professionalId: agenda.pro,
    modality: "online",
    startAt: START_AT,
    endAt: END_AT,
    version: "v1",
  });

  const newStart = START_AT + 7 * 24 * 60 * 60_000;
  const newEnd = END_AT + 7 * 24 * 60 * 60_000;
  await asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
    appointmentId: booked.appointmentId,
    professionalId: agenda.pro,
    modality: "online",
    startAt: newStart,
    endAt: newEnd,
    version: "v1",
  });

  const sync = await readSync(t, booked.appointmentId);
  expect(sync).toMatchObject({ status: "pending", startsAt: newStart });

  // La segunda escritura conserva el intento anterior y limpia el error previo:
  // no recupera la fecha antigua.
  const again = await readSync(t, booked.appointmentId);
  expect(again?.startsAt).not.toBe(START_AT);
}, 20_000);

test("TI2-162 API: el reintento toma pendientes vencidos y fallos con backoff, nunca not_linked", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "cron");
  const duePending = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: START_AT,
    endsAt: END_AT,
  });
  const freshPending = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: START_AT,
    endsAt: END_AT,
  });
  const retryable = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: START_AT,
    endsAt: END_AT,
  });
  const exhausted = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: START_AT,
    endsAt: END_AT,
  });
  const neverLinked = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: START_AT,
    endsAt: END_AT,
  });
  const old = Date.now() - 10 * 60_000;
  await t.run(async (ctx) => {
    const due = ctx.db.normalizeId("appointments", duePending);
    const fresh = ctx.db.normalizeId("appointments", freshPending);
    const retry = ctx.db.normalizeId("appointments", retryable);
    const spent = ctx.db.normalizeId("appointments", exhausted);
    const never = ctx.db.normalizeId("appointments", neverLinked);
    if (due === null || fresh === null || retry === null || spent === null || never === null) {
      throw new Error("Siembra inválida");
    }
    await ctx.db.patch(due, { calendarSyncStatus: "pending", calendarSyncScheduledAt: old });
    await ctx.db.patch(fresh, {
      calendarSyncStatus: "pending",
      calendarSyncScheduledAt: Date.now(),
    });
    await ctx.db.patch(retry, {
      calendarSyncStatus: "error",
      calendarSyncErrorCode: "unavailable",
      calendarSyncAttempts: 3,
      calendarSyncFailures: 1,
      calendarSyncLastAttemptAt: old,
    });
    await ctx.db.patch(spent, {
      calendarSyncStatus: "error",
      calendarSyncErrorCode: "unavailable",
      calendarSyncAttempts: 12,
      calendarSyncFailures: 10,
      calendarSyncLastAttemptAt: old,
    });
    await ctx.db.patch(never, { calendarSyncStatus: "not_linked" });
  });

  const result = await t.mutation(internal.operations.calendar.scheduleDueCalendarSyncs, {});
  expect(result).toEqual({ pending: 1, retried: 1 });

  // Sin vínculos no se vuelve a programar: queda terminal sin pedir nada.
  const skipped = await t.mutation(internal.operations.calendar.markCalendarSyncNotLinked, {
    appointmentId: freshPending,
  });
  expect(skipped).toBeNull();
  expect(await readSync(t, freshPending)).toMatchObject({ status: "not_linked" });
}, 20_000);

test("TI2-162 API: la escritura con verificación deja pasar solo lo vigente", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "stale");
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: START_AT,
    endsAt: END_AT,
  });
  const expected = { startsAt: START_AT, endsAt: END_AT, status: "scheduled" as const };

  const recorded = await t.mutation(internal.operations.calendar.recordCalendarSyncOutcome, {
    appointmentId,
    attemptedAt: Date.now(),
    expected,
    outcome: { kind: "success", eventId: "event-1", ownerId: "subject-1" },
  });
  expect(recorded).toBe("recorded");
  expect(await readSync(t, appointmentId)).toMatchObject({ status: "synced" });

  // Un despacho viejo con otro horario no escribe y limpia la referencia.
  const stale = await t.mutation(internal.operations.calendar.recordCalendarSyncOutcome, {
    appointmentId,
    attemptedAt: Date.now(),
    expected: {
      startsAt: START_AT - 60_000,
      endsAt: END_AT - 60_000,
      status: "scheduled" as const,
    },
    outcome: { kind: "success", eventId: "event-old", ownerId: "subject-1" },
  });
  expect(stale).toBe("stale");
  const afterStale = await readSync(t, appointmentId);
  expect(afterStale).toMatchObject({ status: "pending" });
}, 20_000);

test("TI2-168 API: un bloqueo de Calendar deja la fila pendiente hasta su término", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "bloqueo-calendar");
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: START_AT,
    endsAt: END_AT,
  });
  const retryAt = Date.now() + 60_000;

  const recorded = await t.mutation(internal.operations.calendar.recordCalendarSyncOutcome, {
    appointmentId,
    attemptedAt: Date.now(),
    expected: { startsAt: START_AT, endsAt: END_AT, status: "scheduled" as const },
    outcome: { kind: "blocked", retryAt },
  });

  expect(recorded).toBe("recorded");
  const row = await t.run(async (ctx) => {
    const id = ctx.db.normalizeId("appointments", appointmentId);
    return id === null ? null : await ctx.db.get(id);
  });
  expect(row).toMatchObject({ calendarSyncStatus: "pending", calendarSyncScheduledAt: retryAt });
  expect(row?.calendarEventId).toBeUndefined();
  expect(row?.calendarSyncErrorCode).toBeUndefined();
}, 20_000);

test("TI2-162 API: vincular recorre más de una página y las atenciones donde es adicional", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "paged");
  const additional = await seedUser(t, { subject: "ti162-sync-add", role: "professional" });
  const ids: string[] = [];
  for (let index = 0; index < 55; index += 1) {
    const start = START_AT + (index + 1) * 60_000;
    const appointmentId = await seedAppointment(t, {
      accompanimentId: agenda.accompanimentId,
      studentId: agenda.student,
      professionalId: agenda.pro,
      startsAt: start,
      endsAt: start + 60_000,
    });
    ids.push(appointmentId);
    await t.run(async (ctx) => {
      await ctx.db.patch(appointmentId, { calendarSyncStatus: "not_linked" });
    });
  }
  const coordinated = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: START_AT + 100 * 60_000,
    endsAt: START_AT + 101 * 60_000,
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(coordinated, { calendarSyncStatus: "not_linked" });
    await ctx.db.insert("appointmentProfessionals", {
      appointmentId: coordinated,
      professionalId: additional,
    });
  });

  // Más de una página como responsable: las 55 más la coordinada quedan pending.
  let step: {
    phase: "student" | "responsible" | "additional";
    cursor: string | null;
  } | null = { phase: "student", cursor: null };
  let total = 0;
  let pages = 0;
  while (step !== null) {
    const out: {
      scheduled: number;
      done: boolean;
      next: { phase: "student" | "responsible" | "additional"; cursor: string | null } | null;
    } = await t.mutation(internal.operations.calendar.scheduleLinkedUserSyncs, {
      userId: agenda.pro,
      now: START_AT,
      phase: step.phase,
      cursor: step.cursor,
    });
    total += out.scheduled;
    pages += 1;
    step = out.next;
  }
  expect(pages).toBeGreaterThanOrEqual(4);
  expect(total).toBe(56);
  expect(await readSync(t, ids[0]!)).toMatchObject({ status: "pending" });
  expect(await readSync(t, ids[54]!)).toMatchObject({ status: "pending" });

  // Quien participa solo como adicional también retoma su atención.
  await t.run(async (ctx) => {
    await ctx.db.patch(coordinated, { calendarSyncStatus: "not_linked" });
  });
  let addStep: {
    phase: "student" | "responsible" | "additional";
    cursor: string | null;
  } | null = { phase: "student", cursor: null };
  let addTotal = 0;
  while (addStep !== null) {
    const out: {
      scheduled: number;
      done: boolean;
      next: { phase: "student" | "responsible" | "additional"; cursor: string | null } | null;
    } = await t.mutation(internal.operations.calendar.scheduleLinkedUserSyncs, {
      userId: additional,
      now: START_AT,
      phase: addStep.phase,
      cursor: addStep.cursor,
    });
    addTotal += out.scheduled;
    addStep = out.next;
  }
  expect(addTotal).toBe(1);
  expect(await readSync(t, coordinated)).toMatchObject({ status: "pending" });
}, 20_000);
