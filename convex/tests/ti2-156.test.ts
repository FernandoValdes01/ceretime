/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const ISSUER = "https://accounts.google.com";
const NOW = Date.UTC(2027, 0, 1, 12);
const at = (hour: number, minute = 0) => Date.UTC(2027, 0, 4, hour + 3, minute);
const pastAt = (hour: number, minute = 0) => Date.UTC(2026, 11, 28, hour + 3, minute);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function identityFor(subject: string) {
  return { subject, issuer: ISSUER, tokenIdentifier: `${ISSUER}|${subject}`, name: "Ficticio" };
}

async function seedUser(
  t: TestConvex<typeof schema>,
  subject: string,
  role: "student" | "professional" | "admin",
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: `${subject}@uct.cl`,
      fullName: "Ficticio",
      role,
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|${subject}`,
    });
  });
}

async function seedSpace(t: TestConvex<typeof schema>): Promise<Id<"spaces">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("spaces", {
      campus: "Campus Ficticio",
      building: "Edificio Ficticio",
      floor: "Piso 1",
      room: "Sala Ficticia 1",
      accessConditions: "Sala silenciosa",
      accessInstructions: "Instrucción ficticia",
      isActive: true,
    });
  });
}

async function seedAccompaniment(
  t: TestConvex<typeof schema>,
  studentId: Id<"users">,
  accessNeeds: string,
): Promise<Id<"accompaniments">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds,
    });
  });
}

async function seedAssignment(
  t: TestConvex<typeof schema>,
  accompanimentId: Id<"accompaniments">,
  userId: Id<"users">,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("accompanimentAssignments", {
      accompanimentId,
      userId,
      assignedRole: "professional",
      status: "active",
    });
  });
}

async function seedBlock(
  t: TestConvex<typeof schema>,
  professionalSubject: string,
  spaceId: Id<"spaces">,
): Promise<string> {
  const asPro = t.withIdentity(identityFor(professionalSubject));
  const result = await asPro.mutation(api.presentation.availability.publishBlock, {
    weekday: 1,
    startMinute: 540,
    endMinute: 720,
    slotMinutes: 30,
    modality: "inPerson",
    spaceId,
    version: "v1",
  });
  return result.blockId;
}

async function seedAppointment(
  t: TestConvex<typeof schema>,
  input: {
    accompanimentId: Id<"accompaniments">;
    studentId: Id<"users">;
    professionalId: Id<"users">;
    spaceId?: Id<"spaces">;
    startsAt: number;
    endsAt: number;
    status: Doc<"appointments">["status"];
  },
): Promise<Id<"appointments">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("appointments", {
      accompanimentId: input.accompanimentId,
      studentId: input.studentId,
      professionalId: input.professionalId,
      ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
      modality: "inPerson",
      status: input.status,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdAt: NOW,
    });
  });
}

async function seedAgenda(t: TestConvex<typeof schema>) {
  const student = await seedUser(t, "ti156-est", "student");
  const professional = await seedUser(t, "ti156-pro", "professional");
  const admin = await seedUser(t, "ti156-adm", "admin");
  const spaceId = await seedSpace(t);
  const accompanimentId = await seedAccompaniment(t, student, "Sala silenciosa");
  await seedAssignment(t, accompanimentId, professional);
  const blockId = await seedBlock(t, "ti156-pro", spaceId);
  const futureId = await seedAppointment(t, {
    accompanimentId,
    studentId: student,
    professionalId: professional,
    spaceId,
    startsAt: at(9),
    endsAt: at(9, 30),
    status: "scheduled",
  });
  const pastId = await seedAppointment(t, {
    accompanimentId,
    studentId: student,
    professionalId: professional,
    spaceId,
    startsAt: pastAt(9),
    endsAt: pastAt(9, 30),
    status: "completed",
  });
  return { student, professional, admin, spaceId, accompanimentId, blockId, futureId, pastId };
}

async function notificationKindsFor(
  t: TestConvex<typeof schema>,
  appointmentId: Id<"appointments">,
) {
  const rows = await t.run(async (ctx) => {
    return await ctx.db
      .query("notificationEvents")
      .withIndex("by_appointmentId_and_occurredAt", (q) => q.eq("appointmentId", appointmentId))
      .take(20);
  });
  return rows.map((row) => row.kind);
}

async function appointmentStatus(t: TestConvex<typeof schema>, appointmentId: Id<"appointments">) {
  const row = await t.run(async (ctx) => await ctx.db.get(appointmentId));
  return row?.status;
}

test("desactivar el bloque conserva la atención y avisa a la futura, sin tocar la anterior", async () => {
  const t = convexTest(schema, modules);
  const { blockId, futureId, pastId } = await seedAgenda(t);
  const asPro = t.withIdentity(identityFor("ti156-pro"));

  await asPro.mutation(api.presentation.availability.setBlockActive, {
    blockId,
    isActive: false,
    version: "v1",
  });

  // El cambio queda conservado.
  const block = await t.run(async (ctx) => await ctx.db.get(blockId as Id<"availabilityBlocks">));
  expect(block?.isActive).toBe(false);

  // La atención confirmada nunca desaparece: sigue agendada.
  expect(await appointmentStatus(t, futureId)).toBe("scheduled");
  expect(await appointmentStatus(t, pastId)).toBe("completed");

  // La futura queda informada, la anterior no cambia ni se avisa.
  expect(await notificationKindsFor(t, futureId)).toContain("appointment_availability_changed");
  expect(await notificationKindsFor(t, pastId)).toEqual([]);
});

test("retirar la sala conserva la atención y avisa a la futura", async () => {
  const t = convexTest(schema, modules);
  const { spaceId, futureId, pastId } = await seedAgenda(t);
  const asAdmin = t.withIdentity(identityFor("ti156-adm"));

  await asAdmin.mutation(api.presentation.spaces.setSpaceActive, {
    spaceId,
    isActive: false,
    version: "v1",
  });

  const space = await t.run(async (ctx) => await ctx.db.get(spaceId));
  expect(space?.isActive).toBe(false);

  expect(await appointmentStatus(t, futureId)).toBe("scheduled");
  expect(await notificationKindsFor(t, futureId)).toContain("appointment_space_changed");
  expect(await notificationKindsFor(t, pastId)).toEqual([]);
});

test("actualizar necesidades avisa a futuras incompatibles sin alterar anteriores", async () => {
  const t = convexTest(schema, modules);
  const { accompanimentId, futureId, pastId } = await seedAgenda(t);
  const asStudent = t.withIdentity(identityFor("ti156-est"));

  await asStudent.mutation(api.presentation.accompaniments.updateAccompanimentNeeds, {
    accompanimentId,
    accessNeeds: "Sala silenciosa\nIntérprete de lengua de señas",
  });

  const accessNeeds = await t.run(async (ctx) => (await ctx.db.get(accompanimentId))?.accessNeeds);
  expect(accessNeeds).toContain("Intérprete");

  // El aviso conserva solo referencias, sin copiar las necesidades.
  const notices = await t.run(async (ctx) => await ctx.db.query("notificationEvents").take(20));
  expect(JSON.stringify(notices)).not.toContain("Intérprete");

  expect(await appointmentStatus(t, futureId)).toBe("scheduled");
  expect(await appointmentStatus(t, pastId)).toBe("completed");
  expect(await notificationKindsFor(t, futureId)).toContain("appointment_needs_updated");
  expect(await notificationKindsFor(t, pastId)).toEqual([]);
});

test("administración lista salas retiradas para reactivarlas", async () => {
  const t = convexTest(schema, modules);
  const { spaceId } = await seedAgenda(t);
  const asAdmin = t.withIdentity(identityFor("ti156-adm"));
  const asStudent = t.withIdentity(identityFor("ti156-est"));

  await asAdmin.mutation(api.presentation.spaces.setSpaceActive, {
    spaceId,
    isActive: false,
    version: "v1",
  });

  const retired = await asAdmin.query(api.presentation.spaces.listInactiveSpaces, {
    limit: 10,
    version: "v1",
  });
  expect(retired.items.map((item) => item.id)).toContain(spaceId);
  await expect(
    asStudent.query(api.presentation.spaces.listInactiveSpaces, { limit: 10, version: "v1" }),
  ).rejects.toThrow("No autorizado");
});
