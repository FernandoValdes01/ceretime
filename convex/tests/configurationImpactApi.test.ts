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

test("un cambio que no afecta no vuelve a avisar ni toca lo ya roto", async () => {
  const t = convexTest(schema, modules);
  const { blockId, futureId } = await seedAgenda(t);
  const asPro = t.withIdentity(identityFor("ti156-pro"));

  await asPro.mutation(api.presentation.availability.setBlockActive, {
    blockId,
    isActive: false,
    version: "v1",
  });
  expect(await notificationKindsFor(t, futureId)).toHaveLength(1);

  // Publica y retira otro bloque de otro día: no toca la atención del lunes.
  const other = await asPro.mutation(api.presentation.availability.publishBlock, {
    weekday: 2,
    startMinute: 540,
    endMinute: 720,
    slotMinutes: 30,
    modality: "online",
    version: "v1",
  });
  const blocks = await t.run(async (ctx) => ctx.db.query("availabilityBlocks").take(20));
  const tuesday = blocks.find((row) => row.weekday === 2);
  expect(tuesday).toBeDefined();
  await asPro.mutation(api.presentation.availability.setBlockActive, {
    blockId: other.blockId,
    isActive: false,
    version: "v1",
  });
  expect(await notificationKindsFor(t, futureId)).toHaveLength(1);

  // Reactivar solo agrega disponibilidad: no avisa de nuevo.
  await asPro.mutation(api.presentation.availability.setBlockActive, {
    blockId,
    isActive: true,
    version: "v1",
  });
  expect(await notificationKindsFor(t, futureId)).toHaveLength(1);
  expect(await appointmentStatus(t, futureId)).toBe("scheduled");
});

test("el profesional adicional recibe aviso cuando su agenda deja de cubrir", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, "ti156-est2", "student");
  const responsible = await seedUser(t, "ti156-pro2", "professional");
  const additional = await seedUser(t, "ti156-add2", "professional");
  const admin = await seedUser(t, "ti156-adm2", "admin");
  void admin;
  const spaceId = await seedSpace(t);
  const accompanimentId = await seedAccompaniment(t, student, "Sala silenciosa");
  await seedAssignment(t, accompanimentId, responsible);
  await seedAssignment(t, accompanimentId, additional);
  const responsibleBlock = await seedBlock(t, "ti156-pro2", spaceId);
  void responsibleBlock;
  const additionalBlock = await seedBlock(t, "ti156-add2", spaceId);

  const futureId = await t.run(async (ctx) => {
    const appointmentId = await ctx.db.insert("appointments", {
      accompanimentId,
      studentId: student,
      professionalId: responsible,
      spaceId,
      modality: "inPerson",
      status: "scheduled",
      startsAt: at(9),
      endsAt: at(9, 30),
      createdAt: NOW,
    });
    await ctx.db.insert("appointmentProfessionals", {
      appointmentId,
      professionalId: responsible,
    });
    await ctx.db.insert("appointmentProfessionals", {
      appointmentId,
      professionalId: additional,
    });
    return appointmentId;
  });

  const asAdditional = t.withIdentity(identityFor("ti156-add2"));
  await asAdditional.mutation(api.presentation.availability.setBlockActive, {
    blockId: additionalBlock,
    isActive: false,
    version: "v1",
  });

  expect(await appointmentStatus(t, futureId)).toBe("scheduled");
  expect(await notificationKindsFor(t, futureId)).toContain("appointment_availability_changed");
});

test("cambiar la ubicación avisa a todas aunque sigan compatibles", async () => {
  const t = convexTest(schema, modules);
  const { spaceId, futureId } = await seedAgenda(t);
  const asAdmin = t.withIdentity(identityFor("ti156-adm"));

  await asAdmin.mutation(api.presentation.spaces.updateSpace, {
    spaceId,
    campus: "Campus Ficticio",
    building: "Edificio Ficticio",
    floor: "Piso 1",
    room: "Sala Ficticia 1B",
    accessConditions: "Sala silenciosa",
    arrivalInstructions: "Instrucción ficticia",
    version: "v1",
  });

  expect(await appointmentStatus(t, futureId)).toBe("scheduled");
  expect(await notificationKindsFor(t, futureId)).toContain("appointment_space_changed");
});

test("cambiar solo condiciones avisa únicamente a la que deja de ser compatible", async () => {
  const t = convexTest(schema, modules);
  const { spaceId, futureId } = await seedAgenda(t);
  const asAdmin = t.withIdentity(identityFor("ti156-adm"));

  // Agrega una condición sin quitar la que cubre: sigue compatible, no avisa.
  await asAdmin.mutation(api.presentation.spaces.updateSpace, {
    spaceId,
    campus: "Campus Ficticio",
    building: "Edificio Ficticio",
    floor: "Piso 1",
    room: "Sala Ficticia 1",
    accessConditions: "Sala silenciosa\nOtra condición",
    arrivalInstructions: "Instrucción ficticia",
    version: "v1",
  });
  expect(await notificationKindsFor(t, futureId)).toEqual([]);

  // Quita la que cubre: deja de ser compatible y avisa una sola vez por destinatario.
  await asAdmin.mutation(api.presentation.spaces.updateSpace, {
    spaceId,
    campus: "Campus Ficticio",
    building: "Edificio Ficticio",
    floor: "Piso 1",
    room: "Sala Ficticia 1",
    accessConditions: "Otra condición",
    arrivalInstructions: "Instrucción ficticia",
    version: "v1",
  });
  expect(await notificationKindsFor(t, futureId)).toEqual([
    "appointment_space_changed",
    "appointment_space_changed",
  ]);
});

test("actualizar necesidades versiona y la pasada se evalúa con la anterior", async () => {
  const t = convexTest(schema, modules);
  const { accompanimentId, futureId, pastId } = await seedAgenda(t);
  const asStudent = t.withIdentity(identityFor("ti156-est"));

  await asStudent.mutation(api.presentation.accompaniments.updateAccompanimentNeeds, {
    accompanimentId,
    accessNeeds: "Sala silenciosa\nIntérprete de lengua de señas",
  });

  const versions = await t.run(async (ctx) =>
    ctx.db
      .query("accompanimentNeeds")
      .withIndex("by_accompanimentId_and_validFrom", (q) =>
        q.eq("accompanimentId", accompanimentId),
      )
      .take(10),
  );
  expect(versions).toHaveLength(2);
  const [first, second] = [...versions].sort((a, b) => a.validFrom - b.validFrom);
  expect(first.accessNeeds).toBe("Sala silenciosa");
  expect(first.validUntil).toBeDefined();
  expect(second.accessNeeds).toContain("Intérprete");
  expect(second.validUntil).toBeUndefined();

  expect(await appointmentStatus(t, futureId)).toBe("scheduled");
  expect(await appointmentStatus(t, pastId)).toBe("completed");
  expect(await notificationKindsFor(t, pastId)).toEqual([]);
});

test("otra persona no actualiza necesidades y el cierre responde conflicto", async () => {
  const t = convexTest(schema, modules);
  const { accompanimentId } = await seedAgenda(t);
  const asPro = t.withIdentity(identityFor("ti156-pro"));
  await expect(
    asPro.mutation(api.presentation.accompaniments.updateAccompanimentNeeds, {
      accompanimentId,
      accessNeeds: "Otra necesidad",
    }),
  ).rejects.toThrow("No autorizado");

  await t.run(async (ctx) => {
    await ctx.db.patch(accompanimentId, { status: "closed" });
  });
  const asStudent = t.withIdentity(identityFor("ti156-est"));
  await expect(
    asStudent.mutation(api.presentation.accompaniments.updateAccompanimentNeeds, {
      accompanimentId,
      accessNeeds: "Otra necesidad",
    }),
  ).rejects.toThrow("conflict");
});

test("el tope por día revierte sin escribir ni avisar", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, "ti156-est-tope", "student");
  const professional = await seedUser(t, "ti156-pro-tope", "professional");
  const spaceId = await seedSpace(t);
  const accompanimentId = await seedAccompaniment(t, student, "Sala silenciosa");
  await seedAssignment(t, accompanimentId, professional);
  const blockId = await seedBlock(t, "ti156-pro-tope", spaceId);

  for (let i = 0; i < 301; i += 1) {
    await t.run(async (ctx) => {
      await ctx.db.insert("appointments", {
        accompanimentId,
        studentId: student,
        professionalId: professional,
        spaceId,
        modality: "inPerson",
        status: "scheduled",
        startsAt: at(9) + i * 1000,
        endsAt: at(9, 30) + i * 1000,
        createdAt: NOW,
      });
    });
  }

  const asPro = t.withIdentity(identityFor("ti156-pro-tope"));
  await expect(
    asPro.mutation(api.presentation.availability.setBlockActive, {
      blockId,
      isActive: false,
      version: "v1",
    }),
  ).rejects.toThrow("conflicto");

  const after = await t.run(async (ctx) => await ctx.db.get(blockId as Id<"availabilityBlocks">));
  expect(after?.isActive).toBe(true);
  const notices = await t.run(async (ctx) => await ctx.db.query("notificationEvents").take(20));
  expect(notices).toEqual([]);
});

test("el historial como adicional no bloquea la edición", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, "ti156-est-hist", "student");
  const professional = await seedUser(t, "ti156-pro-hist", "professional");
  const otherPro = await seedUser(t, "ti156-pro-hist-otro", "professional");
  const spaceId = await seedSpace(t);
  const accompanimentId = await seedAccompaniment(t, student, "Sala silenciosa");
  await seedAssignment(t, accompanimentId, professional);
  await seedAssignment(t, accompanimentId, otherPro);
  const blockId = await seedBlock(t, "ti156-pro-hist", spaceId);
  const futureId = await seedAppointment(t, {
    accompanimentId,
    studentId: student,
    professionalId: professional,
    spaceId,
    startsAt: at(9),
    endsAt: at(9, 30),
    status: "scheduled",
  });

  for (let i = 0; i < 301; i += 1) {
    await t.run(async (ctx) => {
      const pastId = await ctx.db.insert("appointments", {
        accompanimentId,
        studentId: student,
        professionalId: otherPro,
        modality: "inPerson",
        status: "completed",
        startsAt: pastAt(9) - i * 1000,
        endsAt: pastAt(9, 30) - i * 1000,
        createdAt: NOW,
      });
      await ctx.db.insert("appointmentProfessionals", {
        appointmentId: pastId,
        professionalId: professional,
      });
    });
  }

  const asPro = t.withIdentity(identityFor("ti156-pro-hist"));
  await asPro.mutation(api.presentation.availability.setBlockActive, {
    blockId,
    isActive: false,
    version: "v1",
  });

  expect(await appointmentStatus(t, futureId)).toBe("scheduled");
  expect(await notificationKindsFor(t, futureId)).toContain("appointment_availability_changed");
});

test("la agenda marca con needsCoordination lo que deja de ser reservable", async () => {
  const t = convexTest(schema, modules);
  const { accompanimentId, futureId, pastId } = await seedAgenda(t);
  const asStudent = t.withIdentity(identityFor("ti156-est"));

  const beforeFuture = await asStudent.query(api.presentation.appointments.getAppointment, {
    appointmentId: futureId,
    version: "v1",
  });
  const beforePast = await asStudent.query(api.presentation.appointments.getAppointment, {
    appointmentId: pastId,
    version: "v1",
  });
  expect(beforeFuture.needsCoordination).toBe(false);
  expect(beforePast.needsCoordination).toBe(false);

  await asStudent.mutation(api.presentation.accompaniments.updateAccompanimentNeeds, {
    accompanimentId,
    accessNeeds: "Sala silenciosa\nIntérprete de lengua de señas",
  });

  const afterFuture = await asStudent.query(api.presentation.appointments.getAppointment, {
    appointmentId: futureId,
    version: "v1",
  });
  const afterPast = await asStudent.query(api.presentation.appointments.getAppointment, {
    appointmentId: pastId,
    version: "v1",
  });
  expect(afterFuture.needsCoordination).toBe(true);
  expect(afterPast.needsCoordination).toBe(false);
});

test("mover el bloque a otra sala avisa aunque el horario siga cubierto", async () => {
  const t = convexTest(schema, modules);
  const { blockId, futureId } = await seedAgenda(t);
  const asPro = t.withIdentity(identityFor("ti156-pro"));
  const otherSpace = await t.run(async (ctx) => {
    return await ctx.db.insert("spaces", {
      campus: "Campus Ficticio",
      building: "Edificio Ficticio",
      floor: "Piso 1",
      room: "Sala Ficticia 2",
      accessConditions: "Sala silenciosa",
      accessInstructions: "Instrucción ficticia",
      isActive: true,
    });
  });

  await asPro.mutation(api.presentation.availability.updateBlock, {
    blockId,
    weekday: 1,
    startMinute: 540,
    endMinute: 720,
    slotMinutes: 30,
    modality: "inPerson",
    spaceId: otherSpace,
    version: "v1",
  });

  expect(await appointmentStatus(t, futureId)).toBe("scheduled");
  expect(await notificationKindsFor(t, futureId)).toContain("appointment_availability_changed");
});

test("un profesional ajeno no distingue un acompañamiento cerrado", async () => {
  const t = convexTest(schema, modules);
  const { accompanimentId } = await seedAgenda(t);
  await t.run(async (ctx) => {
    await ctx.db.patch(accompanimentId, { status: "closed" });
  });
  const otherPro = await seedUser(t, "ti156-otro-pro", "professional");
  void otherPro;
  const asOther = t.withIdentity(identityFor("ti156-otro-pro"));
  await expect(
    asOther.mutation(api.presentation.accompaniments.updateAccompanimentNeeds, {
      accompanimentId,
      accessNeeds: "Otra necesidad",
    }),
  ).rejects.toThrow("No autorizado");
});

test("una atención a más de 92 días también avisa", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, "ti156-est-lejos", "student");
  const professional = await seedUser(t, "ti156-pro-lejos", "professional");
  const spaceId = await seedSpace(t);
  const accompanimentId = await seedAccompaniment(t, student, "Sala silenciosa");
  await seedAssignment(t, accompanimentId, professional);
  await t.run(async (ctx) => {
    await ctx.db.insert("availabilityBlocks", {
      professionalId: professional,
      weekday: 1,
      startMinute: 540,
      endMinute: 720,
      slotMinutes: 30,
      modality: "inPerson",
      spaceId,
      isActive: true,
    });
  });
  const farId = await t.run(async (ctx) => {
    return await ctx.db.insert("appointments", {
      accompanimentId,
      studentId: student,
      professionalId: professional,
      spaceId,
      modality: "inPerson",
      status: "scheduled",
      startsAt: Date.UTC(2027, 3, 5, 13, 0),
      endsAt: Date.UTC(2027, 3, 5, 13, 30),
      createdAt: NOW,
    });
  });
  const blocks = await t.run(async (ctx) =>
    ctx.db
      .query("availabilityBlocks")
      .withIndex("by_professionalId", (q) => q.eq("professionalId", professional))
      .take(5),
  );
  const ownBlock = blocks[0];
  const asPro = t.withIdentity(identityFor("ti156-pro-lejos"));
  await asPro.mutation(api.presentation.availability.setBlockActive, {
    blockId: ownBlock._id,
    isActive: false,
    version: "v1",
  });
  expect(await appointmentStatus(t, farId)).toBe("scheduled");
  expect(await notificationKindsFor(t, farId)).toContain("appointment_availability_changed");
});

test("un día lleno en el centro no bloquea a quien no tiene atenciones ese día", async () => {
  const t = convexTest(schema, modules);
  const { blockId } = await seedAgenda(t);
  const otherPro = await seedUser(t, "ti156-pro-centro", "professional");
  const otherStudent = await seedUser(t, "ti156-est-centro", "student");
  const otherSpace = await seedSpace(t);
  const otherAcc = await seedAccompaniment(t, otherStudent, "");
  await seedAssignment(t, otherAcc, otherPro);
  for (let i = 0; i < 51; i += 1) {
    await t.run(async (ctx) => {
      await ctx.db.insert("appointments", {
        accompanimentId: otherAcc,
        studentId: otherStudent,
        professionalId: otherPro,
        spaceId: otherSpace,
        modality: "inPerson",
        status: "scheduled",
        startsAt: at(9) + i * 60 * 1000,
        endsAt: at(9, 30) + i * 60 * 1000,
        createdAt: NOW,
      });
    });
  }
  const asPro = t.withIdentity(identityFor("ti156-pro"));
  await asPro.mutation(api.presentation.availability.setBlockActive, {
    blockId,
    isActive: false,
    version: "v1",
  });
  const after = await t.run(async (ctx) => await ctx.db.get(blockId as Id<"availabilityBlocks">));
  expect(after?.isActive).toBe(false);
});
