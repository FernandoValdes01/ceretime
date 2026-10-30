/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { deniedPublicError } from "../application/authorization/authorize";
import { APPOINTMENT_CONTRACT_VERSION } from "../domain/appointments/appointment";
import { AGENDA_TIME_ZONE, expandAvailabilitySlots } from "../domain/availability/availability";
import {
  conflictError,
  errResult,
  isErrorResult,
  isOkResult,
  noAvailabilityError,
  okResult,
  unauthorizedError,
} from "../domain/errors/api_error";
import { ACCESS_NEEDS_MAX_LENGTH } from "../domain/requests/request";
import {
  denyUnauthorized,
  throwPublicApiError,
  toSecureConvexError,
} from "../presentation/session";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

// `createTestRequest` es una semilla guardada: solo opera con el interruptor
// activado, como en `database.test.ts` (aislado por archivo).
vi.stubEnv("TEST_SEEDS_ENABLED", "true");

/**
 * Superficie API del Backend en Sprint 1 (TI2-26).
 *
 * Las mutations públicas son adaptadores delgados: validan la forma de
 * entrada, resuelven la identidad en el servidor y delegan las reglas en
 * Aplicación/Dominio. La habilitación y la concesión siguen en vías internas
 * guardadas y el Sprint 1 no usa `action`. Cada prueba usa identidad simulada
 * (`withIdentity` con `tokenIdentifier` explícito) y datos ficticios.
 */

const ISSUER = "https://accounts.google.com";

/** Identidad simulada con `tokenIdentifier` explícito. */
function identityFor(subject: string, email: string) {
  return {
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    email,
    name: "Ficticio",
  };
}

/** Usuario ficticio persistido con identidad vinculada. */
async function seedUser(
  t: ReturnType<typeof convexTest>,
  input: {
    subject: string;
    email: string;
    role: "student" | "professional" | "intern" | "admin";
    institutionalStatus?: "enabled" | "disabled" | "pending";
  },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: input.email,
      fullName: "Ficticio",
      role: input.role,
      institutionalStatus: input.institutionalStatus ?? "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|${input.subject}`,
    });
  });
}

/**
 * Confirma que no persiste ninguna solicitud con una lectura acotada: basta
 * la primera fila para saber que el rechazo no guardó nada, sin barrer la
 * tabla.
 */
async function expectNoRequests(t: ReturnType<typeof convexTest>) {
  const found = await t.run(async (ctx) => {
    return await ctx.db.query("requests").first();
  });
  expect(found).toBeNull();
}

test("Registro válido guarda la necesidad recortada en estado recibido", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, { subject: "ti26-est-1", email: "ti26-est-1@alu.uct.cl", role: "student" });

  const asStudent = t.withIdentity(identityFor("ti26-est-1", "ti26-est-1@alu.uct.cl"));
  const created = await asStudent.mutation(api.presentation.requests.createRequest, {
    accessNeeds: "  Necesidad de acceso ficticia  ",
  });
  expect(created.status).toBe("received");
  expect(created.accessNeeds).toBe("Necesidad de acceso ficticia");
});

test("Necesidad vacía se rechaza como error operativo sin persistir", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, { subject: "ti26-est-2", email: "ti26-est-2@alu.uct.cl", role: "student" });

  const asStudent = t.withIdentity(identityFor("ti26-est-2", "ti26-est-2@alu.uct.cl"));
  const message = await asStudent
    .mutation(api.presentation.requests.createRequest, { accessNeeds: "   " })
    .then(
      () => {
        throw new Error("Se esperaba rechazo operativo");
      },
      (error: Error) => error.message,
    );
  expect(message).toContain("necesidad");
  expect(message).not.toContain("No autorizado");
  await expectNoRequests(t);
});

test("Necesidad en el tope se acepta y sobre el tope se rechaza sin persistir", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, { subject: "ti26-est-3", email: "ti26-est-3@alu.uct.cl", role: "student" });

  // Justo en el límite del contrato: se registra íntegro.
  const asStudent = t.withIdentity(identityFor("ti26-est-3", "ti26-est-3@alu.uct.cl"));
  const created = await asStudent.mutation(api.presentation.requests.createRequest, {
    accessNeeds: "x".repeat(ACCESS_NEEDS_MAX_LENGTH),
  });
  expect(created.status).toBe("received");
  expect(created.accessNeeds).toHaveLength(ACCESS_NEEDS_MAX_LENGTH);

  // Un carácter sobre el límite: se rechaza como error operativo.
  await expect(
    asStudent.mutation(api.presentation.requests.createRequest, {
      accessNeeds: "x".repeat(ACCESS_NEEDS_MAX_LENGTH + 1),
    }),
  ).rejects.toThrow("máximo");

  // El rechazo no persiste nada nuevo: sigue existiendo solo la aceptada,
  // comprobado con una lectura acotada en vez de barrer la tabla.
  const stored = await t.query(internal.operations.requests.getRequestById, { id: created._id });
  expect(stored?.status).toBe("received");
  const rows = await t.run(async (ctx) => {
    return await ctx.db.query("requests").take(2);
  });
  expect(rows.map((row) => row._id)).toEqual([created._id]);
});

test("Toma y operación ajena se deniegan con error genérico sin modificar nada", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti26-est-4",
    email: "ti26-est-4@alu.uct.cl",
    role: "student",
  });
  await seedUser(t, { subject: "ti26-pro-1", email: "ti26-pro-1@uct.cl", role: "professional" });
  const requestId = await t.mutation(internal.operations.requests.createTestRequest, {
    studentId,
    status: "received",
    accessNeeds: "Necesidad de acceso ficticia",
  });

  // Anónimo y Estudiante no toman solicitudes.
  await expect(t.mutation(api.presentation.requests.takeRequest, { requestId })).rejects.toThrow(
    "No autorizado",
  );
  const asStudent = t.withIdentity(identityFor("ti26-est-4", "ti26-est-4@alu.uct.cl"));
  await expect(
    asStudent.mutation(api.presentation.requests.takeRequest, { requestId }),
  ).rejects.toThrow("No autorizado");

  // Profesional vigente sin toma no opera la solicitud ni la modifica.
  const asStranger = t.withIdentity(identityFor("ti26-pro-1", "ti26-pro-1@uct.cl"));
  await expect(
    asStranger.mutation(api.presentation.requests.requestAdditionalInformation, {
      requestId,
      reason: "Falta el horario disponible",
    }),
  ).rejects.toThrow("No autorizado");
  const untouched = await t.query(internal.operations.requests.getRequestById, { id: requestId });
  expect(untouched?.status).toBe("received");
});

test("Habilitación guardada: el administrador habilita y el resto se deniega", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, { subject: "ti26-adm-1", email: "ti26-adm-1@uct.cl", role: "admin" });
  const internId = await seedUser(t, {
    subject: "ti26-int-1",
    email: "ti26-int-1@alu.uct.cl",
    role: "intern",
    institutionalStatus: "pending",
  });
  const otherId = await seedUser(t, {
    subject: "ti26-int-2",
    email: "ti26-int-2@alu.uct.cl",
    role: "intern",
    institutionalStatus: "pending",
  });
  await seedUser(t, { subject: "ti26-est-5", email: "ti26-est-5@alu.uct.cl", role: "student" });

  // Vía interna con Administrador vigente: habilita sin cambiar el rol.
  const asAdmin = t.withIdentity(identityFor("ti26-adm-1", "ti26-adm-1@uct.cl"));
  const enabledId = await asAdmin.mutation(internal.operations.accounts.enableIntern, {
    userId: internId,
  });
  expect(enabledId).toEqual(internId);

  // Un Estudiante no habilita cuentas por la vía guardada.
  const asStudent = t.withIdentity(identityFor("ti26-est-5", "ti26-est-5@alu.uct.cl"));
  await expect(
    asStudent.mutation(internal.operations.accounts.enableIntern, { userId: otherId }),
  ).rejects.toThrow("No autorizado");
});

test("Concesión guardada: el profesional autorizado concede y el practicante no se auto-asigna", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti26-est-6",
    email: "ti26-est-6@alu.uct.cl",
    role: "student",
  });
  const proId = await seedUser(t, {
    subject: "ti26-pro-2",
    email: "ti26-pro-2@uct.cl",
    role: "professional",
  });
  await seedUser(t, { subject: "ti26-pro-3", email: "ti26-pro-3@uct.cl", role: "professional" });
  const internId = await seedUser(t, {
    subject: "ti26-int-3",
    email: "ti26-int-3@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "Necesidad de acceso ficticia",
    });
  });

  // Arranque entre profesionales y concesión al Practicante habilitado.
  const asBootstrap = t.withIdentity(identityFor("ti26-pro-3", "ti26-pro-3@uct.cl"));
  await asBootstrap.mutation(internal.operations.assignments.assign, {
    accompanimentId,
    userId: proId,
    assignedRole: "professional",
  });
  const asPro = t.withIdentity(identityFor("ti26-pro-2", "ti26-pro-2@uct.cl"));
  await asPro.mutation(internal.operations.assignments.assign, {
    accompanimentId,
    userId: internId,
    assignedRole: "intern",
  });
  const row = await t.run(async (ctx) => {
    return await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
        q
          .eq("accompanimentId", accompanimentId as Id<"accompaniments">)
          .eq("userId", internId)
          .eq("status", "active")
          .eq("assignedRole", "intern"),
      )
      .unique();
  });
  expect(row?.grantedBy).toEqual(proId);

  // El Practicante no se auto-asigna accesos por la vía guardada.
  const asIntern = t.withIdentity(identityFor("ti26-int-3", "ti26-int-3@alu.uct.cl"));
  await expect(
    asIntern.mutation(internal.operations.assignments.assign, {
      accompanimentId,
      userId: internId,
      assignedRole: "intern",
    }),
  ).rejects.toThrow("No autorizado");
});

test("Contrato TI2-88: códigos separan conflicto y ausencia de cupo sin filtrar existencia", async () => {
  const denied = unauthorizedError();
  const conflict = conflictError();
  const sinCupo = noAvailabilityError();

  expect(denied).toEqual({ code: "unauthorized", message: "No autorizado" });
  expect(conflict.code).toBe("conflict");
  expect(sinCupo.code).toBe("no_availability");
  expect(new Set([denied.code, conflict.code, sinCupo.code]).size).toBe(3);
  expect(sinCupo.message).toContain("canal oficial");
  expect(sinCupo.message).not.toMatch(/reserv/i);

  const ok = okResult({ id: "ficticio-1" });
  expect(ok).toEqual({ status: "ok", data: { id: "ficticio-1" } });
  expect(Object.keys(ok).sort()).toEqual(["data", "status"]);
  expect(isOkResult(ok)).toBe(true);

  const error = errResult(conflict);
  expect(isErrorResult(error)).toBe(true);
  if (!isErrorResult(error)) throw new Error("Se esperaba error");
  expect(Object.keys(error).sort()).toEqual(["error", "status"]);
  expect(Object.keys(error.error).sort()).toEqual(["code", "message"]);
  expect(error.error.code).not.toBe(error.error.message);
});

test("Contrato TI2-88: traducción segura reutilizada sin detalles sensibles", async () => {
  expect(deniedPublicError()).toEqual({ code: "unauthorized", message: "No autorizado" });
  expect(Object.keys(deniedPublicError()).sort()).toEqual(["code", "message"]);
  await expect(async () => denyUnauthorized()).rejects.toThrow("No autorizado");

  const conflict = conflictError();
  const convex = toSecureConvexError(conflict);
  expect(convex).toBeInstanceOf(ConvexError);
  expect(convex.data).toEqual({ code: "conflict", message: conflict.message });
  expect(Object.keys(convex.data as Record<string, unknown>).sort()).toEqual(["code", "message"]);

  const sinCupo = toSecureConvexError(noAvailabilityError());
  expect((sinCupo.data as { code: string }).code).toBe("no_availability");
  expect((sinCupo.data as { code: string }).code).not.toBe((convex.data as { code: string }).code);

  await expect(async () => throwPublicApiError(conflict)).rejects.toThrow(conflict.message);
  const sanitized = toSecureConvexError({
    code: "unauthorized",
    message: "No autorizado",
    stack: "pila ficticia",
    studentId: "tercero ficticio",
  } as unknown as { code: string; message: string });
  expect(Object.keys(sanitized.data as Record<string, unknown>).sort()).toEqual([
    "code",
    "message",
  ]);
  expect(JSON.stringify(sanitized.data)).not.toContain("pila");
  expect(JSON.stringify(sanitized.data)).not.toContain("tercero");
});

test("Contrato TI2-88: identificador ajeno e inexistente responden igual sin filtrar", async () => {
  const t = convexTest(schema, modules);
  const ownerId = await seedUser(t, {
    subject: "ti88-est-1",
    email: "ti88-est-1@alu.uct.cl",
    role: "student",
  });
  await seedUser(t, { subject: "ti88-est-2", email: "ti88-est-2@alu.uct.cl", role: "student" });
  const requestId = await t.mutation(internal.operations.requests.createTestRequest, {
    studentId: ownerId,
    status: "received",
    accessNeeds: "Necesidad de acceso ficticia",
  });
  const missingRequestId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("requests", {
      studentId: ownerId,
      status: "received",
      accessNeeds: "Temporal ficticia",
      createdAt: 1,
    });
    await ctx.db.delete(id);
    return id;
  });

  const asStranger = t.withIdentity(identityFor("ti88-est-2", "ti88-est-2@alu.uct.cl"));
  const asOwner = t.withIdentity(identityFor("ti88-est-1", "ti88-est-1@alu.uct.cl"));
  const readMessage = async (promise: Promise<unknown>) =>
    await promise.then(
      () => {
        throw new Error("Se esperaba denegación");
      },
      (error: Error) => error.message,
    );

  const foreignMessage = await readMessage(
    asStranger.query(api.presentation.requests.getRequest, { requestId }),
  );
  const missingMessage = await readMessage(
    asOwner.query(api.presentation.requests.getRequest, { requestId: missingRequestId }),
  );
  for (const message of [foreignMessage, missingMessage]) {
    expect(message).toContain("No autorizado");
    expect(message).not.toContain(String(requestId));
    expect(message).not.toContain(String(missingRequestId));
    expect(message).not.toContain("Necesidad de acceso ficticia");
    expect(message).not.toContain("stack");
  }
  expect(foreignMessage).toBe(missingMessage);

  const accompanimentId = await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId: ownerId,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "Necesidad de acceso ficticia",
    });
  });
  const missingAccompanimentId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("accompaniments", {
      studentId: ownerId,
      status: "active",
      objective: "Temporal ficticio",
      accessNeeds: "Temporal ficticio",
    });
    await ctx.db.delete(id);
    return id;
  });

  const foreignAccompaniment = await readMessage(
    asStranger.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
  );
  const missingAccompaniment = await readMessage(
    asOwner.query(api.presentation.accompaniments.getAccompaniment, {
      accompanimentId: missingAccompanimentId,
    }),
  );
  for (const message of [foreignAccompaniment, missingAccompaniment]) {
    expect(message).toContain("No autorizado");
    expect(message).not.toContain(String(accompanimentId));
    expect(message).not.toContain(String(missingAccompanimentId));
    expect(message).not.toContain("Objetivo ficticio");
    expect(message).not.toContain("Necesidad de acceso ficticia");
  }
  expect(foreignAccompaniment).toBe(missingAccompaniment);
});

// ── TI2-121: API pública de cancelación, reagendamiento y atención ─────────

const TI121_HOUR = 60 * 60_000;
const TI121_DAY = 24 * TI121_HOUR;

/** Lunes futuro de la agenda ficticia, con al menos dos semanas de margen. */
function ti121NextMonday(): string {
  const base = new Date(Date.now() + 14 * TI121_DAY);
  const untilMonday = (8 - base.getUTCDay()) % 7;
  return new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + untilMonday),
  )
    .toISOString()
    .slice(0, 10);
}

/**
 * Cupos del bloque ficticio en la zona de la agenda. Se calculan con la misma
 * expansión de Dominio para que el instante enviado coincida exactamente con
 * el que el servidor revalida en `AGENDA_TIME_ZONE`.
 */
function ti121FutureSlots(professionalId: Id<"users">) {
  const date = ti121NextMonday();
  const slots = expandAvailabilitySlots({
    professionalId,
    blocks: [
      {
        id: "ti121-block",
        professionalId,
        weekday: 1,
        startMinute: 540,
        endMinute: 660,
        slotMinutes: 60,
        modality: "online",
        version: "v1",
      },
    ],
    from: date,
    to: date,
    timeZone: AGENDA_TIME_ZONE,
  });
  if (slots.length < 2) throw new Error("Se esperaban al menos dos cupos ficticios");
  return slots;
}

/** Agenda mínima: Profesional asignado, Estudiante dueño y acompañamiento. */
async function seedTi121Agenda(t: ReturnType<typeof convexTest>, label: string) {
  const pro = await seedUser(t, {
    subject: `ti121-pro-${label}`,
    email: `ti121-pro-${label}@uct.cl`,
    role: "professional",
  });
  const student = await seedUser(t, {
    subject: `ti121-est-${label}`,
    email: `ti121-est-${label}@alu.uct.cl`,
    role: "student",
  });
  const accompanimentId = await t.run(async (ctx) =>
    ctx.db.insert("accompaniments", {
      studentId: student,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "",
    }),
  );
  await t.run(async (ctx) =>
    ctx.db.insert("accompanimentAssignments", {
      accompanimentId,
      userId: pro,
      assignedRole: "professional",
      status: "active",
    }),
  );
  return {
    pro,
    student,
    accompanimentId,
    proIdentity: identityFor(`ti121-pro-${label}`, `ti121-pro-${label}@uct.cl`),
    studentIdentity: identityFor(`ti121-est-${label}`, `ti121-est-${label}@alu.uct.cl`),
  };
}

/** Bloque en línea del lunes futuro: 09:00–11:00 local, cupos de 60 minutos. */
async function seedTi121Block(t: ReturnType<typeof convexTest>, professionalId: Id<"users">) {
  return await t.run(async (ctx) =>
    ctx.db.insert("availabilityBlocks", {
      professionalId,
      weekday: 1,
      startMinute: 540,
      endMinute: 660,
      slotMinutes: 60,
      modality: "online",
      isActive: true,
    }),
  );
}

/** Atención ficticia sobre la agenda sembrada. */
async function seedTi121Appointment(
  t: ReturnType<typeof convexTest>,
  input: {
    readonly accompanimentId: Id<"accompaniments">;
    readonly studentId: Id<"users">;
    readonly professionalId: Id<"users">;
    readonly startsAt: number;
    readonly endsAt: number;
    readonly status?: "scheduled" | "completed" | "cancelled_by_student" | "rescheduled";
  },
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("appointments", {
      accompanimentId: input.accompanimentId,
      studentId: input.studentId,
      professionalId: input.professionalId,
      modality: "online",
      status: input.status ?? "scheduled",
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdAt: Date.now(),
    }),
  );
}

/** Atención por identificador opaco, como la lee el adaptador real. */
async function getTi121(t: ReturnType<typeof convexTest>, appointmentId: string) {
  return await t.run(async (ctx) => {
    const id = ctx.db.normalizeId("appointments", appointmentId);
    return id === null ? null : await ctx.db.get(id);
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

/** Usuarios ajenos a la agenda para comprobar las denegaciones por rol. */
async function seedTi121DeniedUsers(t: ReturnType<typeof convexTest>) {
  await seedUser(t, {
    subject: "ti121-est-denied",
    email: "ti121-est-denied@alu.uct.cl",
    role: "student",
  });
  await seedUser(t, {
    subject: "ti121-pro-denied",
    email: "ti121-pro-denied@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti121-int-denied",
    email: "ti121-int-denied@alu.uct.cl",
    role: "intern",
  });
  await seedUser(t, {
    subject: "ti121-adm-denied",
    email: "ti121-adm-denied@uct.cl",
    role: "admin",
  });
}

/** Usuarios que nunca deben operar una atención de la agenda. */
function ti121DeniedCallers() {
  return [
    { label: "anónimo", identity: null },
    {
      label: "estudiante ajeno",
      identity: identityFor("ti121-est-denied", "ti121-est-denied@alu.uct.cl"),
    },
    {
      label: "profesional ajeno",
      identity: identityFor("ti121-pro-denied", "ti121-pro-denied@uct.cl"),
    },
    {
      label: "practicante",
      identity: identityFor("ti121-int-denied", "ti121-int-denied@alu.uct.cl"),
    },
    {
      label: "administrador",
      identity: identityFor("ti121-adm-denied", "ti121-adm-denied@uct.cl"),
    },
  ];
}

/** Identificador de atención que existió y ya no existe, sin inventar forma. */
async function ti121MissingAppointment(
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

test("TI2-121: el Estudiante cancela su atención y una repetición no la modifica", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedTi121Agenda(t, "cancel-est");
  const startsAt = Date.now() + TI121_DAY;
  const appointmentId = await seedTi121Appointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt,
    endsAt: startsAt + TI121_HOUR,
  });
  const asStudent = t.withIdentity(agenda.studentIdentity);

  const canceled = await asStudent.mutation(api.presentation.appointments.cancelAppointment, {
    appointmentId,
    reason: "  Motivo ficticio  ",
    version: APPOINTMENT_CONTRACT_VERSION,
  });
  expect(canceled).toEqual({ appointmentId });

  const row = await getTi121(t, appointmentId);
  expect(row).toMatchObject({
    status: "cancelled_by_student",
    cancelReason: "Motivo ficticio",
    startsAt,
  });

  const repeated = await publicErrorData(
    asStudent.mutation(api.presentation.appointments.cancelAppointment, {
      appointmentId,
      reason: "Otro motivo ficticio",
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
  );
  expect(repeated).toEqual({ code: "conflict", message: conflictError().message });
  expect(await getTi121(t, appointmentId)).toEqual(row);
});

test("TI2-121: el Profesional asignado cancela como CERETI y el motivo es obligatorio", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedTi121Agenda(t, "cancel-pro");
  const startsAt = Date.now() + TI121_DAY;
  const appointmentId = await seedTi121Appointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt,
    endsAt: startsAt + TI121_HOUR,
  });
  const asPro = t.withIdentity(agenda.proIdentity);

  const withoutReason = await publicErrorData(
    asPro.mutation(api.presentation.appointments.cancelAppointment, {
      appointmentId,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
  );
  expect(withoutReason).toEqual({ code: "conflict", message: conflictError().message });
  expect((await getTi121(t, appointmentId))?.status).toBe("scheduled");

  const canceled = await asPro.mutation(api.presentation.appointments.cancelAppointment, {
    appointmentId,
    reason: "Reagendamiento institucional ficticio",
    version: APPOINTMENT_CONTRACT_VERSION,
  });
  expect(canceled).toEqual({ appointmentId });
  expect(await getTi121(t, appointmentId)).toMatchObject({
    status: "cancelled_by_cereti",
    cancelReason: "Reagendamiento institucional ficticio",
    startsAt,
  });
});

test("TI2-121: cancelación ajena, anónima o de rol ajeno responde la misma denegación", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedTi121Agenda(t, "cancel-denied");
  await seedTi121DeniedUsers(t);
  const startsAt = Date.now() + TI121_DAY;
  const appointmentId = await seedTi121Appointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt,
    endsAt: startsAt + TI121_HOUR,
  });

  for (const { label, identity } of ti121DeniedCallers()) {
    const caller = identity === null ? t : t.withIdentity(identity);
    const data = await publicErrorData(
      caller.mutation(api.presentation.appointments.cancelAppointment, {
        appointmentId,
        reason: "Motivo ficticio",
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    );
    expect({ label, data }).toEqual({
      label,
      data: { code: "unauthorized", message: "No autorizado" },
    });
  }
  expect((await getTi121(t, appointmentId))?.status).toBe("scheduled");

  const missingId = await ti121MissingAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
  });
  const asStranger = t.withIdentity(identityFor("ti121-est-denied", "ti121-est-denied@alu.uct.cl"));
  const foreign = await publicErrorData(
    asStranger.mutation(api.presentation.appointments.cancelAppointment, {
      appointmentId,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
  );
  const missing = await publicErrorData(
    asStranger.mutation(api.presentation.appointments.cancelAppointment, {
      appointmentId: missingId,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
  );
  expect(foreign).toEqual(missing);
  expect(foreign).toEqual({ code: "unauthorized", message: "No autorizado" });
});

test("TI2-121: el Estudiante mueve su atención a un cupo vigente y conserva la fecha original", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedTi121Agenda(t, "move-est");
  await seedTi121Block(t, agenda.pro);
  const slots = ti121FutureSlots(agenda.pro);
  const appointmentId = await seedTi121Appointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: slots[0]!.startAt,
    endsAt: slots[0]!.endAt,
  });
  const asStudent = t.withIdentity(agenda.studentIdentity);

  const moved = await asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
    appointmentId,
    professionalId: agenda.pro,
    modality: "online",
    startAt: slots[1]!.startAt,
    endAt: slots[1]!.endAt,
    version: APPOINTMENT_CONTRACT_VERSION,
  });
  expect(moved).toEqual({ appointmentId });
  expect(await getTi121(t, appointmentId)).toMatchObject({
    startsAt: slots[1]!.startAt,
    endsAt: slots[1]!.endAt,
    status: "rescheduled",
    originalStartsAt: slots[0]!.startAt,
  });

  const chained = await asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
    appointmentId,
    professionalId: agenda.pro,
    modality: "online",
    startAt: slots[0]!.startAt,
    endAt: slots[0]!.endAt,
    version: APPOINTMENT_CONTRACT_VERSION,
  });
  expect(chained).toEqual({ appointmentId });
  expect(await getTi121(t, appointmentId)).toMatchObject({
    startsAt: slots[0]!.startAt,
    status: "rescheduled",
    originalStartsAt: slots[0]!.startAt,
  });
  expect(await t.run(async (ctx) => await ctx.db.query("appointments").take(10))).toHaveLength(1);
});

test("TI2-121: el Profesional mueve su atención y no la ajena ni a otra agenda", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedTi121Agenda(t, "move-pro");
  await seedTi121Block(t, agenda.pro);
  const slots = ti121FutureSlots(agenda.pro);
  const appointmentId = await seedTi121Appointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: slots[0]!.startAt,
    endsAt: slots[0]!.endAt,
  });
  const asPro = t.withIdentity(agenda.proIdentity);

  const moved = await asPro.mutation(api.presentation.appointments.rescheduleAppointment, {
    appointmentId,
    professionalId: agenda.pro,
    modality: "online",
    startAt: slots[1]!.startAt,
    endAt: slots[1]!.endAt,
    version: APPOINTMENT_CONTRACT_VERSION,
  });
  expect(moved).toEqual({ appointmentId });
  expect((await getTi121(t, appointmentId))?.startsAt).toBe(slots[1]!.startAt);

  const asOtherPro = t.withIdentity(identityFor("ti121-pro-denied", "ti121-pro-denied@uct.cl"));
  await seedUser(t, {
    subject: "ti121-pro-denied",
    email: "ti121-pro-denied@uct.cl",
    role: "professional",
  });
  const foreign = await publicErrorData(
    asOtherPro.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      modality: "online",
      startAt: slots[1]!.startAt,
      endAt: slots[1]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
  );
  expect(foreign).toEqual({ code: "unauthorized", message: "No autorizado" });

  const otherPro = await seedUser(t, {
    subject: "ti121-pro-other-agenda",
    email: "ti121-pro-other-agenda@uct.cl",
    role: "professional",
  });
  await seedTi121Block(t, otherPro);
  const otherSlots = ti121FutureSlots(otherPro);
  const toOtherAgenda = await publicErrorData(
    asPro.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: otherPro,
      modality: "online",
      startAt: otherSlots[1]!.startAt,
      endAt: otherSlots[1]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
  );
  expect(toOtherAgenda).toEqual({ code: "unauthorized", message: "No autorizado" });
  expect(await getTi121(t, appointmentId)).toMatchObject({
    professionalId: agenda.pro,
    startsAt: slots[1]!.startAt,
  });
});

test("TI2-121: reagendar una atención cancelada o a un cupo ocupado no cambia nada", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedTi121Agenda(t, "move-conflict");
  await seedTi121Block(t, agenda.pro);
  const slots = ti121FutureSlots(agenda.pro);
  const asStudent = t.withIdentity(agenda.studentIdentity);

  const canceledId = await seedTi121Appointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: slots[0]!.startAt,
    endsAt: slots[0]!.endAt,
    status: "cancelled_by_student",
  });
  const invalidState = await publicErrorData(
    asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId: canceledId,
      professionalId: agenda.pro,
      modality: "online",
      startAt: slots[1]!.startAt,
      endAt: slots[1]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
  );
  expect(invalidState).toEqual({ code: "conflict", message: conflictError().message });
  expect(await getTi121(t, canceledId)).toMatchObject({
    status: "cancelled_by_student",
    startsAt: slots[0]!.startAt,
  });

  const originId = await seedTi121Appointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: slots[0]!.startAt,
    endsAt: slots[0]!.endAt,
  });
  const otherStudent = await seedUser(t, {
    subject: "ti121-est-blocker",
    email: "ti121-est-blocker@alu.uct.cl",
    role: "student",
  });
  const otherAccompaniment = await t.run(async (ctx) =>
    ctx.db.insert("accompaniments", {
      studentId: otherStudent,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "",
    }),
  );
  const blockerId = await seedTi121Appointment(t, {
    accompanimentId: otherAccompaniment,
    studentId: otherStudent,
    professionalId: agenda.pro,
    startsAt: slots[1]!.startAt,
    endsAt: slots[1]!.endAt,
  });

  const occupied = await publicErrorData(
    asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId: originId,
      professionalId: agenda.pro,
      modality: "online",
      startAt: slots[1]!.startAt,
      endAt: slots[1]!.endAt,
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
  );
  expect(occupied).toEqual({ code: "conflict", message: conflictError().message });
  expect(await getTi121(t, originId)).toMatchObject({
    status: "scheduled",
    startsAt: slots[0]!.startAt,
  });
  expect((await getTi121(t, blockerId))?.startsAt).toBe(slots[1]!.startAt);
});

test("TI2-121: reagendar fuera de la disponibilidad vigente responde no_availability", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedTi121Agenda(t, "move-unavailable");
  await seedTi121Block(t, agenda.pro);
  const slots = ti121FutureSlots(agenda.pro);
  const appointmentId = await seedTi121Appointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: slots[0]!.startAt,
    endsAt: slots[0]!.endAt,
  });
  const targetStart = slots[1]!.startAt + 2 * TI121_HOUR;

  const result = await publicErrorData(
    t
      .withIdentity(agenda.studentIdentity)
      .mutation(api.presentation.appointments.rescheduleAppointment, {
        appointmentId,
        professionalId: agenda.pro,
        modality: "online",
        startAt: targetStart,
        endAt: targetStart + TI121_HOUR,
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
  );
  expect(result).toEqual({
    code: "no_availability",
    message: noAvailabilityError().message,
  });
  expect(await getTi121(t, appointmentId)).toMatchObject({
    status: "scheduled",
    startsAt: slots[0]!.startAt,
  });
});

test("TI2-121: el Profesional registra realización e inasistencia y el resto se deniega", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedTi121Agenda(t, "attendance");
  await seedTi121DeniedUsers(t);
  const startsAt = Date.now() - 2 * TI121_HOUR;
  const base = {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt,
    endsAt: startsAt + TI121_HOUR,
  };
  const completedId = await seedTi121Appointment(t, base);
  const noShowId = await seedTi121Appointment(t, base);
  const pendingId = await seedTi121Appointment(t, base);
  const asPro = t.withIdentity(agenda.proIdentity);

  expect(
    await asPro.mutation(api.presentation.appointments.recordAppointmentAttendance, {
      appointmentId: completedId,
      outcome: "completed",
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
  ).toEqual({ appointmentId: completedId });
  expect((await getTi121(t, completedId))?.status).toBe("completed");

  expect(
    await asPro.mutation(api.presentation.appointments.recordAppointmentAttendance, {
      appointmentId: noShowId,
      outcome: "no_show",
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
  ).toEqual({ appointmentId: noShowId });
  expect((await getTi121(t, noShowId))?.status).toBe("no_show");

  for (const { label, identity } of ti121DeniedCallers()) {
    const caller = identity === null ? t : t.withIdentity(identity);
    const data = await publicErrorData(
      caller.mutation(api.presentation.appointments.recordAppointmentAttendance, {
        appointmentId: pendingId,
        outcome: "completed",
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    );
    expect({ label, data }).toEqual({
      label,
      data: { code: "unauthorized", message: "No autorizado" },
    });
  }
  expect((await getTi121(t, pendingId))?.status).toBe("scheduled");

  const missingId = await ti121MissingAppointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
  });
  const asOtherPro = t.withIdentity(identityFor("ti121-pro-denied", "ti121-pro-denied@uct.cl"));
  const foreign = await publicErrorData(
    asOtherPro.mutation(api.presentation.appointments.recordAppointmentAttendance, {
      appointmentId: pendingId,
      outcome: "completed",
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
  );
  const missing = await publicErrorData(
    asOtherPro.mutation(api.presentation.appointments.recordAppointmentAttendance, {
      appointmentId: missingId,
      outcome: "completed",
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
  );
  expect(foreign).toEqual(missing);
  expect(foreign).toEqual({ code: "unauthorized", message: "No autorizado" });
});

test("TI2-121: el registro rechaza estados inválidos y resultados fuera del contrato", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedTi121Agenda(t, "attendance-invalid");
  const pastStart = Date.now() - 2 * TI121_HOUR;
  const base = {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: pastStart,
    endsAt: pastStart + TI121_HOUR,
  };
  const completedId = await seedTi121Appointment(t, { ...base, status: "completed" });
  const canceledId = await seedTi121Appointment(t, { ...base, status: "cancelled_by_student" });
  const futureId = await seedTi121Appointment(t, {
    ...base,
    startsAt: Date.now() + TI121_DAY,
    endsAt: Date.now() + TI121_DAY + TI121_HOUR,
  });
  const asPro = t.withIdentity(agenda.proIdentity);

  for (const appointmentId of [completedId, canceledId, futureId]) {
    const data = await publicErrorData(
      asPro.mutation(api.presentation.appointments.recordAppointmentAttendance, {
        appointmentId,
        outcome: "no_show",
        version: APPOINTMENT_CONTRACT_VERSION,
      }),
    );
    expect(data).toEqual({ code: "conflict", message: conflictError().message });
  }
  expect((await getTi121(t, completedId))?.status).toBe("completed");
  expect((await getTi121(t, canceledId))?.status).toBe("cancelled_by_student");
  expect((await getTi121(t, futureId))?.status).toBe("scheduled");

  await expect(
    asPro.mutation(api.presentation.appointments.recordAppointmentAttendance, {
      appointmentId: futureId,
      // @ts-expect-error `no_show_justified` no forma parte del contrato público: la justificación es TI2-119.
      outcome: "no_show_justified",
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
  ).rejects.toThrow(/no_show_justified/);
  expect((await getTi121(t, futureId))?.status).toBe("scheduled");
});

test("TI2-121: la zona horaria la fija el servidor y no viaja en la entrada", async () => {
  const t = convexTest(schema, modules);
  const agenda = await seedTi121Agenda(t, "move-zone");
  await seedTi121Block(t, agenda.pro);
  const slots = ti121FutureSlots(agenda.pro);
  const appointmentId = await seedTi121Appointment(t, {
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.student,
    professionalId: agenda.pro,
    startsAt: slots[0]!.startAt,
    endsAt: slots[0]!.endAt,
  });
  const asStudent = t.withIdentity(agenda.studentIdentity);

  await expect(
    asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      appointmentId,
      professionalId: agenda.pro,
      modality: "online",
      startAt: slots[1]!.startAt,
      endAt: slots[1]!.endAt,
      // @ts-expect-error `timeZone` no forma parte de la entrada: la fija `AGENDA_TIME_ZONE` en el servidor.
      timeZone: "UTC",
      version: APPOINTMENT_CONTRACT_VERSION,
    }),
  ).rejects.toThrow(/timeZone/);
  expect(await getTi121(t, appointmentId)).toMatchObject({
    status: "scheduled",
    startsAt: slots[0]!.startAt,
  });

  const moved = await asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
    appointmentId,
    professionalId: agenda.pro,
    modality: "online",
    startAt: slots[1]!.startAt,
    endAt: slots[1]!.endAt,
    version: APPOINTMENT_CONTRACT_VERSION,
  });
  expect(moved).toEqual({ appointmentId });
  expect(await getTi121(t, appointmentId)).toMatchObject({
    startsAt: slots[1]!.startAt,
    status: "rescheduled",
  });
});
