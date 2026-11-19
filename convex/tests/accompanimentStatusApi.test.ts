/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  ACCOMPANIMENT_CLOSURE_CANCEL_REASON,
  ACCOMPANIMENT_CLOSURE_REASON_MAX_LENGTH,
} from "../domain/accompaniments/accompaniment";
import { APPOINTMENT_CONTRACT_VERSION } from "../domain/appointments/appointment";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const ISSUER = "https://accounts.google.com";
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const MEET_LINK = "https://meet.google.com/sol-casa-pan";
const OTHER_MEET_LINK = "https://meet.google.com/mar-roca-sal";

/**
 * Pruebas de la API pública del estado del acompañamiento (TI2-152): pausar,
 * reactivar, cerrar, vista previa del cierre y cambio de profesionales.
 *
 * Cada prueba usa una base Convex aislada, identidades simuladas y datos
 * ficticios. Las atenciones se siembran respecto del reloj real porque las
 * funciones públicas no reciben el instante del cliente.
 */

type TestConvex = ReturnType<typeof convexTest>;

function identityFor(subject: string) {
  return {
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    email: `${subject}@uct.cl`,
    name: "Ficticio",
  };
}

async function seedUser(t: TestConvex, subject: string, role: Doc<"users">["role"]) {
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

async function seedAssignment(
  t: TestConvex,
  accompanimentId: Id<"accompaniments">,
  userId: Id<"users">,
  assignedRole: Doc<"accompanimentAssignments">["assignedRole"] = "professional",
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("accompanimentAssignments", {
      accompanimentId,
      userId,
      assignedRole,
      status: "active",
    });
  });
}

/** Acompañamiento con Estudiante dueño y dos profesionales asignados. */
async function seedAccompaniment(
  t: TestConvex,
  label: string,
  status: Doc<"accompaniments">["status"] = "active",
) {
  const subjects = {
    pro: `ti152-pro-${label}`,
    otherPro: `ti152-otro-${label}`,
    student: `ti152-est-${label}`,
  };
  const pro = await seedUser(t, subjects.pro, "professional");
  const otherPro = await seedUser(t, subjects.otherPro, "professional");
  const student = await seedUser(t, subjects.student, "student");
  const accompanimentId = await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId: student,
      status,
      objective: "Objetivo ficticio",
      accessNeeds: "",
    });
  });
  await seedAssignment(t, accompanimentId, pro);
  await seedAssignment(t, accompanimentId, otherPro);
  return {
    pro,
    otherPro,
    student,
    accompanimentId,
    proIdentity: identityFor(subjects.pro),
    otherProIdentity: identityFor(subjects.otherPro),
    studentIdentity: identityFor(subjects.student),
  };
}

async function seedAppointment(
  t: TestConvex,
  input: {
    readonly accompanimentId: Id<"accompaniments">;
    readonly studentId: Id<"users">;
    readonly professionalId: Id<"users">;
    readonly startsAt: number;
    readonly status?: Doc<"appointments">["status"];
  },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("appointments", {
      accompanimentId: input.accompanimentId,
      studentId: input.studentId,
      professionalId: input.professionalId,
      modality: "online",
      status: input.status ?? "scheduled",
      startsAt: input.startsAt,
      endsAt: input.startsAt + HOUR,
      createdAt: 1,
    });
  });
}

/** Estado y datos del cierre tal como quedan en la fila del acompañamiento. */
async function readState(t: TestConvex, accompanimentId: Id<"accompaniments">) {
  const row = await t.run(async (ctx) => await ctx.db.get(accompanimentId));
  return {
    status: row?.status,
    closedById: row?.closedById,
    closedAt: row?.closedAt,
    closureReason: row?.closureReason,
  };
}

async function expectPublicError(promise: Promise<unknown>, code: "unauthorized" | "conflict") {
  const data = await promise.then(
    () => {
      throw new Error("Se esperaba un error público");
    },
    (error: unknown) => {
      if (error instanceof ConvexError) return error.data as unknown;
      throw error;
    },
  );
  expect(data).toMatchObject(
    code === "unauthorized" ? { code, message: "No autorizado" } : { code },
  );
}

test("TI2-152 API: pausar y reactivar solo cambian el estado y no reciben motivo", async () => {
  const t = convexTest(schema, modules);
  const seed = await seedAccompaniment(t, "pausa");
  const pro = t.withIdentity(seed.proIdentity);
  const { pauseAccompaniment, reactivateAccompaniment } = api.presentation.accompaniments;
  const args = { accompanimentId: seed.accompanimentId };

  expect(await pro.mutation(pauseAccompaniment, args)).toEqual({ ...args, status: "paused" });
  expect(await readState(t, seed.accompanimentId)).toEqual({ status: "paused" });
  expect(await pro.mutation(reactivateAccompaniment, args)).toEqual({ ...args, status: "active" });
  expect(await readState(t, seed.accompanimentId)).toEqual({ status: "active" });

  // El motivo no es un argumento de estas operaciones: Convex lo rechaza.
  const withReason = { ...args, reason: "Receso ficticio" };
  await expect(pro.mutation(pauseAccompaniment, withReason)).rejects.toThrow(/reason/);
  expect(await readState(t, seed.accompanimentId)).toEqual({ status: "active" });
});

test("TI2-152 API: las transiciones inválidas y el motivo sobre el tope responden conflict sin escribir", async () => {
  const t = convexTest(schema, modules);
  const active = await seedAccompaniment(t, "invalida-activa");
  const closed = await seedAccompaniment(t, "invalida-cerrada", "closed");
  const { pauseAccompaniment, reactivateAccompaniment, closeAccompaniment } =
    api.presentation.accompaniments;

  const onActive = t.withIdentity(active.proIdentity);
  await expectPublicError(
    onActive.mutation(reactivateAccompaniment, { accompanimentId: active.accompanimentId }),
    "conflict",
  );
  await expectPublicError(
    onActive.mutation(closeAccompaniment, {
      accompanimentId: active.accompanimentId,
      reason: "a".repeat(ACCOMPANIMENT_CLOSURE_REASON_MAX_LENGTH + 1),
    }),
    "conflict",
  );
  await onActive.mutation(pauseAccompaniment, { accompanimentId: active.accompanimentId });
  await expectPublicError(
    onActive.mutation(pauseAccompaniment, { accompanimentId: active.accompanimentId }),
    "conflict",
  );
  expect(await readState(t, active.accompanimentId)).toEqual({ status: "paused" });

  // Un acompañamiento cerrado no se reabre, no se pausa ni se vuelve a cerrar.
  const onClosed = t.withIdentity(closed.proIdentity);
  for (const change of [pauseAccompaniment, reactivateAccompaniment, closeAccompaniment]) {
    await expectPublicError(
      onClosed.mutation(change, { accompanimentId: closed.accompanimentId }),
      "conflict",
    );
  }
  await expectPublicError(
    onClosed.query(api.presentation.accompaniments.getAccompanimentClosurePreview, {
      accompanimentId: closed.accompanimentId,
    }),
    "conflict",
  );
  expect(await readState(t, closed.accompanimentId)).toEqual({ status: "closed" });
});

test("TI2-152 API: solo el Profesional vigente y asignado cambia el estado", async () => {
  const t = convexTest(schema, modules);
  const seed = await seedAccompaniment(t, "permiso");
  const { pauseAccompaniment, closeAccompaniment, getAccompanimentClosurePreview } =
    api.presentation.accompaniments;

  const intern = await seedUser(t, "ti152-practicante", "intern");
  await seedAssignment(t, seed.accompanimentId, intern, "intern");
  await seedUser(t, "ti152-admin", "admin");
  await seedUser(t, "ti152-ajeno", "professional");
  const args = { accompanimentId: seed.accompanimentId };

  const callers = [
    t,
    t.withIdentity(seed.studentIdentity),
    t.withIdentity(identityFor("ti152-practicante")),
    t.withIdentity(identityFor("ti152-admin")),
    t.withIdentity(identityFor("ti152-ajeno")),
    t.withIdentity(identityFor("ti152-sin-perfil")),
  ];
  for (const caller of callers) {
    await expectPublicError(caller.mutation(pauseAccompaniment, args), "unauthorized");
    await expectPublicError(caller.mutation(closeAccompaniment, args), "unauthorized");
    await expectPublicError(caller.query(getAccompanimentClosurePreview, args), "unauthorized");
  }

  // Un acompañamiento inexistente responde igual que uno ajeno.
  const removed = await t.run(async (ctx) => {
    const id = await ctx.db.insert("accompaniments", {
      studentId: seed.student,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "",
    });
    await ctx.db.delete(id);
    return id;
  });
  await expectPublicError(
    t.withIdentity(seed.proIdentity).mutation(pauseAccompaniment, { accompanimentId: removed }),
    "unauthorized",
  );
  expect(await readState(t, seed.accompanimentId)).toEqual({ status: "active" });
});

test("TI2-152 API: en pausa las atenciones se mantienen, pero no se cancelan ni se registra su resultado", async () => {
  const t = convexTest(schema, modules);
  const seed = await seedAccompaniment(t, "pausa-agenda");
  const base = {
    accompanimentId: seed.accompanimentId,
    studentId: seed.student,
    professionalId: seed.pro,
  };
  const future = await seedAppointment(t, { ...base, startsAt: Date.now() + DAY });
  const past = await seedAppointment(t, { ...base, startsAt: Date.now() - DAY });
  const student = t.withIdentity(seed.studentIdentity);
  const pro = t.withIdentity(seed.proIdentity);
  const { cancelAppointment, recordAppointmentAttendance } = api.presentation.appointments;
  const cancelArgs = {
    appointmentId: future,
    reason: "Motivo ficticio",
    version: APPOINTMENT_CONTRACT_VERSION,
  };
  const recordArgs = {
    appointmentId: past,
    outcome: "completed" as const,
    version: APPOINTMENT_CONTRACT_VERSION,
  };
  const args = { accompanimentId: seed.accompanimentId };

  await pro.mutation(api.presentation.accompaniments.pauseAccompaniment, args);
  for (const caller of [student, pro]) {
    await expectPublicError(caller.mutation(cancelAppointment, cancelArgs), "unauthorized");
  }
  await expectPublicError(pro.mutation(recordAppointmentAttendance, recordArgs), "unauthorized");
  const paused = await t.run(async (ctx) => [await ctx.db.get(future), await ctx.db.get(past)]);
  expect(paused.map((row) => row?.status)).toEqual(["scheduled", "scheduled"]);

  // Al reactivar, las mismas operaciones vuelven a proceder.
  await pro.mutation(api.presentation.accompaniments.reactivateAccompaniment, args);
  expect(await pro.mutation(recordAppointmentAttendance, recordArgs)).toEqual({
    appointmentId: past,
  });
  expect(await pro.mutation(cancelAppointment, cancelArgs)).toEqual({ appointmentId: future });
  expect(await t.run((ctx) => ctx.db.get(future))).toMatchObject({
    status: "cancelled_by_cereti",
    cancelReason: "Motivo ficticio",
  });
});

test("TI2-152 API: en pausa el enlace en línea no se lee ni se cambia, y vuelve al reactivar", async () => {
  const t = convexTest(schema, modules);
  const seed = await seedAccompaniment(t, "pausa-enlace");
  const appointmentId = await seedAppointment(t, {
    accompanimentId: seed.accompanimentId,
    studentId: seed.student,
    professionalId: seed.pro,
    startsAt: Date.now() + DAY,
  });
  const { getOnlineAccess, setOnlineAccessLink } = api.presentation.appointments;
  const read = { appointmentId, version: APPOINTMENT_CONTRACT_VERSION };
  const student = t.withIdentity(seed.studentIdentity);
  const pro = t.withIdentity(seed.proIdentity);
  const args = { accompanimentId: seed.accompanimentId };

  await pro.mutation(setOnlineAccessLink, { ...read, link: MEET_LINK });
  await pro.mutation(api.presentation.accompaniments.pauseAccompaniment, args);
  for (const caller of [student, pro]) {
    await expectPublicError(caller.query(getOnlineAccess, read), "unauthorized");
  }
  await expectPublicError(
    pro.mutation(setOnlineAccessLink, { ...read, link: OTHER_MEET_LINK }),
    "unauthorized",
  );

  await pro.mutation(api.presentation.accompaniments.reactivateAccompaniment, args);
  expect(await student.query(getOnlineAccess, read)).toEqual({
    status: "available",
    link: MEET_LINK,
    version: APPOINTMENT_CONTRACT_VERSION,
  });
});

test("TI2-152 API: fuera de un acompañamiento activo no se reserva ni se cambia el horario", async () => {
  const t = convexTest(schema, modules);
  for (const status of ["paused", "closed"] as const) {
    const seed = await seedAccompaniment(t, `reserva-${status}`, status);
    const startAt = Date.now() + 2 * DAY;
    const slot = {
      professionalId: seed.pro,
      modality: "online" as const,
      startAt,
      endAt: startAt + HOUR,
      version: APPOINTMENT_CONTRACT_VERSION,
    };
    const appointmentId = await seedAppointment(t, {
      accompanimentId: seed.accompanimentId,
      studentId: seed.student,
      professionalId: seed.pro,
      startsAt: Date.now() + DAY,
    });

    for (const identity of [seed.studentIdentity, seed.proIdentity]) {
      const caller = t.withIdentity(identity);
      await expectPublicError(
        caller.mutation(api.presentation.appointments.bookAppointment, {
          ...slot,
          accompanimentId: seed.accompanimentId,
        }),
        "unauthorized",
      );
      await expectPublicError(
        caller.mutation(api.presentation.appointments.rescheduleAppointment, {
          ...slot,
          appointmentId,
        }),
        "unauthorized",
      );
    }
    const rows = await t.run((ctx) => ctx.db.query("appointments").take(10));
    expect(rows.every((row) => row.status === "scheduled")).toBe(true);
  }
});

test("TI2-152 API: cerrar cancela las atenciones futuras de todos los profesionales y guarda el cierre en el acompañamiento", async () => {
  const t = convexTest(schema, modules);
  const seed = await seedAccompaniment(t, "cierre");
  const base = {
    accompanimentId: seed.accompanimentId,
    studentId: seed.student,
    professionalId: seed.pro,
  };
  const now = Date.now();
  const own = await seedAppointment(t, { ...base, startsAt: now + DAY });
  const others = await seedAppointment(t, {
    ...base,
    professionalId: seed.otherPro,
    startsAt: now + 2 * DAY,
    status: "rescheduled",
  });
  const completed = await seedAppointment(t, {
    ...base,
    startsAt: now - 3 * DAY,
    status: "completed",
  });
  const alreadyCancelled = await seedAppointment(t, {
    ...base,
    startsAt: now + 3 * DAY,
    status: "cancelled_by_student",
  });
  const pro = t.withIdentity(seed.proIdentity);

  expect(
    await pro.query(api.presentation.accompaniments.getAccompanimentClosurePreview, {
      accompanimentId: seed.accompanimentId,
    }),
  ).toEqual({ appointmentsToCancel: 2, unrecordedAppointments: 0 });

  expect(
    await pro.mutation(api.presentation.accompaniments.closeAccompaniment, {
      accompanimentId: seed.accompanimentId,
      reason: "Motivo ficticio del cierre",
    }),
  ).toEqual({ accompanimentId: seed.accompanimentId, status: "closed", cancelledAppointments: 2 });

  const rows = await t.run(async (ctx) => ({
    own: await ctx.db.get(own),
    others: await ctx.db.get(others),
    completed: await ctx.db.get(completed),
    alreadyCancelled: await ctx.db.get(alreadyCancelled),
    audit: await ctx.db.query("appointmentAuditEvents").take(10),
  }));
  // El motivo del cierre no se copia a las atenciones: reciben el texto fijo.
  for (const cancelled of [rows.own, rows.others]) {
    expect(cancelled).toMatchObject({
      status: "cancelled_by_cereti",
      cancelReason: ACCOMPANIMENT_CLOSURE_CANCEL_REASON,
    });
  }
  expect(rows.completed?.status).toBe("completed");
  expect(rows.alreadyCancelled?.status).toBe("cancelled_by_student");
  expect(rows.alreadyCancelled).not.toHaveProperty("cancelReason");
  expect(rows.audit.map((event) => event.appointmentId).sort()).toEqual([own, others].sort());
  for (const event of rows.audit) {
    expect(event).toMatchObject({
      action: "cancelled",
      actorId: seed.pro,
      result: "cancelled_by_cereti",
    });
  }

  const state = await readState(t, seed.accompanimentId);
  expect(state).toMatchObject({
    status: "closed",
    closedById: seed.pro,
    closureReason: "Motivo ficticio del cierre",
  });
  expect(state.closedAt).toBeGreaterThan(0);

  // El historial se sigue leyendo, con el estado cerrado, para ambos lados, y
  // ninguna lectura entrega los datos del cierre.
  const read = await pro.query(api.presentation.accompaniments.getAccompaniment, {
    accompanimentId: seed.accompanimentId,
  });
  expect(read).toMatchObject({ status: "closed", view: "full" });
  for (const field of ["closedById", "closedAt", "closureReason"]) {
    expect(read).not.toHaveProperty(field);
  }
  const owned = await t
    .withIdentity(seed.studentIdentity)
    .query(api.presentation.accompaniments.listOwnedAccompaniments, {
      paginationOpts: { numItems: 5, cursor: null },
    });
  expect(owned.page.map((item) => item.status)).toEqual(["closed"]);
});

test("TI2-152 API: una atención vigente cuya hora ya pasó impide el cierre, y desde la pausa se reactiva para registrarla", async () => {
  const t = convexTest(schema, modules);
  const seed = await seedAccompaniment(t, "cierre-pendiente", "paused");
  const base = {
    accompanimentId: seed.accompanimentId,
    studentId: seed.student,
    professionalId: seed.pro,
  };
  const now = Date.now();
  const future = await seedAppointment(t, { ...base, startsAt: now + DAY });
  const unrecorded = await seedAppointment(t, { ...base, startsAt: now - DAY });
  const pro = t.withIdentity(seed.proIdentity);
  const args = { accompanimentId: seed.accompanimentId };

  expect(
    await pro.query(api.presentation.accompaniments.getAccompanimentClosurePreview, args),
  ).toEqual({ appointmentsToCancel: 1, unrecordedAppointments: 1 });
  await expectPublicError(
    pro.mutation(api.presentation.accompaniments.closeAccompaniment, args),
    "conflict",
  );
  expect((await t.run((ctx) => ctx.db.get(future)))?.status).toBe("scheduled");
  expect(await readState(t, seed.accompanimentId)).toEqual({ status: "paused" });

  // En pausa no se registra el resultado: se reactiva, se registra y se cierra.
  const record = {
    appointmentId: unrecorded,
    outcome: "completed" as const,
    version: APPOINTMENT_CONTRACT_VERSION,
  };
  await expectPublicError(
    pro.mutation(api.presentation.appointments.recordAppointmentAttendance, record),
    "unauthorized",
  );
  await pro.mutation(api.presentation.accompaniments.reactivateAccompaniment, args);
  expect(
    await pro.mutation(api.presentation.appointments.recordAppointmentAttendance, record),
  ).toEqual({ appointmentId: unrecorded });
  expect(
    await pro.mutation(api.presentation.accompaniments.closeAccompaniment, args),
  ).toMatchObject({ status: "closed", cancelledAppointments: 1 });
  expect(await readState(t, seed.accompanimentId)).toMatchObject({
    status: "closed",
    closedById: seed.pro,
  });
});

test("TI2-152 API: quien se retira pierde acceso en la siguiente consulta y el último profesional no se retira", async () => {
  const t = convexTest(schema, modules);
  const seed = await seedAccompaniment(t, "retiro");
  const { getAccompaniment, revokeAccompanimentAccess, pauseAccompaniment } =
    api.presentation.accompaniments;
  const args = { accompanimentId: seed.accompanimentId };
  const retiring = t.withIdentity(seed.otherProIdentity);

  expect(await retiring.query(getAccompaniment, args)).toMatchObject({ view: "full" });
  expect(
    await t.withIdentity(seed.proIdentity).mutation(revokeAccompanimentAccess, {
      ...args,
      userId: seed.otherPro,
      assignedRole: "professional",
    }),
  ).toBe(1);

  // La lectura conserva su denegación genérica en texto plano (TI2-8).
  await expect(retiring.query(getAccompaniment, args)).rejects.toMatchObject({
    data: "No autorizado",
  });
  await expectPublicError(retiring.mutation(pauseAccompaniment, args), "unauthorized");
  const revoked = await t.run(async (ctx) => {
    return await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
        q.eq("accompanimentId", seed.accompanimentId).eq("userId", seed.otherPro),
      )
      .take(5);
  });
  expect(revoked).toHaveLength(1);
  expect(revoked[0]).toMatchObject({ status: "revoked", revokedBy: seed.pro });
  expect(revoked[0]?.revokedAt).toBeGreaterThan(0);

  // Queda un solo profesional: retirarse dejaría el acompañamiento sin nadie.
  const last = t.withIdentity(seed.proIdentity);
  await expectPublicError(
    last.mutation(revokeAccompanimentAccess, {
      ...args,
      userId: seed.pro,
      assignedRole: "professional",
    }),
    "conflict",
  );
  expect(await last.query(getAccompaniment, args)).toMatchObject({ view: "full" });
});

test("TI2-152 API: un acompañamiento cerrado no admite conceder ni modificar accesos, pero sí retirarlos", async () => {
  const t = convexTest(schema, modules);
  const seed = await seedAccompaniment(t, "cerrado-accesos", "closed");
  const { assignAccompanimentAccess, updateAccompanimentAccess, revokeAccompanimentAccess } =
    api.presentation.accompaniments;
  const newcomer = await seedUser(t, "ti152-nuevo", "professional");
  const pro = t.withIdentity(seed.proIdentity);

  await expectPublicError(
    pro.mutation(assignAccompanimentAccess, {
      accompanimentId: seed.accompanimentId,
      userId: newcomer,
      assignedRole: "professional",
    }),
    "conflict",
  );
  await expectPublicError(
    pro.mutation(updateAccompanimentAccess, {
      accompanimentId: seed.accompanimentId,
      userId: seed.otherPro,
      assignedRole: "professional",
      validUntil: Date.now() + DAY,
    }),
    "conflict",
  );
  expect(
    await pro.mutation(revokeAccompanimentAccess, {
      accompanimentId: seed.accompanimentId,
      userId: seed.otherPro,
      assignedRole: "professional",
    }),
  ).toBe(1);
});
