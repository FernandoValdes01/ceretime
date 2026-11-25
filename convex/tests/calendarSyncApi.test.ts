/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
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
