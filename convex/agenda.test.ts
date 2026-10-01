/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import {
  findSpaceByRoom,
  getAttentionById,
  getSpaceById,
  listActiveBlocksByProfessionalAndWeekday,
  listAttentionsByAccompaniment,
  listAttentionsByProfessional,
  listAttentionsByProfessionalFrom,
  listAttentionsBySpace,
  listAttentionsBySpaceFrom,
  listAttentionsByStudent,
  listAttentionsByStudentFrom,
  listBlocksByProfessional,
  listBlocksByProfessionalAndWeekday,
  listBlocksBySpace,
  listExceptionsByDate,
  listExceptionsByProfessionalAndDate,
  listSpacesByActive,
} from "./infrastructure/agenda/repository";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Esquema e índices de agenda (TI2-83): espacios, bloques recurrentes,
 * excepciones y atenciones reservadas.
 *
 * Cada prueba parte de una base vacía (`convexTest` con el esquema real) y
 * siembra solo datos ficticios con `ctx.db`, lo que demuestra que cada
 * índice declarado responde en el orden declarado sin datos previos. Las
 * consultas pasan por `infrastructure/agenda/repository.ts`, así cada
 * índice tiene su consumidor de lectura; las reglas de negocio quedan
 * fuera: la ocupación atómica es TI2-84, el catálogo autorizado es TI2-99
 * y los repositorios de escritura son TI2-95.
 */

const PAGE = { numItems: 10, cursor: null } as const;
/** Lunes 2026-10-12 00:00 UTC en milisegundos de época. */
const MONDAY = Date.UTC(2026, 9, 12);
/** Martes 2026-10-13 00:00 UTC en milisegundos de época. */
const TUESDAY = Date.UTC(2026, 9, 13);
/** Lunes 2026-10-12 09:00 UTC en milisegundos de época. */
const MONDAY_9H = MONDAY + 9 * 3_600_000;
/** Lunes 2026-10-12 10:00 UTC en milisegundos de época. */
const MONDAY_10H = MONDAY + 10 * 3_600_000;

type SeedRole = "student" | "professional";

/** Usuario ficticio con identidad vinculada. */
async function seedUser(
  t: ReturnType<typeof convexTest>,
  input: { subject: string; email: string; role: SeedRole },
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: input.email,
      fullName: "Ficticio",
      role: input.role,
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `https://accounts.google.com|${input.subject}`,
    });
  });
}

/** Sala ficticia del catálogo. */
async function seedSpace(
  t: ReturnType<typeof convexTest>,
  input: { campus: string; building: string; floor: string; room: string; isActive?: boolean },
): Promise<Id<"spaces">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("spaces", {
      campus: input.campus,
      building: input.building,
      floor: input.floor,
      room: input.room,
      accessConditions: "Condición de acceso ficticia",
      accessInstructions: "Instrucción de llegada ficticia",
      isActive: input.isActive ?? true,
    });
  });
}

/** Bloque recurrente ficticio del profesional. */
async function seedBlock(
  t: ReturnType<typeof convexTest>,
  input: {
    professionalId: Id<"users">;
    weekday: number;
    startMinute?: number;
    endMinute?: number;
    modality?: "inPerson" | "online";
    spaceId?: Id<"spaces">;
    isActive?: boolean;
  },
): Promise<Id<"availabilityBlocks">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("availabilityBlocks", {
      professionalId: input.professionalId,
      weekday: input.weekday,
      startMinute: input.startMinute ?? 540,
      endMinute: input.endMinute ?? 600,
      modality: input.modality ?? "inPerson",
      ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
      isActive: input.isActive ?? true,
    });
  });
}

/** Excepción ficticia del profesional en un día. */
async function seedException(
  t: ReturnType<typeof convexTest>,
  input: {
    professionalId: Id<"users">;
    date: number;
    kind?: "cancelled" | "added";
    blockId?: Id<"availabilityBlocks">;
    startMinute?: number;
    endMinute?: number;
  },
): Promise<Id<"availabilityExceptions">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("availabilityExceptions", {
      professionalId: input.professionalId,
      date: input.date,
      kind: input.kind ?? "cancelled",
      ...(input.blockId === undefined ? {} : { blockId: input.blockId }),
      ...(input.startMinute === undefined ? {} : { startMinute: input.startMinute }),
      ...(input.endMinute === undefined ? {} : { endMinute: input.endMinute }),
      reason: "Motivo ficticio",
    });
  });
}

/** Acompañamiento ficticio del estudiante. */
async function seedAccompaniment(
  t: ReturnType<typeof convexTest>,
  studentId: Id<"users">,
): Promise<Id<"accompaniments">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "Necesidad de acceso ficticia",
    });
  });
}

/** Atención reservada ficticia. */
async function seedAttention(
  t: ReturnType<typeof convexTest>,
  input: {
    accompanimentId: Id<"accompaniments">;
    studentId: Id<"users">;
    professionalId: Id<"users">;
    startsAt: number;
    endsAt: number;
    modality?: "inPerson" | "online";
    status?:
      | "scheduled"
      | "completed"
      | "cancelled_by_student"
      | "cancelled_by_cereti"
      | "rescheduled"
      | "no_show";
    spaceId?: Id<"spaces">;
    originalStartsAt?: number;
    cancelReason?: string;
  },
): Promise<Id<"attentions">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("attentions", {
      accompanimentId: input.accompanimentId,
      studentId: input.studentId,
      professionalId: input.professionalId,
      ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
      modality: input.modality ?? "inPerson",
      status: input.status ?? "scheduled",
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      ...(input.originalStartsAt === undefined ? {} : { originalStartsAt: input.originalStartsAt }),
      ...(input.cancelReason === undefined ? {} : { cancelReason: input.cancelReason }),
      createdAt: 1,
    });
  });
}

test("espacios: el catálogo vigente y la sala exacta responden lo sembrado", async () => {
  const t = convexTest(schema, modules);
  const activeId = await seedSpace(t, {
    campus: "Campus Norte",
    building: "Edificio C",
    floor: "2",
    room: "C-204",
  });
  const retiredId = await seedSpace(t, {
    campus: "Campus Norte",
    building: "Edificio C",
    floor: "2",
    room: "C-205",
    isActive: false,
  });

  const active = await t.run(async (ctx) => {
    return await listSpacesByActive(ctx, true, { ...PAGE });
  });
  expect(active.page.map((space) => space._id)).toEqual([activeId]);

  const retired = await t.run(async (ctx) => {
    return await listSpacesByActive(ctx, false, { ...PAGE });
  });
  expect(retired.page.map((space) => space._id)).toEqual([retiredId]);

  const found = await t.run(async (ctx) => {
    return await findSpaceByRoom(ctx, {
      campus: "Campus Norte",
      building: "Edificio C",
      floor: "2",
      room: "C-204",
    });
  });
  expect(found?._id).toEqual(activeId);

  const missing = await t.run(async (ctx) => {
    return await findSpaceByRoom(ctx, {
      campus: "Campus Norte",
      building: "Edificio C",
      floor: "2",
      room: "C-999",
    });
  });
  expect(missing).toBeNull();

  const stored = await t.run(async (ctx) => {
    return await getSpaceById(ctx, activeId);
  });
  expect(stored?.accessInstructions).toBe("Instrucción de llegada ficticia");
});

test("bloques: por profesional, por día de semana y por sala", async () => {
  const t = convexTest(schema, modules);
  const proA = await seedUser(t, {
    subject: "ti83-pro-a",
    email: "proa@uct.cl",
    role: "professional",
  });
  const proB = await seedUser(t, {
    subject: "ti83-pro-b",
    email: "prob@uct.cl",
    role: "professional",
  });
  const room = await seedSpace(t, { campus: "Norte", building: "C", floor: "2", room: "C-204" });
  // Lunes = 1, martes = 2 (0=domingo).
  const mondayBlock = await seedBlock(t, { professionalId: proA, weekday: 1, spaceId: room });
  const tuesdayBlock = await seedBlock(t, { professionalId: proA, weekday: 2, spaceId: room });
  const onlineBlock = await seedBlock(t, { professionalId: proA, weekday: 1, modality: "online" });
  const retiredBlock = await seedBlock(t, {
    professionalId: proA,
    weekday: 1,
    modality: "online",
    isActive: false,
  });
  await seedBlock(t, { professionalId: proB, weekday: 1, modality: "online" });

  const all = await t.run(async (ctx) => {
    return await listBlocksByProfessional(ctx, proA, { ...PAGE });
  });
  expect(all.page.map((block) => block._id).sort()).toEqual(
    [mondayBlock, tuesdayBlock, onlineBlock, retiredBlock].sort(),
  );

  const monday = await t.run(async (ctx) => {
    return await listBlocksByProfessionalAndWeekday(ctx, proA, 1, { ...PAGE });
  });
  expect(monday.page.map((block) => block._id).sort()).toEqual(
    [mondayBlock, onlineBlock, retiredBlock].sort(),
  );

  const mondayActive = await t.run(async (ctx) => {
    return await listActiveBlocksByProfessionalAndWeekday(ctx, proA, 1, { ...PAGE });
  });
  expect(mondayActive.page.map((block) => block._id).sort()).toEqual(
    [mondayBlock, onlineBlock].sort(),
  );

  const tuesday = await t.run(async (ctx) => {
    return await listBlocksByProfessionalAndWeekday(ctx, proA, 2, { ...PAGE });
  });
  expect(tuesday.page.map((block) => block._id)).toEqual([tuesdayBlock]);

  const byRoom = await t.run(async (ctx) => {
    return await listBlocksBySpace(ctx, room, { ...PAGE });
  });
  expect(byRoom.page.map((block) => block._id).sort()).toEqual([mondayBlock, tuesdayBlock].sort());

  const storedOnline = await t.run(async (ctx) => {
    return await ctx.db.get(onlineBlock);
  });
  expect(storedOnline?.spaceId).toBeUndefined();
});

test("excepciones: del profesional en un día y barrido operativo de la fecha", async () => {
  const t = convexTest(schema, modules);
  const proA = await seedUser(t, {
    subject: "ti83-exc-a",
    email: "exca@uct.cl",
    role: "professional",
  });
  const proB = await seedUser(t, {
    subject: "ti83-exc-b",
    email: "excb@uct.cl",
    role: "professional",
  });
  const block = await seedBlock(t, { professionalId: proA, weekday: 1, modality: "online" });
  const cancelled = await seedException(t, { professionalId: proA, date: MONDAY, blockId: block });
  const added = await seedException(t, {
    professionalId: proA,
    date: TUESDAY,
    kind: "added",
    startMinute: 660,
    endMinute: 720,
  });
  const otherPro = await seedException(t, { professionalId: proB, date: MONDAY });

  const mondayMine = await t.run(async (ctx) => {
    return await listExceptionsByProfessionalAndDate(ctx, proA, MONDAY, { ...PAGE });
  });
  expect(mondayMine.page.map((row) => row._id)).toEqual([cancelled]);

  const tuesdayMine = await t.run(async (ctx) => {
    return await listExceptionsByProfessionalAndDate(ctx, proA, TUESDAY, { ...PAGE });
  });
  expect(tuesdayMine.page.map((row) => row._id)).toEqual([added]);

  const mondayAll = await t.run(async (ctx) => {
    return await listExceptionsByDate(ctx, MONDAY, { ...PAGE });
  });
  expect(mondayAll.page.map((row) => row._id).sort()).toEqual([cancelled, otherPro].sort());

  const stored = await t.run(async (ctx) => {
    return await ctx.db.get(added);
  });
  expect(stored?.blockId).toBeUndefined();
  expect(stored?.startMinute).toBe(660);
  expect(stored?.endMinute).toBe(720);

  const storedCancelled = await t.run(async (ctx) => {
    return await ctx.db.get(cancelled);
  });
  expect(storedCancelled?.blockId).toEqual(block);
  expect(storedCancelled?.startMinute).toBeUndefined();
});

test("atenciones: por estudiante, profesional, sala y acompañamiento con ventanas", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti83-est",
    email: "est@alu.uct.cl",
    role: "student",
  });
  const otherStudent = await seedUser(t, {
    subject: "ti83-est-b",
    email: "estb@alu.uct.cl",
    role: "student",
  });
  const pro = await seedUser(t, {
    subject: "ti83-ate-pro",
    email: "atepro@uct.cl",
    role: "professional",
  });
  const room = await seedSpace(t, { campus: "Norte", building: "C", floor: "2", room: "C-204" });
  const accompaniment = await seedAccompaniment(t, student);
  const otherAccompaniment = await seedAccompaniment(t, otherStudent);
  const early = await seedAttention(t, {
    accompanimentId: accompaniment,
    studentId: student,
    professionalId: pro,
    spaceId: room,
    startsAt: MONDAY_9H,
    endsAt: MONDAY_10H,
  });
  const late = await seedAttention(t, {
    accompanimentId: accompaniment,
    studentId: student,
    professionalId: pro,
    spaceId: room,
    startsAt: MONDAY_10H,
    endsAt: MONDAY_10H + 3_600_000,
    status: "rescheduled",
    originalStartsAt: MONDAY_9H,
  });
  const foreign = await seedAttention(t, {
    accompanimentId: otherAccompaniment,
    studentId: otherStudent,
    professionalId: pro,
    modality: "online",
    startsAt: MONDAY_9H,
    endsAt: MONDAY_10H,
  });

  const mine = await t.run(async (ctx) => {
    return await listAttentionsByStudent(ctx, student, { ...PAGE });
  });
  expect(mine.page.map((row) => row._id).sort()).toEqual([early, late].sort());

  // Aislamiento: el otro estudiante solo ve lo propio y cada acompañamiento
  // solo lista sus atenciones.
  const foreignMine = await t.run(async (ctx) => {
    return await listAttentionsByStudent(ctx, otherStudent, { ...PAGE });
  });
  expect(foreignMine.page.map((row) => row._id)).toEqual([foreign]);

  const foreignByAccompaniment = await t.run(async (ctx) => {
    return await listAttentionsByAccompaniment(ctx, otherAccompaniment, { ...PAGE });
  });
  expect(foreignByAccompaniment.page.map((row) => row._id)).toEqual([foreign]);

  const mineFromEpoch = await t.run(async (ctx) => {
    return await listAttentionsByStudentFrom(ctx, student, 0, { ...PAGE });
  });
  expect(mineFromEpoch.page.map((row) => row._id).sort()).toEqual([early, late].sort());

  const mineFromLate = await t.run(async (ctx) => {
    return await listAttentionsByStudentFrom(ctx, student, MONDAY_10H, { ...PAGE });
  });
  expect(mineFromLate.page.map((row) => row._id)).toEqual([late]);

  const agenda = await t.run(async (ctx) => {
    return await listAttentionsByProfessional(ctx, pro, { ...PAGE });
  });
  expect(agenda.page.map((row) => row._id).sort()).toEqual([early, late, foreign].sort());

  const agendaFromLate = await t.run(async (ctx) => {
    return await listAttentionsByProfessionalFrom(ctx, pro, MONDAY_10H, { ...PAGE });
  });
  // La atención ajena empieza a las 09:00 y queda fuera de la ventana.
  expect(agendaFromLate.page.map((row) => row._id)).toEqual([late]);

  const roomUse = await t.run(async (ctx) => {
    return await listAttentionsBySpace(ctx, room, { ...PAGE });
  });
  expect(roomUse.page.map((row) => row._id).sort()).toEqual([early, late].sort());

  const roomUseFromLate = await t.run(async (ctx) => {
    return await listAttentionsBySpaceFrom(ctx, room, MONDAY_10H, { ...PAGE });
  });
  expect(roomUseFromLate.page.map((row) => row._id)).toEqual([late]);

  const byAccompaniment = await t.run(async (ctx) => {
    return await listAttentionsByAccompaniment(ctx, accompaniment, { ...PAGE });
  });
  expect(byAccompaniment.page.map((row) => row._id).sort()).toEqual([early, late].sort());

  const rescheduled = await t.run(async (ctx) => {
    return await getAttentionById(ctx, late);
  });
  expect(rescheduled?.originalStartsAt).toBe(MONDAY_9H);

  const online = await t.run(async (ctx) => {
    return await getAttentionById(ctx, foreign);
  });
  expect(online?.spaceId).toBeUndefined();
});

test("atenciones: los estados terminales y el motivo de cancelación persisten", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti83-est-term",
    email: "estterm@alu.uct.cl",
    role: "student",
  });
  const pro = await seedUser(t, {
    subject: "ti83-pro-term",
    email: "proterm@uct.cl",
    role: "professional",
  });
  const accompaniment = await seedAccompaniment(t, student);
  const base = {
    accompanimentId: accompaniment,
    studentId: student,
    professionalId: pro,
    startsAt: MONDAY_9H,
    endsAt: MONDAY_10H,
  } as const;
  const completed = await seedAttention(t, { ...base, status: "completed" });
  // El estudiante cancela sin motivo obligatorio.
  const studentCancelled = await seedAttention(t, {
    ...base,
    status: "cancelled_by_student",
    startsAt: MONDAY_10H,
    endsAt: MONDAY_10H + 3_600_000,
  });
  // CERETI cancela con motivo.
  const ceretiCancelled = await seedAttention(t, {
    ...base,
    status: "cancelled_by_cereti",
    startsAt: MONDAY_10H + 3_600_000,
    endsAt: MONDAY_10H + 7_200_000,
    cancelReason: "Sala no disponible",
  });
  const noShow = await seedAttention(t, {
    ...base,
    status: "no_show",
    startsAt: MONDAY_10H + 7_200_000,
    endsAt: MONDAY_10H + 10_800_000,
  });

  const storedStudent = await t.run(async (ctx) => {
    return await getAttentionById(ctx, studentCancelled);
  });
  expect(storedStudent?.status).toBe("cancelled_by_student");
  expect(storedStudent?.cancelReason).toBeUndefined();

  const storedCereti = await t.run(async (ctx) => {
    return await getAttentionById(ctx, ceretiCancelled);
  });
  expect(storedCereti?.status).toBe("cancelled_by_cereti");
  expect(storedCereti?.cancelReason).toBe("Sala no disponible");

  const storedNoShow = await t.run(async (ctx) => {
    return await getAttentionById(ctx, noShow);
  });
  expect(storedNoShow?.status).toBe("no_show");

  const storedCompleted = await t.run(async (ctx) => {
    return await getAttentionById(ctx, completed);
  });
  expect(storedCompleted?.status).toBe("completed");
  expect(storedCompleted?.originalStartsAt).toBeUndefined();
});

test("lecturas inexistentes de agenda responden nulo", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti83-est-null",
    email: "estnull@alu.uct.cl",
    role: "student",
  });
  const pro = await seedUser(t, {
    subject: "ti83-pro-null",
    email: "pronull@uct.cl",
    role: "professional",
  });
  const room = await seedSpace(t, { campus: "Norte", building: "C", floor: "2", room: "C-204" });
  const accompaniment = await seedAccompaniment(t, student);
  const attention = await seedAttention(t, {
    accompanimentId: accompaniment,
    studentId: student,
    professionalId: pro,
    spaceId: room,
    startsAt: MONDAY_9H,
    endsAt: MONDAY_10H,
  });
  await t.run(async (ctx) => {
    await ctx.db.delete(room);
    await ctx.db.delete(attention);
  });

  const missingSpace = await t.run(async (ctx) => {
    return await getSpaceById(ctx, room);
  });
  expect(missingSpace).toBeNull();

  const missingAttention = await t.run(async (ctx) => {
    return await getAttentionById(ctx, attention);
  });
  expect(missingAttention).toBeNull();
});

test("ventanas devuelven orden ascendente aunque la siembra llegue desordenada", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti83-est-ord",
    email: "estord@alu.uct.cl",
    role: "student",
  });
  const pro = await seedUser(t, {
    subject: "ti83-pro-ord",
    email: "proord@uct.cl",
    role: "professional",
  });
  const accompaniment = await seedAccompaniment(t, student);
  // Siembra tardía primero: el orden lo impone el índice, no la inserción.
  const late = await seedAttention(t, {
    accompanimentId: accompaniment,
    studentId: student,
    professionalId: pro,
    modality: "online",
    startsAt: MONDAY_10H,
    endsAt: MONDAY_10H + 3_600_000,
  });
  const early = await seedAttention(t, {
    accompanimentId: accompaniment,
    studentId: student,
    professionalId: pro,
    modality: "online",
    startsAt: MONDAY_9H,
    endsAt: MONDAY_10H,
  });

  const windowed = await t.run(async (ctx) => {
    return await listAttentionsByStudentFrom(ctx, student, 0, { ...PAGE });
  });
  expect(windowed.page.map((row) => row._id)).toEqual([early, late]);
});

test("límites: el esquema rechaza literales desconocidos y filas incompletas", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedUser(t, {
    subject: "ti83-lim-pro",
    email: "limpro@uct.cl",
    role: "professional",
  });

  await expect(
    t.run(async (ctx) => {
      await ctx.db.insert("availabilityBlocks", {
        professionalId: pro,
        weekday: 1,
        startMinute: 540,
        endMinute: 600,
        modality: "hybrid" as unknown as "inPerson",
        isActive: true,
      });
    }),
  ).rejects.toThrow("Validator error");

  const student = await seedUser(t, {
    subject: "ti83-lim-est",
    email: "limest@alu.uct.cl",
    role: "student",
  });
  const accompaniment = await seedAccompaniment(t, student);
  await expect(
    t.run(async (ctx) => {
      await ctx.db.insert("attentions", {
        accompanimentId: accompaniment,
        studentId: student,
        professionalId: pro,
        modality: "inPerson",
        status: "scheduled",
        startsAt: MONDAY_9H,
        createdAt: 1,
      } as never);
    }),
  ).rejects.toThrow("Validator error");

  await expect(
    t.run(async (ctx) => {
      await ctx.db.insert("attentions", {
        accompanimentId: accompaniment,
        studentId: student,
        professionalId: pro,
        modality: "inPerson",
        status: "justified" as unknown as "scheduled",
        startsAt: MONDAY_9H,
        endsAt: MONDAY_10H,
        createdAt: 1,
      });
    }),
  ).rejects.toThrow("Validator error");

  await expect(
    t.run(async (ctx) => {
      await ctx.db.insert("availabilityExceptions", {
        professionalId: pro,
        date: MONDAY,
        kind: "moved" as unknown as "cancelled",
      });
    }),
  ).rejects.toThrow("Validator error");
});
