/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { APPOINTMENT_CONTRACT_VERSION } from "../domain/appointments/appointment";
import {
  AGENDA_TIME_ZONE,
  AVAILABILITY_CONTRACT_VERSION,
  expandAvailabilitySlots,
} from "../domain/availability/availability";
import { conflictError, noAvailabilityError } from "../domain/errors/api_error";
import { accompanimentNeedsReader } from "../infrastructure/accompaniments/repository";
import {
  appointmentChangeReader,
  appointmentOccupier,
} from "../infrastructure/appointments/repository";
import {
  accessNeedsFromLines,
  compatibilitySpaceSource,
} from "../infrastructure/spaces/repository";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const ISSUER = "https://accounts.google.com";
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/**
 * Pruebas extensas de la API pública de cambios de atención (TI2-121).
 *
 * Cada prueba usa una base Convex aislada, identidades simuladas y datos
 * ficticios. Se cubren formas de éxito y error, autorización por rol y
 * pertenencia, estados inválidos, disponibilidad, excepciones, ocupación de
 * estudiante, profesional y sala, compatibilidad de modalidad y espacio, y
 * los adaptadores reales de lectura y ocupación.
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
  },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: `${input.subject}@uct.cl`,
      fullName: "Ficticio",
      role: input.role,
      institutionalStatus: input.institutionalStatus ?? "enabled",
      accountStatus: input.accountStatus ?? "active",
      tokenIdentifier: `${ISSUER}|${input.subject}`,
    });
  });
}

async function seedAssignment(
  t: ReturnType<typeof convexTest>,
  accompanimentId: Id<"accompaniments">,
  userId: Id<"users">,
  options: {
    readonly assignedRole?: Doc<"accompanimentAssignments">["assignedRole"];
    readonly status?: Doc<"accompanimentAssignments">["status"];
  } = {},
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("accompanimentAssignments", {
      accompanimentId,
      userId,
      assignedRole: options.assignedRole ?? "professional",
      status: options.status ?? "active",
    });
  });
}

async function seedAgenda(
  t: ReturnType<typeof convexTest>,
  label: string,
  options: {
    readonly accessNeeds?: string;
    readonly accompanimentStatus?: Doc<"accompaniments">["status"];
    readonly studentInstitutionalStatus?: Doc<"users">["institutionalStatus"];
    readonly studentAccountStatus?: Doc<"users">["accountStatus"];
    readonly professionalInstitutionalStatus?: Doc<"users">["institutionalStatus"];
    readonly professionalAccountStatus?: Doc<"users">["accountStatus"];
    readonly assignmentStatus?: Doc<"accompanimentAssignments">["status"];
  } = {},
) {
  const professionalSubject = `ti121-api-pro-${label}`;
  const studentSubject = `ti121-api-est-${label}`;
  const pro = await seedUser(t, {
    subject: professionalSubject,
    role: "professional",
    ...(options.professionalInstitutionalStatus === undefined
      ? {}
      : { institutionalStatus: options.professionalInstitutionalStatus }),
    ...(options.professionalAccountStatus === undefined
      ? {}
      : { accountStatus: options.professionalAccountStatus }),
  });
  const student = await seedUser(t, {
    subject: studentSubject,
    role: "student",
    ...(options.studentInstitutionalStatus === undefined
      ? {}
      : { institutionalStatus: options.studentInstitutionalStatus }),
    ...(options.studentAccountStatus === undefined
      ? {}
      : { accountStatus: options.studentAccountStatus }),
  });
  const accompanimentId = await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId: student,
      status: options.accompanimentStatus ?? "active",
      objective: "Objetivo ficticio",
      accessNeeds: options.accessNeeds ?? "",
    });
  });
  await seedAssignment(
    t,
    accompanimentId,
    pro,
    options.assignmentStatus === undefined ? {} : { status: options.assignmentStatus },
  );
  return {
    pro,
    student,
    accompanimentId,
    proIdentity: identityFor(professionalSubject, `${professionalSubject}@uct.cl`),
    studentIdentity: identityFor(studentSubject, `${studentSubject}@alu.uct.cl`),
  };
}

async function seedSpace(
  t: ReturnType<typeof convexTest>,
  label: string,
  options: { readonly accessConditions?: string; readonly isActive?: boolean } = {},
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("spaces", {
      campus: `Campus ${label}`,
      building: "Edificio ficticio",
      floor: "Piso 1",
      room: `Sala ${label}`,
      accessConditions: options.accessConditions ?? "",
      accessInstructions: "Instrucciones ficticias",
      isActive: options.isActive ?? true,
    });
  });
}

interface BlockSpec {
  readonly weekday?: number;
  readonly startMinute?: number;
  readonly endMinute?: number;
  readonly slotMinutes?: number;
  readonly modality?: Doc<"appointments">["modality"];
  readonly spaceId?: Id<"spaces">;
  readonly isActive?: boolean;
}

interface SeededBlock {
  readonly id: Id<"availabilityBlocks">;
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly slotMinutes: number;
  readonly modality: Doc<"appointments">["modality"];
  readonly spaceId?: Id<"spaces">;
  readonly isActive: boolean;
}

async function seedBlock(
  t: ReturnType<typeof convexTest>,
  professionalId: Id<"users">,
  input: BlockSpec = {},
): Promise<SeededBlock> {
  const block: SeededBlock = {
    id: await t.run(async (ctx) => {
      return await ctx.db.insert("availabilityBlocks", {
        professionalId,
        weekday: input.weekday ?? 1,
        startMinute: input.startMinute ?? 540,
        endMinute: input.endMinute ?? 660,
        slotMinutes: input.slotMinutes ?? 60,
        modality: input.modality ?? "online",
        ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
        isActive: input.isActive ?? true,
      });
    }),
    weekday: input.weekday ?? 1,
    startMinute: input.startMinute ?? 540,
    endMinute: input.endMinute ?? 660,
    slotMinutes: input.slotMinutes ?? 60,
    modality: input.modality ?? "online",
    ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
    isActive: input.isActive ?? true,
  };
  return block;
}

async function seedException(
  t: ReturnType<typeof convexTest>,
  input: {
    readonly professionalId: Id<"users">;
    readonly date: string;
    readonly kind: Doc<"availabilityExceptions">["kind"];
    readonly blockId?: Id<"availabilityBlocks">;
    readonly window?: {
      readonly startMinute: number;
      readonly endMinute: number;
      readonly slotMinutes: number;
      readonly modality: Doc<"appointments">["modality"];
      readonly spaceId?: Id<"spaces">;
    };
  },
) {
  return await t.run(async (ctx) => {
    const [year, month, day] = input.date.split("-").map(Number);
    return await ctx.db.insert("availabilityExceptions", {
      professionalId: input.professionalId,
      date: Date.UTC(year!, month! - 1, day!),
      kind: input.kind,
      ...(input.blockId === undefined ? {} : { blockId: input.blockId }),
      ...(input.window === undefined
        ? {}
        : {
            startMinute: input.window.startMinute,
            endMinute: input.window.endMinute,
            slotMinutes: input.window.slotMinutes,
            modality: input.window.modality,
            ...(input.window.spaceId === undefined ? {} : { spaceId: input.window.spaceId }),
          }),
    });
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
    readonly status?: Doc<"appointments">["status"];
    readonly modality?: Doc<"appointments">["modality"];
    readonly spaceId?: Id<"spaces">;
    readonly originalStartsAt?: number;
    readonly cancelReason?: string;
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
      ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
      ...(input.originalStartsAt === undefined ? {} : { originalStartsAt: input.originalStartsAt }),
      ...(input.cancelReason === undefined ? {} : { cancelReason: input.cancelReason }),
      createdAt: 1,
    });
  });
}

async function getAppointment(t: ReturnType<typeof convexTest>, appointmentId: string) {
  return await t.run(async (ctx) => {
    const id = ctx.db.normalizeId("appointments", appointmentId);
    return id === null ? null : await ctx.db.get(id);
  });
}

async function seedMissingAppointment(
  t: ReturnType<typeof convexTest>,
  input: {
    readonly accompanimentId: Id<"accompaniments">;
    readonly studentId: Id<"users">;
    readonly professionalId: Id<"users">;
  },
) {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("appointments", {
      accompanimentId: input.accompanimentId,
      studentId: input.studentId,
      professionalId: input.professionalId,
      modality: "online",
      status: "scheduled",
      startsAt: 1,
      endsAt: 2,
      createdAt: 1,
    });
    await ctx.db.delete(id);
    return id;
  });
}

/** Fecha civil futura que cae en el día de semana pedido (0=domingo). */
function futureDateForWeekday(weekday: number, weeksAhead = 2): string {
  const base = new Date(Date.now() + weeksAhead * 7 * DAY);
  const delta = (weekday - base.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + delta))
    .toISOString()
    .slice(0, 10);
}

/** Cupos teóricos del bloque en la fecha, expandidos con la misma regla del servidor. */
function slotsOnDate(professionalId: Id<"users">, block: SeededBlock, date: string) {
  return expandAvailabilitySlots({
    professionalId,
    blocks: [
      {
        id: block.id,
        professionalId,
        weekday: block.weekday,
        startMinute: block.startMinute,
        endMinute: block.endMinute,
        slotMinutes: block.slotMinutes,
        modality: block.modality,
        version: AVAILABILITY_CONTRACT_VERSION,
        ...(block.spaceId === undefined ? {} : { spaceId: block.spaceId }),
      },
    ],
    from: date,
    to: date,
    timeZone: AGENDA_TIME_ZONE,
  });
}

/** Datos públicos del error, sin asumir la clase concreta que envuelve Convex. */
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

async function expectPublicError(
  promise: Promise<unknown>,
  code: "unauthorized" | "conflict" | "no_availability",
) {
  const message =
    code === "unauthorized"
      ? "No autorizado"
      : code === "conflict"
        ? conflictError().message
        : noAvailabilityError().message;
  expect(await publicErrorData(promise)).toEqual({ code, message });
}

function expectOnlyAppointmentId(result: unknown, appointmentId: string) {
  expect(result).toEqual({ appointmentId });
  expect(Object.keys(result as Record<string, unknown>)).toEqual(["appointmentId"]);
}

// ── Cancelación ─────────────────────────────────────────────────────────────

test("TI2-121 API: cancelar devuelve solo appointmentId y libera el cupo", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "cancel-shape");
  const block = await seedBlock(t, agenda.pro);
  const date = futureDateForWeekday(1);
  const slots = slotsOnDate(agenda.pro, block, date);
  const origin = slots[0]!;
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: origin.startAt,
    endsAt: origin.endAt,
  });
  const asStudent = t.withIdentity(agenda.studentIdentity);

  const result = await asStudent.mutation(api.presentation.appointments.cancelAppointment, {
    appointmentId,
    version: APPOINTMENT_CONTRACT_VERSION,
  });
  expectOnlyAppointmentId(result, appointmentId);

  const row = await getAppointment(t, appointmentId);
  expect(row).toMatchObject({
    status: "cancelled_by_student",
    startsAt: origin.startAt,
    endsAt: origin.endAt,
  });
  expect(row).not.toHaveProperty("cancelReason");
  expect(row).not.toHaveProperty("originalStartsAt");

  const otherStudent = await seedUser(t, {
    subject: "ti121-api-cancel-reuse",
    role: "student",
  });
  const otherAccompaniment = await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId: otherStudent,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "",
    });
  });
  const reoccupied = await t.run(async (ctx) => {
    return await appointmentOccupier(ctx).occupySlot({
      accompanimentId: otherAccompaniment,
      studentId: otherStudent,
      professionalId: agenda.pro,
      modality: "online",
      startAt: origin.startAt,
      endAt: origin.endAt,
    });
  });
  expect(reoccupied.status).toBe("ok");
});

test("TI2-121 API: el motivo del Estudiante se recorta y uno en blanco no se guarda", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "cancel-reason");
  const block = await seedBlock(t, agenda.pro);
  const date = futureDateForWeekday(1);
  const slots = slotsOnDate(agenda.pro, block, date);
  const asStudent = t.withIdentity(agenda.studentIdentity);

  const withReasonId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: slots[0]!.startAt,
    endsAt: slots[0]!.endAt,
  });
  const blankReasonId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: slots[1]!.startAt,
    endsAt: slots[1]!.endAt,
  });

  expectOnlyAppointmentId(
    await asStudent.mutation(api.presentation.appointments.cancelAppointment, {
      appointmentId: withReasonId,
      reason: "  Motivo ficticio  ",
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    withReasonId,
  );
  expect(await getAppointment(t, withReasonId)).toMatchObject({
    status: "cancelled_by_student",
    cancelReason: "Motivo ficticio",
  });

  expectOnlyAppointmentId(
    await asStudent.mutation(api.presentation.appointments.cancelAppointment, {
      appointmentId: blankReasonId,
      reason: "   ",
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    blankReasonId,
  );
  const blankRow = await getAppointment(t, blankReasonId);
  expect(blankRow).toMatchObject({ status: "cancelled_by_student" });
  expect(blankRow).not.toHaveProperty("cancelReason");
});

test("TI2-121 API: CERETI exige motivo con texto y conserva la fecha original", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "cancel-cereti");
  const startsAt = Date.now() + DAY;
  const originalStartsAt = startsAt - DAY;
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt,
    endsAt: startsAt + HOUR,
    status: "rescheduled",
    originalStartsAt,
  });
  const asPro = t.withIdentity(agenda.proIdentity);
  const before = await getAppointment(t, appointmentId);

  await expectPublicError(
    asPro.mutation(api.presentation.appointments.cancelAppointment, {
      appointmentId,
      reason: "   ",
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    "conflict",
  );
  expect(await getAppointment(t, appointmentId)).toEqual(before);

  expectOnlyAppointmentId(
    await asPro.mutation(api.presentation.appointments.cancelAppointment, {
      appointmentId,
      reason: "  Reagendamiento institucional ficticio  ",
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    appointmentId,
  );
  expect(await getAppointment(t, appointmentId)).toMatchObject({
    status: "cancelled_by_cereti",
    cancelReason: "Reagendamiento institucional ficticio",
    startsAt,
    originalStartsAt,
  });
});

test("TI2-121 API: cancelar con identificadores ajenos, de otra tabla o vacíos no escribe", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "cancel-identifiers");
  const startsAt = Date.now() + DAY;
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt,
    endsAt: startsAt + HOUR,
  });
  const before = await getAppointment(t, appointmentId);
  const asStudent = t.withIdentity(agenda.studentIdentity);
  const missingId = await seedMissingAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
  });

  for (const foreignId of [agenda.accompanimentId, agenda.student, agenda.pro]) {
    await expectPublicError(
      asStudent.mutation(api.presentation.appointments.cancelAppointment, {
        appointmentId: foreignId,
        reason: "Motivo ficticio",
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
      "unauthorized",
    );
  }
  await expectPublicError(
    asStudent.mutation(api.presentation.appointments.cancelAppointment, {
      appointmentId: missingId,
      reason: "Motivo ficticio",
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    "unauthorized",
  );
  await expectPublicError(
    asStudent.mutation(api.presentation.appointments.cancelAppointment, {
      appointmentId: "",
      reason: "Motivo ficticio",
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    "conflict",
  );
  await expectPublicError(
    t.mutation(api.presentation.appointments.cancelAppointment, {
      appointmentId,
      reason: "Motivo ficticio",
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    "unauthorized",
  );

  await seedUser(t, {
    subject: "ti121-api-cancel-foreign",
    role: "student",
  });
  await expectPublicError(
    t
      .withIdentity(identityFor("ti121-api-cancel-foreign", "ti121-api-cancel-foreign@alu.uct.cl"))
      .mutation(api.presentation.appointments.cancelAppointment, {
        appointmentId,
        reason: "Motivo ficticio",
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    "unauthorized",
  );
  expect(await getAppointment(t, appointmentId)).toEqual(before);
});

test("TI2-121 API: cancelar exige perfil vigente, acompañamiento activo y asignación vigente", async () => {
  const t = convexTest(schema, modules);
  const startsAt = Date.now() + DAY;

  const disabledStudentAgenda = await seedAgenda(t, "cancel-disabled-student", {
    studentInstitutionalStatus: "disabled",
    studentAccountStatus: "inactive",
  });
  const disabledStudentAppointment = await seedAppointment(t, {
    accompanimentId: disabledStudentAgenda.accompanimentId,
    studentId: disabledStudentAgenda.student,
    professionalId: disabledStudentAgenda.pro,
    startsAt,
    endsAt: startsAt + HOUR,
  });
  await expectPublicError(
    t
      .withIdentity(disabledStudentAgenda.studentIdentity)
      .mutation(api.presentation.appointments.cancelAppointment, {
        appointmentId: disabledStudentAppointment,
        reason: "Motivo ficticio",
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    "unauthorized",
  );

  const inactiveAccompanimentAgenda = await seedAgenda(t, "cancel-inactive", {
    accompanimentStatus: "paused",
  });
  const inactiveAppointment = await seedAppointment(t, {
    accompanimentId: inactiveAccompanimentAgenda.accompanimentId,
    studentId: inactiveAccompanimentAgenda.student,
    professionalId: inactiveAccompanimentAgenda.pro,
    startsAt,
    endsAt: startsAt + HOUR,
  });
  await expectPublicError(
    t
      .withIdentity(inactiveAccompanimentAgenda.studentIdentity)
      .mutation(api.presentation.appointments.cancelAppointment, {
        appointmentId: inactiveAppointment,
        reason: "Motivo ficticio",
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    "unauthorized",
  );

  const revokedAgenda = await seedAgenda(t, "cancel-revoked", {
    assignmentStatus: "revoked",
  });
  const revokedAppointment = await seedAppointment(t, {
    accompanimentId: revokedAgenda.accompanimentId,
    studentId: revokedAgenda.student,
    professionalId: revokedAgenda.pro,
    startsAt,
    endsAt: startsAt + HOUR,
  });
  await expectPublicError(
    t
      .withIdentity(revokedAgenda.proIdentity)
      .mutation(api.presentation.appointments.cancelAppointment, {
        appointmentId: revokedAppointment,
        reason: "Motivo ficticio",
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    "unauthorized",
  );

  const disabledProAgenda = await seedAgenda(t, "cancel-disabled-pro", {
    professionalInstitutionalStatus: "disabled",
    professionalAccountStatus: "inactive",
  });
  const disabledProAppointment = await seedAppointment(t, {
    accompanimentId: disabledProAgenda.accompanimentId,
    studentId: disabledProAgenda.student,
    professionalId: disabledProAgenda.pro,
    startsAt,
    endsAt: startsAt + HOUR,
  });
  await expectPublicError(
    t
      .withIdentity(disabledProAgenda.proIdentity)
      .mutation(api.presentation.appointments.cancelAppointment, {
        appointmentId: disabledProAppointment,
        reason: "Motivo ficticio",
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    "unauthorized",
  );

  const mismatchAgenda = await seedAgenda(t, "cancel-mismatch");
  const otherPro = await seedUser(t, {
    subject: "ti121-api-cancel-mismatch-pro",
    role: "professional",
  });
  await seedAssignment(t, mismatchAgenda.accompanimentId, otherPro);
  const mismatchAppointment = await seedAppointment(t, {
    accompanimentId: mismatchAgenda.accompanimentId,
    studentId: mismatchAgenda.student,
    professionalId: otherPro,
    startsAt,
    endsAt: startsAt + HOUR,
  });
  await expectPublicError(
    t
      .withIdentity(mismatchAgenda.proIdentity)
      .mutation(api.presentation.appointments.cancelAppointment, {
        appointmentId: mismatchAppointment,
        reason: "Motivo ficticio",
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    "unauthorized",
  );

  for (const appointmentId of [
    disabledStudentAppointment,
    inactiveAppointment,
    revokedAppointment,
    disabledProAppointment,
    mismatchAppointment,
  ]) {
    expect(await getAppointment(t, appointmentId)).toMatchObject({ status: "scheduled", startsAt });
  }
});

test("TI2-121 API: cancelar rechaza todos los estados terminales sin cambiar la fila", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "cancel-states");
  const startsAt = Date.now() + DAY;
  const statuses: ReadonlyArray<Doc<"appointments">["status"]> = [
    "completed",
    "no_show",
    "cancelled_by_student",
    "cancelled_by_cereti",
    "no_show_justified",
    "no_show_unjustified",
  ];
  const asStudent = t.withIdentity(agenda.studentIdentity);

  for (const status of statuses) {
    const appointmentId = await seedAppointment(t, {
      accompanimentId: agenda.accompanimentId,
      studentId: agenda.student,
      professionalId: agenda.pro,
      startsAt,
      endsAt: startsAt + HOUR,
      status,
    });
    const before = await getAppointment(t, appointmentId);
    await expectPublicError(
      asStudent.mutation(api.presentation.appointments.cancelAppointment, {
        appointmentId,
        reason: "Motivo ficticio",
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
      "conflict",
    );
    expect(await getAppointment(t, appointmentId)).toEqual(before);
  }
});

// ── Reagendamiento ──────────────────────────────────────────────────────────

test("TI2-121 API: el Estudiante mueve entre semanas y conserva la primera fecha original", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "move-weeks");
  const block = await seedBlock(t, agenda.pro);
  const weekOne = futureDateForWeekday(1, 2);
  const weekTwo = futureDateForWeekday(1, 3);
  const weekOneSlots = slotsOnDate(agenda.pro, block, weekOne);
  const weekTwoSlots = slotsOnDate(agenda.pro, block, weekTwo);
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: weekOneSlots[0]!.startAt,
    endsAt: weekOneSlots[0]!.endAt,
  });
  const asStudent = t.withIdentity(agenda.studentIdentity);

  expectOnlyAppointmentId(
    await asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      modality: "online",
      startAt: weekTwoSlots[0]!.startAt,
      endAt: weekTwoSlots[0]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    appointmentId,
  );
  expect(await getAppointment(t, appointmentId)).toMatchObject({
    status: "rescheduled",
    startsAt: weekTwoSlots[0]!.startAt,
    endsAt: weekTwoSlots[0]!.endAt,
    originalStartsAt: weekOneSlots[0]!.startAt,
  });

  expectOnlyAppointmentId(
    await asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      modality: "online",
      startAt: weekTwoSlots[1]!.startAt,
      endAt: weekTwoSlots[1]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    appointmentId,
  );
  expect(await getAppointment(t, appointmentId)).toMatchObject({
    status: "rescheduled",
    startsAt: weekTwoSlots[1]!.startAt,
    originalStartsAt: weekOneSlots[0]!.startAt,
  });
  expect(await t.run(async (ctx) => await ctx.db.query("appointments").take(10))).toHaveLength(1);
});

test("TI2-121 API: mover a otro Profesional asignado cambia la pertenencia y conserva la original", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "move-handoff");
  const firstBlock = await seedBlock(t, agenda.pro);
  const secondPro = await seedUser(t, {
    subject: "ti121-api-move-handoff-pro2",
    role: "professional",
  });
  await seedAssignment(t, agenda.accompanimentId, secondPro);
  const secondBlock = await seedBlock(t, secondPro);
  const date = futureDateForWeekday(1);
  const firstSlots = slotsOnDate(agenda.pro, firstBlock, date);
  const secondSlots = slotsOnDate(secondPro, secondBlock, date);
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: firstSlots[0]!.startAt,
    endsAt: firstSlots[0]!.endAt,
  });
  const asStudent = t.withIdentity(agenda.studentIdentity);

  expectOnlyAppointmentId(
    await asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: secondPro,
      modality: "online",
      startAt: secondSlots[1]!.startAt,
      endAt: secondSlots[1]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    appointmentId,
  );
  expect(await getAppointment(t, appointmentId)).toMatchObject({
    professionalId: secondPro,
    status: "rescheduled",
    startsAt: secondSlots[1]!.startAt,
    originalStartsAt: firstSlots[0]!.startAt,
  });

  await expectPublicError(
    t.withIdentity(agenda.proIdentity).mutation(api.presentation.appointments.cancelAppointment, {
      appointmentId,
      reason: "Motivo ficticio",
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    "unauthorized",
  );

  expectOnlyAppointmentId(
    await t
      .withIdentity(
        identityFor("ti121-api-move-handoff-pro2", "ti121-api-move-handoff-pro2@uct.cl"),
      )
      .mutation(api.presentation.appointments.cancelAppointment, {
        appointmentId,
        reason: "Motivo ficticio",
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    appointmentId,
  );
  expect(await getAppointment(t, appointmentId)).toMatchObject({
    status: "cancelled_by_cereti",
    professionalId: secondPro,
    originalStartsAt: firstSlots[0]!.startAt,
  });
});

test("TI2-121 API: mover a un Profesional no reservable responde no_availability", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "move-targets");
  const block = await seedBlock(t, agenda.pro);
  const date = futureDateForWeekday(1);
  const slots = slotsOnDate(agenda.pro, block, date);
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: slots[0]!.startAt,
    endsAt: slots[0]!.endAt,
  });
  const asStudent = t.withIdentity(agenda.studentIdentity);
  const before = await getAppointment(t, appointmentId);

  const cases: Array<{
    readonly label: string;
    readonly professionalId: Id<"users">;
    readonly startAt: number;
    readonly endAt: number;
  }> = [];

  const unassignedPro = await seedUser(t, {
    subject: "ti121-api-move-unassigned",
    role: "professional",
  });
  const unassignedBlock = await seedBlock(t, unassignedPro);
  const unassignedSlots = slotsOnDate(unassignedPro, unassignedBlock, date);
  cases.push({
    label: "sin asignación",
    professionalId: unassignedPro,
    startAt: unassignedSlots[1]!.startAt,
    endAt: unassignedSlots[1]!.endAt,
  });

  const revokedPro = await seedUser(t, {
    subject: "ti121-api-move-revoked",
    role: "professional",
  });
  await seedAssignment(t, agenda.accompanimentId, revokedPro, { status: "revoked" });
  const revokedBlock = await seedBlock(t, revokedPro);
  const revokedSlots = slotsOnDate(revokedPro, revokedBlock, date);
  cases.push({
    label: "asignación revocada",
    professionalId: revokedPro,
    startAt: revokedSlots[1]!.startAt,
    endAt: revokedSlots[1]!.endAt,
  });

  const disabledPro = await seedUser(t, {
    subject: "ti121-api-move-disabled",
    role: "professional",
    institutionalStatus: "disabled",
    accountStatus: "inactive",
  });
  await seedAssignment(t, agenda.accompanimentId, disabledPro);
  const disabledBlock = await seedBlock(t, disabledPro);
  const disabledSlots = slotsOnDate(disabledPro, disabledBlock, date);
  cases.push({
    label: "cuenta deshabilitada",
    professionalId: disabledPro,
    startAt: disabledSlots[1]!.startAt,
    endAt: disabledSlots[1]!.endAt,
  });

  cases.push({
    label: "rol que no es Profesional",
    professionalId: agenda.student,
    startAt: slots[1]!.startAt,
    endAt: slots[1]!.endAt,
  });

  for (const target of cases) {
    await expectPublicError(
      asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
        appointmentId,
        professionalId: target.professionalId,
        modality: "online",
        startAt: target.startAt,
        endAt: target.endAt,
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
      "no_availability",
    );
    expect({ label: target.label, row: await getAppointment(t, appointmentId) }).toEqual({
      label: target.label,
      row: before,
    });
  }
});

test("TI2-121 API: mover respeta bloques vigentes y excepciones de disponibilidad", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "move-exceptions");
  const weekdayBlock = await seedBlock(t, agenda.pro);
  const weekOne = futureDateForWeekday(1, 2);
  const weekTwo = futureDateForWeekday(1, 3);
  const weekThreeWednesday = futureDateForWeekday(3, 3);
  const weekOneSlots = slotsOnDate(agenda.pro, weekdayBlock, weekOne);
  const weekTwoSlots = slotsOnDate(agenda.pro, weekdayBlock, weekTwo);
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: weekOneSlots[0]!.startAt,
    endsAt: weekOneSlots[0]!.endAt,
  });
  const asStudent = t.withIdentity(agenda.studentIdentity);
  const before = await getAppointment(t, appointmentId);

  const inactiveTuesdayBlock = await seedBlock(t, agenda.pro, {
    weekday: 2,
    isActive: false,
  });
  const inactiveTuesdaySlots = slotsOnDate(
    agenda.pro,
    inactiveTuesdayBlock,
    futureDateForWeekday(2),
  );
  await expectPublicError(
    asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      modality: "online",
      startAt: inactiveTuesdaySlots[0]!.startAt,
      endAt: inactiveTuesdaySlots[0]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    "no_availability",
  );
  expect(await getAppointment(t, appointmentId)).toEqual(before);

  await seedException(t, {
    professionalId: agenda.pro,
    date: weekTwo,
    kind: "cancelled",
  });
  await expectPublicError(
    asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      modality: "online",
      startAt: weekTwoSlots[0]!.startAt,
      endAt: weekTwoSlots[0]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    "no_availability",
  );
  expect(await getAppointment(t, appointmentId)).toEqual(before);

  await seedException(t, {
    professionalId: agenda.pro,
    date: weekThreeWednesday,
    kind: "added",
    window: {
      startMinute: 840,
      endMinute: 900,
      slotMinutes: 60,
      modality: "online",
    },
  });
  const addedSlots = expandAvailabilitySlots({
    professionalId: agenda.pro,
    blocks: [],
    exceptions: [
      {
        date: weekThreeWednesday,
        kind: "added",
        version: AVAILABILITY_CONTRACT_VERSION,
        windows: [
          {
            startMinute: 840,
            endMinute: 900,
            slotMinutes: 60,
            modality: "online",
          },
        ],
      },
    ],
    from: weekThreeWednesday,
    to: weekThreeWednesday,
    timeZone: AGENDA_TIME_ZONE,
  });
  expectOnlyAppointmentId(
    await asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      modality: "online",
      startAt: addedSlots[0]!.startAt,
      endAt: addedSlots[0]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    appointmentId,
  );
  expect(await getAppointment(t, appointmentId)).toMatchObject({
    status: "rescheduled",
    startsAt: addedSlots[0]!.startAt,
    originalStartsAt: weekOneSlots[0]!.startAt,
  });
});

test("TI2-121 API: mover exige modalidad y sala coherentes y limpia la sala al pasar a línea", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "move-space");
  const space = await seedSpace(t, "move-space");
  const date = futureDateForWeekday(1);
  const onlineBlock = await seedBlock(t, agenda.pro, {
    startMinute: 540,
    endMinute: 660,
  });
  const inPersonBlock = await seedBlock(t, agenda.pro, {
    startMinute: 660,
    endMinute: 780,
    modality: "inPerson",
    spaceId: space,
  });
  const onlineSlots = slotsOnDate(agenda.pro, onlineBlock, date);
  const inPersonSlots = slotsOnDate(agenda.pro, inPersonBlock, date);
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: onlineSlots[0]!.startAt,
    endsAt: onlineSlots[0]!.endAt,
  });
  const asStudent = t.withIdentity(agenda.studentIdentity);
  const before = await getAppointment(t, appointmentId);

  await expectPublicError(
    asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      modality: "inPerson",
      startAt: inPersonSlots[0]!.startAt,
      endAt: inPersonSlots[0]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    "conflict",
  );
  expect(await getAppointment(t, appointmentId)).toEqual(before);

  expectOnlyAppointmentId(
    await asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      modality: "inPerson",
      spaceId: space,
      startAt: inPersonSlots[0]!.startAt,
      endAt: inPersonSlots[0]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    appointmentId,
  );
  expect(await getAppointment(t, appointmentId)).toMatchObject({
    status: "rescheduled",
    modality: "inPerson",
    spaceId: space,
    startsAt: inPersonSlots[0]!.startAt,
  });

  await expectPublicError(
    asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      modality: "online",
      spaceId: space,
      startAt: onlineSlots[1]!.startAt,
      endAt: onlineSlots[1]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    "conflict",
  );
  expect(await getAppointment(t, appointmentId)).toMatchObject({
    modality: "inPerson",
    spaceId: space,
    startsAt: inPersonSlots[0]!.startAt,
  });

  expectOnlyAppointmentId(
    await asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      modality: "online",
      startAt: onlineSlots[1]!.startAt,
      endAt: onlineSlots[1]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    appointmentId,
  );
  const onlineRow = await getAppointment(t, appointmentId);
  expect(onlineRow).toMatchObject({
    status: "rescheduled",
    modality: "online",
    startsAt: onlineSlots[1]!.startAt,
  });
  expect(onlineRow).not.toHaveProperty("spaceId");
});

test("TI2-121 API: mover no rebaja necesidades de acceso y descarta salas retiradas", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "move-needs", {
    accessNeeds: "Rampa\nBraille",
  });
  const activeSpace = await seedSpace(t, "move-needs-active", {
    accessConditions: "Rampa",
  });
  const inactiveSpace = await seedSpace(t, "move-needs-inactive", {
    accessConditions: "Rampa\nBraille",
    isActive: false,
  });
  const date = futureDateForWeekday(1);
  const onlineBlock = await seedBlock(t, agenda.pro, {
    startMinute: 540,
    endMinute: 660,
  });
  const activeInPersonBlock = await seedBlock(t, agenda.pro, {
    startMinute: 660,
    endMinute: 780,
    modality: "inPerson",
    spaceId: activeSpace,
  });
  const inactiveInPersonBlock = await seedBlock(t, agenda.pro, {
    startMinute: 780,
    endMinute: 900,
    modality: "inPerson",
    spaceId: inactiveSpace,
  });
  const onlineSlots = slotsOnDate(agenda.pro, onlineBlock, date);
  const activeInPersonSlots = slotsOnDate(agenda.pro, activeInPersonBlock, date);
  const inactiveInPersonSlots = slotsOnDate(agenda.pro, inactiveInPersonBlock, date);
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: onlineSlots[0]!.startAt,
    endsAt: onlineSlots[0]!.endAt,
  });
  const asStudent = t.withIdentity(agenda.studentIdentity);
  const before = await getAppointment(t, appointmentId);

  await expectPublicError(
    asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      modality: "inPerson",
      spaceId: inactiveSpace,
      startAt: inactiveInPersonSlots[0]!.startAt,
      endAt: inactiveInPersonSlots[0]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    "no_availability",
  );
  expect(await getAppointment(t, appointmentId)).toEqual(before);

  await expectPublicError(
    asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      modality: "inPerson",
      spaceId: activeSpace,
      startAt: activeInPersonSlots[0]!.startAt,
      endAt: activeInPersonSlots[0]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    "no_availability",
  );
  expect(await getAppointment(t, appointmentId)).toEqual(before);

  await t.run(async (ctx) => {
    await ctx.db.patch(agenda.accompanimentId, { accessNeeds: "Rampa" });
  });
  expectOnlyAppointmentId(
    await asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      modality: "inPerson",
      spaceId: activeSpace,
      startAt: activeInPersonSlots[0]!.startAt,
      endAt: activeInPersonSlots[0]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    appointmentId,
  );
  expect(await getAppointment(t, appointmentId)).toMatchObject({
    modality: "inPerson",
    spaceId: activeSpace,
  });

  await expectPublicError(
    asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      modality: "online",
      startAt: onlineSlots[1]!.startAt,
      endAt: onlineSlots[1]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    "no_availability",
  );
  expect(await getAppointment(t, appointmentId)).toMatchObject({
    modality: "inPerson",
    spaceId: activeSpace,
    startsAt: activeInPersonSlots[0]!.startAt,
  });
});

test("TI2-121 API: mover detecta cruces del estudiante y conserva el origen", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "move-student-busy");
  const block = await seedBlock(t, agenda.pro);
  const date = futureDateForWeekday(1);
  const slots = slotsOnDate(agenda.pro, block, date);
  const originId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: slots[0]!.startAt,
    endsAt: slots[0]!.endAt,
  });
  const otherAccompaniment = await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId: agenda.student,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "",
    });
  });
  const otherPro = await seedUser(t, {
    subject: "ti121-api-move-student-busy-other-pro",
    role: "professional",
  });
  const blockerId = await seedAppointment(t, {
    accompanimentId: otherAccompaniment,
    studentId: agenda.student,
    professionalId: otherPro,
    startsAt: slots[1]!.startAt,
    endsAt: slots[1]!.endAt,
  });
  const before = await getAppointment(t, originId);

  await expectPublicError(
    t
      .withIdentity(agenda.studentIdentity)
      .mutation(api.presentation.appointments.rescheduleAppointment, {
        appointmentId: originId,
        professionalId: agenda.pro,
        modality: "online",
        startAt: slots[1]!.startAt,
        endAt: slots[1]!.endAt,
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    "conflict",
  );
  expect(await getAppointment(t, originId)).toEqual(before);
  expect(await getAppointment(t, blockerId)).toMatchObject({
    startsAt: slots[1]!.startAt,
    status: "scheduled",
  });
});

test("TI2-121 API: mover detecta cruces de sala y acepta un destino liberado por cancelación", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "move-space-busy");
  const space = await seedSpace(t, "move-space-busy");
  const block = await seedBlock(t, agenda.pro, {
    modality: "inPerson",
    spaceId: space,
  });
  const date = futureDateForWeekday(1);
  const slots = slotsOnDate(agenda.pro, block, date);
  const originId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    modality: "inPerson",
    spaceId: space,
    startsAt: slots[0]!.startAt,
    endsAt: slots[0]!.endAt,
  });
  const otherStudent = await seedUser(t, {
    subject: "ti121-api-move-space-busy-other",
    role: "student",
  });
  const otherAccompaniment = await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId: otherStudent,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "",
    });
  });
  const otherPro = await seedUser(t, {
    subject: "ti121-api-move-space-busy-other-pro",
    role: "professional",
  });
  const blockerId = await seedAppointment(t, {
    accompanimentId: otherAccompaniment,
    studentId: otherStudent,
    professionalId: otherPro,
    modality: "inPerson",
    spaceId: space,
    startsAt: slots[1]!.startAt,
    endsAt: slots[1]!.endAt,
  });
  const asStudent = t.withIdentity(agenda.studentIdentity);
  const before = await getAppointment(t, originId);

  await expectPublicError(
    asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId: originId,
      professionalId: agenda.pro,
      modality: "inPerson",
      spaceId: space,
      startAt: slots[1]!.startAt,
      endAt: slots[1]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    "conflict",
  );
  expect(await getAppointment(t, originId)).toEqual(before);

  await t.run(async (ctx) => {
    await ctx.db.patch(blockerId, { status: "cancelled_by_cereti" });
  });
  expectOnlyAppointmentId(
    await asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId: originId,
      professionalId: agenda.pro,
      modality: "inPerson",
      spaceId: space,
      startAt: slots[1]!.startAt,
      endAt: slots[1]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    originId,
  );
  expect(await getAppointment(t, originId)).toMatchObject({
    status: "rescheduled",
    spaceId: space,
    startsAt: slots[1]!.startAt,
    originalStartsAt: slots[0]!.startAt,
  });
});

test("TI2-121 API: mover rechaza entradas inválidas antes de escribir y conserva el orden de autorización", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "move-invalid");
  const block = await seedBlock(t, agenda.pro);
  const date = futureDateForWeekday(1);
  const slots = slotsOnDate(agenda.pro, block, date);
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: slots[0]!.startAt,
    endsAt: slots[0]!.endAt,
  });
  const asStudent = t.withIdentity(agenda.studentIdentity);
  const before = await getAppointment(t, appointmentId);

  const invalidTargets = [
    { label: "mismo inicio", startAt: slots[0]!.startAt, endAt: slots[0]!.endAt + HOUR / 2 },
    { label: "fin antes del inicio", startAt: slots[1]!.startAt, endAt: slots[1]!.startAt },
    { label: "inicio cero", startAt: 0, endAt: HOUR },
    { label: "inicio en el pasado", startAt: Date.now() - 2 * HOUR, endAt: Date.now() - HOUR },
  ];
  for (const target of invalidTargets) {
    await expectPublicError(
      asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
        appointmentId,
        professionalId: agenda.pro,
        modality: "online",
        startAt: target.startAt,
        endAt: target.endAt,
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
      "conflict",
    );
    expect({ label: target.label, row: await getAppointment(t, appointmentId) }).toEqual({
      label: target.label,
      row: before,
    });
  }

  await expectPublicError(
    asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: "   ",
      modality: "online",
      startAt: slots[1]!.startAt,
      endAt: slots[1]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    "conflict",
  );
  await expectPublicError(
    asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId: "",
      professionalId: agenda.pro,
      modality: "online",
      startAt: slots[1]!.startAt,
      endAt: slots[1]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    "conflict",
  );
  await expectPublicError(
    t.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      modality: "online",
      startAt: slots[1]!.startAt,
      endAt: slots[1]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    "unauthorized",
  );

  const foreignTargetStart = slots[1]!.startAt + 10 * HOUR;
  await seedUser(t, {
    subject: "ti121-api-move-invalid-foreign",
    role: "student",
  });
  await expectPublicError(
    t
      .withIdentity(
        identityFor("ti121-api-move-invalid-foreign", "ti121-api-move-invalid-foreign@alu.uct.cl"),
      )
      .mutation(api.presentation.appointments.rescheduleAppointment, {
        appointmentId,
        professionalId: agenda.pro,
        modality: "online",
        startAt: foreignTargetStart,
        endAt: foreignTargetStart + HOUR,
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    "unauthorized",
  );
  expect(await getAppointment(t, appointmentId)).toEqual(before);

  await expect(
    asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      // @ts-expect-error La modalidad híbrida no forma parte del contrato.
      modality: "hybrid",
      startAt: slots[1]!.startAt,
      endAt: slots[1]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
  ).rejects.toThrow(/hybrid/);

  await expect(
    asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      modality: "online",
      startAt: slots[1]!.startAt,
      endAt: slots[1]!.endAt,
      // @ts-expect-error El instante del servidor no viaja en la entrada.
      occurredAt: Date.now(),
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
  ).rejects.toThrow(/occurredAt/);

  await expect(
    asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      modality: "online",
      startAt: slots[1]!.startAt,
      endAt: slots[1]!.endAt,
      // @ts-expect-error El estudiante sale de la fila y la sesión, no del cliente.
      studentId: agenda.student,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
  ).rejects.toThrow(/studentId/);

  await expect(
    asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      modality: "online",
      startAt: slots[1]!.startAt,
      endAt: slots[1]!.endAt,
      // @ts-expect-error La zona horaria la fija el servidor.
      timeZone: "UTC",
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
  ).rejects.toThrow(/timeZone/);
  expect(await getAppointment(t, appointmentId)).toEqual(before);
});

test("TI2-121 API: mover deniega identidades ajenas, roles sin permiso e identificadores de otra tabla", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "move-denied");
  const block = await seedBlock(t, agenda.pro);
  const date = futureDateForWeekday(1);
  const slots = slotsOnDate(agenda.pro, block, date);
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: slots[0]!.startAt,
    endsAt: slots[0]!.endAt,
  });
  const before = await getAppointment(t, appointmentId);
  const missingId = await seedMissingAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
  });

  await seedUser(t, {
    subject: "ti121-api-move-denied-student",
    role: "student",
  });
  await seedUser(t, {
    subject: "ti121-api-move-denied-pro",
    role: "professional",
  });
  await seedUser(t, { subject: "ti121-api-move-denied-intern", role: "intern" });
  await seedUser(t, { subject: "ti121-api-move-denied-admin", role: "admin" });
  const callers = [
    { label: "anónimo", identity: null },
    {
      label: "estudiante ajeno",
      identity: identityFor(
        "ti121-api-move-denied-student",
        "ti121-api-move-denied-student@alu.uct.cl",
      ),
    },
    {
      label: "profesional ajeno",
      identity: identityFor("ti121-api-move-denied-pro", "ti121-api-move-denied-pro@uct.cl"),
    },
    {
      label: "practicante",
      identity: identityFor(
        "ti121-api-move-denied-intern",
        "ti121-api-move-denied-intern@alu.uct.cl",
      ),
    },
    {
      label: "administrador",
      identity: identityFor("ti121-api-move-denied-admin", "ti121-api-move-denied-admin@uct.cl"),
    },
  ];
  const targetStart = slots[1]!.startAt + 10 * HOUR;

  for (const caller of callers) {
    const client = caller.identity === null ? t : t.withIdentity(caller.identity);
    await expectPublicError(
      client.mutation(api.presentation.appointments.rescheduleAppointment, {
        appointmentId,
        professionalId: agenda.pro,
        modality: "online",
        startAt: targetStart,
        endAt: targetStart + HOUR,
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
      "unauthorized",
    );
    expect({ label: caller.label, row: await getAppointment(t, appointmentId) }).toEqual({
      label: caller.label,
      row: before,
    });
  }

  const asStudent = t.withIdentity(agenda.studentIdentity);
  for (const foreignId of [missingId, agenda.accompanimentId, agenda.student, agenda.pro]) {
    await expectPublicError(
      asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
        appointmentId: foreignId,
        professionalId: agenda.pro,
        modality: "online",
        startAt: slots[1]!.startAt,
        endAt: slots[1]!.endAt,
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
      "unauthorized",
    );
  }
  expect(await getAppointment(t, appointmentId)).toEqual(before);
});

test("TI2-121 API: mover exige perfil vigente, acompañamiento activo y asignación vigente", async () => {
  const t = convexTest(schema, modules);
  const startsAt = Date.now() + DAY;

  const disabledStudentAgenda = await seedAgenda(t, "move-disabled-student", {
    studentInstitutionalStatus: "disabled",
    studentAccountStatus: "inactive",
  });
  const disabledStudentAppointment = await seedAppointment(t, {
    accompanimentId: disabledStudentAgenda.accompanimentId,
    studentId: disabledStudentAgenda.student,
    professionalId: disabledStudentAgenda.pro,
    startsAt,
    endsAt: startsAt + HOUR,
  });
  await expectPublicError(
    t
      .withIdentity(disabledStudentAgenda.studentIdentity)
      .mutation(api.presentation.appointments.rescheduleAppointment, {
        appointmentId: disabledStudentAppointment,
        professionalId: disabledStudentAgenda.pro,
        modality: "online",
        startAt: startsAt + DAY,
        endAt: startsAt + DAY + HOUR,
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    "unauthorized",
  );

  const inactiveAccompanimentAgenda = await seedAgenda(t, "move-inactive", {
    accompanimentStatus: "closed",
  });
  const inactiveAppointment = await seedAppointment(t, {
    accompanimentId: inactiveAccompanimentAgenda.accompanimentId,
    studentId: inactiveAccompanimentAgenda.student,
    professionalId: inactiveAccompanimentAgenda.pro,
    startsAt,
    endsAt: startsAt + HOUR,
  });
  await expectPublicError(
    t
      .withIdentity(inactiveAccompanimentAgenda.studentIdentity)
      .mutation(api.presentation.appointments.rescheduleAppointment, {
        appointmentId: inactiveAppointment,
        professionalId: inactiveAccompanimentAgenda.pro,
        modality: "online",
        startAt: startsAt + DAY,
        endAt: startsAt + DAY + HOUR,
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    "unauthorized",
  );

  const revokedAgenda = await seedAgenda(t, "move-revoked", {
    assignmentStatus: "revoked",
  });
  const revokedAppointment = await seedAppointment(t, {
    accompanimentId: revokedAgenda.accompanimentId,
    studentId: revokedAgenda.student,
    professionalId: revokedAgenda.pro,
    startsAt,
    endsAt: startsAt + HOUR,
  });
  await expectPublicError(
    t
      .withIdentity(revokedAgenda.proIdentity)
      .mutation(api.presentation.appointments.rescheduleAppointment, {
        appointmentId: revokedAppointment,
        professionalId: revokedAgenda.pro,
        modality: "online",
        startAt: startsAt + DAY,
        endAt: startsAt + DAY + HOUR,
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    "unauthorized",
  );

  const mismatchAgenda = await seedAgenda(t, "move-mismatch");
  const otherPro = await seedUser(t, {
    subject: "ti121-api-move-mismatch-pro",
    role: "professional",
  });
  await seedAssignment(t, mismatchAgenda.accompanimentId, otherPro);
  const mismatchAppointment = await seedAppointment(t, {
    accompanimentId: mismatchAgenda.accompanimentId,
    studentId: mismatchAgenda.student,
    professionalId: otherPro,
    startsAt,
    endsAt: startsAt + HOUR,
  });
  await expectPublicError(
    t
      .withIdentity(mismatchAgenda.proIdentity)
      .mutation(api.presentation.appointments.rescheduleAppointment, {
        appointmentId: mismatchAppointment,
        professionalId: mismatchAgenda.pro,
        modality: "online",
        startAt: startsAt + DAY,
        endAt: startsAt + DAY + HOUR,
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    "unauthorized",
  );

  for (const appointmentId of [
    disabledStudentAppointment,
    inactiveAppointment,
    revokedAppointment,
    mismatchAppointment,
  ]) {
    expect(await getAppointment(t, appointmentId)).toMatchObject({ status: "scheduled", startsAt });
  }
});

test("TI2-121 API: mover rechaza estados terminales y atenciones canceladas", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "move-states");
  const block = await seedBlock(t, agenda.pro);
  const date = futureDateForWeekday(1);
  const slots = slotsOnDate(agenda.pro, block, date);
  const asStudent = t.withIdentity(agenda.studentIdentity);
  const statuses: ReadonlyArray<Doc<"appointments">["status"]> = [
    "cancelled_by_student",
    "cancelled_by_cereti",
    "completed",
    "no_show",
    "no_show_justified",
    "no_show_unjustified",
  ];

  for (const status of statuses) {
    const appointmentId = await seedAppointment(t, {
      accompanimentId: agenda.accompanimentId,
      studentId: agenda.student,
      professionalId: agenda.pro,
      startsAt: slots[0]!.startAt,
      endsAt: slots[0]!.endAt,
      status,
    });
    const before = await getAppointment(t, appointmentId);
    await expectPublicError(
      asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
        appointmentId,
        professionalId: agenda.pro,
        modality: "online",
        startAt: slots[1]!.startAt,
        endAt: slots[1]!.endAt,
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
      "conflict",
    );
    expect({ status, row: await getAppointment(t, appointmentId) }).toEqual({
      status,
      row: before,
    });
  }
});

test("TI2-121 API: mover libera el origen y ocupa el destino con la misma fila", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "move-frees");
  const block = await seedBlock(t, agenda.pro);
  const date = futureDateForWeekday(1);
  const slots = slotsOnDate(agenda.pro, block, date);
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: slots[0]!.startAt,
    endsAt: slots[0]!.endAt,
  });
  const asStudent = t.withIdentity(agenda.studentIdentity);

  expectOnlyAppointmentId(
    await asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      modality: "online",
      startAt: slots[1]!.startAt,
      endAt: slots[1]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    appointmentId,
  );

  const otherStudent = await seedUser(t, {
    subject: "ti121-api-move-frees-other",
    role: "student",
  });
  const otherAccompaniment = await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId: otherStudent,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "",
    });
  });
  const originFree = await t.run(async (ctx) => {
    return await appointmentOccupier(ctx).occupySlot({
      accompanimentId: otherAccompaniment,
      studentId: otherStudent,
      professionalId: agenda.pro,
      modality: "online",
      startAt: slots[0]!.startAt,
      endAt: slots[0]!.endAt,
    });
  });
  expect(originFree.status).toBe("ok");

  const targetBusy = await t.run(async (ctx) => {
    return await appointmentOccupier(ctx).occupySlot({
      accompanimentId: otherAccompaniment,
      studentId: otherStudent,
      professionalId: agenda.pro,
      modality: "online",
      startAt: slots[1]!.startAt,
      endAt: slots[1]!.endAt,
    });
  });
  expect(targetBusy).toEqual({ status: "error", error: conflictError() });
});

// ── Registro de atención ────────────────────────────────────────────────────

test("TI2-121 API: el Profesional registra realización e inasistencia y conserva la fecha original", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "attendance-success");
  const startsAt = Date.now() - 2 * HOUR;
  const originalStartsAt = startsAt - DAY;
  const asPro = t.withIdentity(agenda.proIdentity);

  const completedId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt,
    endsAt: startsAt + HOUR,
    status: "rescheduled",
    originalStartsAt,
  });
  expectOnlyAppointmentId(
    await asPro.mutation(api.presentation.appointments.recordAppointmentAttendance, {
      appointmentId: completedId,
      outcome: "completed",
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    completedId,
  );
  expect(await getAppointment(t, completedId)).toMatchObject({
    status: "completed",
    startsAt,
    originalStartsAt,
  });

  const noShowId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt,
    endsAt: startsAt + HOUR,
  });
  expectOnlyAppointmentId(
    await asPro.mutation(api.presentation.appointments.recordAppointmentAttendance, {
      appointmentId: noShowId,
      outcome: "no_show",
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    noShowId,
  );
  const noShowRow = await getAppointment(t, noShowId);
  expect(noShowRow).toMatchObject({ status: "no_show", startsAt });
  expect(noShowRow).not.toHaveProperty("originalStartsAt");
});

test("TI2-121 API: el registro rechaza repeticiones, saltos y atenciones futuras", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "attendance-invalid");
  const pastStart = Date.now() - 2 * HOUR;
  const futureStart = Date.now() + DAY;
  const asPro = t.withIdentity(agenda.proIdentity);

  const completedId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: pastStart,
    endsAt: pastStart + HOUR,
    status: "completed",
  });
  const noShowId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: pastStart,
    endsAt: pastStart + HOUR,
    status: "no_show",
  });
  const cancelledId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: pastStart,
    endsAt: pastStart + HOUR,
    status: "cancelled_by_cereti",
  });
  const futureId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: futureStart,
    endsAt: futureStart + HOUR,
  });
  const futureRescheduledId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: futureStart,
    endsAt: futureStart + HOUR,
    status: "rescheduled",
    originalStartsAt: futureStart - DAY,
  });

  const cases = [
    { label: "realizada a inasistencia", appointmentId: completedId, outcome: "no_show" as const },
    { label: "inasistencia a realizada", appointmentId: noShowId, outcome: "completed" as const },
    { label: "inasistencia repetida", appointmentId: noShowId, outcome: "no_show" as const },
    { label: "cancelada", appointmentId: cancelledId, outcome: "completed" as const },
    { label: "futura", appointmentId: futureId, outcome: "completed" as const },
    {
      label: "reagendada futura",
      appointmentId: futureRescheduledId,
      outcome: "completed" as const,
    },
  ];
  for (const item of cases) {
    const before = await getAppointment(t, item.appointmentId);
    await expectPublicError(
      asPro.mutation(api.presentation.appointments.recordAppointmentAttendance, {
        appointmentId: item.appointmentId,
        outcome: item.outcome,
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
      "conflict",
    );
    expect({ label: item.label, row: await getAppointment(t, item.appointmentId) }).toEqual({
      label: item.label,
      row: before,
    });
  }
});

test("TI2-121 API: el registro deniega al Estudiante dueño, ajenos, roles y cuentas sin vigencia", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "attendance-denied");
  const pastStart = Date.now() - 2 * HOUR;
  const futureStart = Date.now() + DAY;
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: pastStart,
    endsAt: pastStart + HOUR,
  });
  const futureAppointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: futureStart,
    endsAt: futureStart + HOUR,
  });
  const before = await getAppointment(t, appointmentId);
  await seedUser(t, {
    subject: "ti121-api-attendance-foreign-pro",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti121-api-attendance-intern",
    role: "intern",
  });
  await seedUser(t, { subject: "ti121-api-attendance-admin", role: "admin" });
  const missingId = await seedMissingAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
  });

  const callers = [
    { label: "anónimo", identity: null },
    { label: "estudiante dueño", identity: agenda.studentIdentity },
    {
      label: "profesional ajeno",
      identity: identityFor(
        "ti121-api-attendance-foreign-pro",
        "ti121-api-attendance-foreign-pro@uct.cl",
      ),
    },
    {
      label: "practicante",
      identity: identityFor(
        "ti121-api-attendance-intern",
        "ti121-api-attendance-intern@alu.uct.cl",
      ),
    },
    {
      label: "administrador",
      identity: identityFor("ti121-api-attendance-admin", "ti121-api-attendance-admin@uct.cl"),
    },
  ];
  for (const caller of callers) {
    const client = caller.identity === null ? t : t.withIdentity(caller.identity);
    await expectPublicError(
      client.mutation(api.presentation.appointments.recordAppointmentAttendance, {
        appointmentId: futureAppointmentId,
        outcome: "completed",
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
      "unauthorized",
    );
    expect({ label: caller.label, row: await getAppointment(t, appointmentId) }).toEqual({
      label: caller.label,
      row: before,
    });
  }

  const asPro = t.withIdentity(agenda.proIdentity);
  for (const foreignId of [missingId, agenda.accompanimentId, agenda.student, agenda.pro]) {
    await expectPublicError(
      asPro.mutation(api.presentation.appointments.recordAppointmentAttendance, {
        appointmentId: foreignId,
        outcome: "completed",
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
      "unauthorized",
    );
  }
  expect(await getAppointment(t, appointmentId)).toEqual(before);

  const disabledProAgenda = await seedAgenda(t, "attendance-disabled-pro", {
    professionalInstitutionalStatus: "disabled",
    professionalAccountStatus: "inactive",
  });
  const disabledProAppointment = await seedAppointment(t, {
    accompanimentId: disabledProAgenda.accompanimentId,
    studentId: disabledProAgenda.student,
    professionalId: disabledProAgenda.pro,
    startsAt: pastStart,
    endsAt: pastStart + HOUR,
  });
  await expectPublicError(
    t
      .withIdentity(disabledProAgenda.proIdentity)
      .mutation(api.presentation.appointments.recordAppointmentAttendance, {
        appointmentId: disabledProAppointment,
        outcome: "completed",
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    "unauthorized",
  );

  const inactiveAccompanimentAgenda = await seedAgenda(t, "attendance-inactive", {
    accompanimentStatus: "paused",
  });
  const inactiveAppointment = await seedAppointment(t, {
    accompanimentId: inactiveAccompanimentAgenda.accompanimentId,
    studentId: inactiveAccompanimentAgenda.student,
    professionalId: inactiveAccompanimentAgenda.pro,
    startsAt: pastStart,
    endsAt: pastStart + HOUR,
  });
  await expectPublicError(
    t
      .withIdentity(inactiveAccompanimentAgenda.proIdentity)
      .mutation(api.presentation.appointments.recordAppointmentAttendance, {
        appointmentId: inactiveAppointment,
        outcome: "completed",
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    "unauthorized",
  );

  const revokedAgenda = await seedAgenda(t, "attendance-revoked", {
    assignmentStatus: "revoked",
  });
  const revokedAppointment = await seedAppointment(t, {
    accompanimentId: revokedAgenda.accompanimentId,
    studentId: revokedAgenda.student,
    professionalId: revokedAgenda.pro,
    startsAt: pastStart,
    endsAt: pastStart + HOUR,
  });
  await expectPublicError(
    t
      .withIdentity(revokedAgenda.proIdentity)
      .mutation(api.presentation.appointments.recordAppointmentAttendance, {
        appointmentId: revokedAppointment,
        outcome: "completed",
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    "unauthorized",
  );

  const mismatchAgenda = await seedAgenda(t, "attendance-mismatch");
  const otherPro = await seedUser(t, {
    subject: "ti121-api-attendance-mismatch-pro",
    role: "professional",
  });
  await seedAssignment(t, mismatchAgenda.accompanimentId, otherPro);
  const mismatchAppointment = await seedAppointment(t, {
    accompanimentId: mismatchAgenda.accompanimentId,
    studentId: mismatchAgenda.student,
    professionalId: otherPro,
    startsAt: pastStart,
    endsAt: pastStart + HOUR,
  });
  await expectPublicError(
    t
      .withIdentity(mismatchAgenda.proIdentity)
      .mutation(api.presentation.appointments.recordAppointmentAttendance, {
        appointmentId: mismatchAppointment,
        outcome: "completed",
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    "unauthorized",
  );
});

test("TI2-121 API: el registro rechaza resultados fuera del contrato público", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "attendance-outcomes");
  const startsAt = Date.now() - 2 * HOUR;
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt,
    endsAt: startsAt + HOUR,
  });
  const asPro = t.withIdentity(agenda.proIdentity);

  for (const outcome of ["no_show_justified", "no_show_unjustified"]) {
    await expect(
      asPro.mutation(api.presentation.appointments.recordAppointmentAttendance, {
        appointmentId,
        // @ts-expect-error La justificación de inasistencia es TI2-119.
        outcome,
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    ).rejects.toThrow(new RegExp(outcome));
  }
  expect(await getAppointment(t, appointmentId)).toMatchObject({ status: "scheduled" });
});

test("TI2-121 API: cancelar y registrar después de reagendar conservan la fecha original", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "chain");
  const block = await seedBlock(t, agenda.pro);
  const date = futureDateForWeekday(1);
  const slots = slotsOnDate(agenda.pro, block, date);
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: slots[0]!.startAt,
    endsAt: slots[0]!.endAt,
  });
  const asStudent = t.withIdentity(agenda.studentIdentity);

  expectOnlyAppointmentId(
    await asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      modality: "online",
      startAt: slots[1]!.startAt,
      endAt: slots[1]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    appointmentId,
  );

  await expectPublicError(
    t
      .withIdentity(agenda.proIdentity)
      .mutation(api.presentation.appointments.recordAppointmentAttendance, {
        appointmentId,
        outcome: "completed",
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    "conflict",
  );
  expect(await getAppointment(t, appointmentId)).toMatchObject({
    status: "rescheduled",
    startsAt: slots[1]!.startAt,
    originalStartsAt: slots[0]!.startAt,
  });

  expectOnlyAppointmentId(
    await asStudent.mutation(api.presentation.appointments.cancelAppointment, {
      appointmentId,
      reason: "Motivo ficticio",
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    appointmentId,
  );
  expect(await getAppointment(t, appointmentId)).toMatchObject({
    status: "cancelled_by_student",
    cancelReason: "Motivo ficticio",
    startsAt: slots[1]!.startAt,
    originalStartsAt: slots[0]!.startAt,
  });

  await expectPublicError(
    asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      modality: "online",
      startAt: slots[0]!.startAt,
      endAt: slots[0]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
    "conflict",
  );
  await expectPublicError(
    t
      .withIdentity(agenda.proIdentity)
      .mutation(api.presentation.appointments.recordAppointmentAttendance, {
        appointmentId,
        outcome: "no_show",
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    "conflict",
  );
});

// ── Adaptadores de Infraestructura ──────────────────────────────────────────

test("TI2-121 API: el lector de cambios mapea la fila y trata otros identificadores como inexistentes", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "reader");
  const startsAt = Date.now() + DAY;
  const originalStartsAt = startsAt - DAY;
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt,
    endsAt: startsAt + HOUR,
    status: "rescheduled",
    originalStartsAt,
  });
  const missingId = await seedMissingAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
  });

  const read = await t.run(async (ctx) => {
    return await appointmentChangeReader(ctx).getAppointment(appointmentId);
  });
  expect(read).toEqual({
    id: appointmentId,
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    status: "rescheduled",
    startAt: startsAt,
    endAt: startsAt + HOUR,
    originalStartAt: originalStartsAt,
  });

  for (const foreignId of [missingId, agenda.accompanimentId, agenda.student, "no-es-un-id"]) {
    expect(
      await t.run(async (ctx) => {
        return await appointmentChangeReader(ctx).getAppointment(foreignId);
      }),
    ).toBeNull();
  }
});

test("TI2-121 API: el ocupador mueve la misma fila y rechaza identificadores de otra tabla", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "occupier");
  const block = await seedBlock(t, agenda.pro);
  const date = futureDateForWeekday(1);
  const slots = slotsOnDate(agenda.pro, block, date);
  const appointmentId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: slots[0]!.startAt,
    endsAt: slots[0]!.endAt,
  });

  const moved = await t.run(async (ctx) => {
    return await appointmentOccupier(ctx).occupySlot({
      accompanimentId: agenda.accompanimentId,
      studentId: agenda.student,
      professionalId: agenda.pro,
      modality: "online",
      startAt: slots[1]!.startAt,
      endAt: slots[1]!.endAt,
      movedAppointmentId: appointmentId,
    });
  });
  expect(moved).toEqual({ status: "ok", data: { appointmentId } });
  expect(await getAppointment(t, appointmentId)).toMatchObject({
    startsAt: slots[1]!.startAt,
    endsAt: slots[1]!.endAt,
  });

  const before = await getAppointment(t, appointmentId);
  const invalidInputs = [
    {
      label: "acompañamiento de otra tabla",
      input: {
        accompanimentId: agenda.student,
        studentId: agenda.student,
        professionalId: agenda.pro,
      },
    },
    {
      label: "estudiante de otra tabla",
      input: {
        accompanimentId: agenda.accompanimentId,
        studentId: agenda.accompanimentId,
        professionalId: agenda.pro,
      },
    },
    {
      label: "profesional de otra tabla",
      input: {
        accompanimentId: agenda.accompanimentId,
        studentId: agenda.student,
        professionalId: agenda.accompanimentId,
      },
    },
    {
      label: "sala de otra tabla",
      input: {
        accompanimentId: agenda.accompanimentId,
        studentId: agenda.student,
        professionalId: agenda.pro,
        spaceId: agenda.accompanimentId,
      },
    },
  ];
  for (const item of invalidInputs) {
    const result = await t.run(async (ctx) => {
      return await appointmentOccupier(ctx).occupySlot({
        ...item.input,
        modality: "online",
        startAt: slots[0]!.startAt,
        endAt: slots[0]!.endAt,
        movedAppointmentId: appointmentId,
      });
    });
    expect({ label: item.label, result }).toEqual({
      label: item.label,
      result: { status: "error", error: conflictError() },
    });
    expect({ label: item.label, row: await getAppointment(t, appointmentId) }).toEqual({
      label: item.label,
      row: before,
    });
  }
});

test("TI2-121 API: el ocupador rechaza una atención movida cancelada, ajena o inexistente", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "occupier-invalid");
  const block = await seedBlock(t, agenda.pro);
  const date = futureDateForWeekday(1);
  const slots = slotsOnDate(agenda.pro, block, date);

  const canceledId = await seedAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: slots[0]!.startAt,
    endsAt: slots[0]!.endAt,
    status: "cancelled_by_student",
  });
  const otherStudent = await seedUser(t, {
    subject: "ti121-api-occupier-other",
    role: "student",
  });
  const otherAccompaniment = await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId: otherStudent,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "",
    });
  });
  const foreignId = await seedAppointment(t, {
    accompanimentId: otherAccompaniment,
    studentId: otherStudent,
    professionalId: agenda.pro,
    startsAt: slots[0]!.startAt,
    endsAt: slots[0]!.endAt,
  });
  const missingId = await seedMissingAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
  });

  for (const movedAppointmentId of [canceledId, foreignId, missingId]) {
    const result = await t.run(async (ctx) => {
      return await appointmentOccupier(ctx).occupySlot({
        accompanimentId: agenda.accompanimentId,
        studentId: agenda.student,
        professionalId: agenda.pro,
        modality: "online",
        startAt: slots[1]!.startAt,
        endAt: slots[1]!.endAt,
        movedAppointmentId,
      });
    });
    expect(result).toEqual({ status: "error", error: conflictError() });
  }
  expect((await getAppointment(t, canceledId))?.status).toBe("cancelled_by_student");
  expect((await getAppointment(t, foreignId))?.startsAt).toBe(slots[0]!.startAt);
  expect(await getAppointment(t, missingId)).toBeNull();
});

test("TI2-121 API: necesidades y compatibilidad normalizan líneas y descartan salas retiradas", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedAgenda(t, "adapters-needs", {
    accessNeeds: " Rampa \n\nBraille\nRampa\n  Lector de pantalla  \n",
  });
  const activeSpace = await seedSpace(t, "adapters-active", {
    accessConditions: "Rampa\n\nBraille\nRampa\nLector de pantalla",
  });
  const inactiveSpace = await seedSpace(t, "adapters-inactive", {
    accessConditions: "Rampa",
    isActive: false,
  });

  expect(accessNeedsFromLines(" Rampa \n\nBraille\nRampa\n")).toEqual([
    { id: "Rampa", label: "Rampa" },
    { id: "Braille", label: "Braille" },
  ]);
  expect(accessNeedsFromLines("")).toEqual([]);
  expect(accessNeedsFromLines("  \n\t\n")).toEqual([]);

  const needs = await t.run(async (ctx) => {
    return await accompanimentNeedsReader(ctx).findAccompanimentNeeds(agenda.accompanimentId);
  });
  expect(needs).toEqual({
    _id: agenda.accompanimentId,
    needs: [
      { id: "Rampa", label: "Rampa" },
      { id: "Braille", label: "Braille" },
      { id: "Lector de pantalla", label: "Lector de pantalla" },
    ],
  });

  for (const foreignId of [agenda.student, "no-es-un-id"]) {
    expect(
      await t.run(async (ctx) => {
        return await accompanimentNeedsReader(ctx).findAccompanimentNeeds(foreignId);
      }),
    ).toBeNull();
  }

  const active = await t.run(async (ctx) => {
    return await compatibilitySpaceSource(ctx).findCompatibilitySpace(activeSpace);
  });
  expect(active).toMatchObject({
    isActive: true,
    space: { id: activeSpace, room: "Sala adapters-active" },
    satisfiedNeeds: [
      { id: "Rampa", label: "Rampa" },
      { id: "Braille", label: "Braille" },
      { id: "Lector de pantalla", label: "Lector de pantalla" },
    ],
  });

  expect(
    await t.run(async (ctx) => {
      return await compatibilitySpaceSource(ctx).findCompatibilitySpace(inactiveSpace);
    }),
  ).toBeNull();

  for (const foreignId of [agenda.student, agenda.accompanimentId, "no-es-un-id"]) {
    expect(
      await t.run(async (ctx) => {
        return await compatibilitySpaceSource(ctx).findCompatibilitySpace(foreignId);
      }),
    ).toBeNull();
  }

  expect(
    await t.run(async (ctx) => {
      return await compatibilitySpaceSource(ctx).listOnlineSupports();
    }),
  ).toEqual([]);
});
