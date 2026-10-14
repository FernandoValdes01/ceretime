/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { APPOINTMENT_STATUS_VALUES } from "../domain/appointments/appointment";
import {
  CONFLICT_ERROR_CODE,
  conflictError,
  errResult,
  isErrorResult,
  isOkResult,
  NO_AVAILABILITY_ERROR_CODE,
  okResult,
} from "../domain/errors/api_error";
import {
  MAX_APPOINTMENT_MS,
  MAX_APPOINTMENTS_IN_WINDOW,
  occupySlotAtomically,
  type OccupySlotRow,
} from "../infrastructure/appointments/repository";
import { cancelRequest, closeRequestWithoutAccompaniment } from "../application/requests/commands";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

// `createTestRequest` es una semilla guardada: solo opera con el interruptor
// activado, como en `database.test.ts` (aislado por archivo).
vi.stubEnv("TEST_SEEDS_ENABLED", "true");

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

/** Estudiante ficticio persistido para asociar solicitudes. */
async function seedStudent(t: ReturnType<typeof convexTest>, subject: string) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: `${subject}@alu.uct.cl`,
      fullName: "Estudiante Ficticio",
      role: "student",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|${subject}`,
    });
  });
}

/** Profesional ficticio con cuenta habilitada y vigente. */
async function seedProfessional(t: ReturnType<typeof convexTest>, subject: string) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: `${subject}@uct.cl`,
      fullName: "Profesional Ficticio",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|${subject}`,
    });
  });
}

/** Acompañamiento ficticio para ocupar un cupo como atención. */
async function seedAccompaniment(t: ReturnType<typeof convexTest>, studentId: Id<"users">) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "Necesidad de acceso ficticia",
    });
  });
}

/** Lunes 2026-10-12 09:00 UTC en milisegundos de época. */
const TI84_SLOT_START = Date.UTC(2026, 9, 12, 9);

/** Lunes 2026-10-12 10:00 UTC en milisegundos de época. */
const TI84_SLOT_END = Date.UTC(2026, 9, 12, 10);

/** Solicitud recibida lista para tomar por la vía pública. */
async function registerOwnRequest(
  t: ReturnType<typeof convexTest>,
  studentSubject: string,
  accessNeeds = "Necesidad de acceso ficticia",
) {
  const asStudent = t.withIdentity(identityFor(studentSubject, `${studentSubject}@alu.uct.cl`));
  return await asStudent.mutation(api.presentation.requests.createRequest, {
    accessNeeds,
  });
}

/**
 * Cuenta acompañamientos abiertos desde la solicitud.
 *
 * Solo ayuda de prueba con datos mínimos: filtra en memoria porque el `ctx`
 * de convex-test no resuelve a nivel de tipos el índice `by_request` sobre
 * el campo opcional `requestId`. Lee como máximo dos filas (`take(2)` en vez
 * de `collect()`): basta para afirmar 0 o 1 y un duplicado se detecta como
 * distinto de lo esperado. La vía guardada de producción sí usa el índice
 * (`findAccompanimentByRequest` en Infraestructura).
 */
async function countAccompanimentsFor(t: ReturnType<typeof convexTest>, requestId: Id<"requests">) {
  return await t.run(async (ctx) => {
    return (
      await ctx.db
        .query("accompaniments")
        .filter((q) => q.eq(q.field("requestId"), requestId))
        .take(2)
    ).length;
  });
}

test("Profesional con toma acepta en revisión y abre un acompañamiento", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  await seedStudent(t, "ti24-est-1");
  const proId = await seedProfessional(t, "ti24-pro-1");

  // El Estudiante registra y el Profesional toma: queda en revisión
  const created = await registerOwnRequest(t, "ti24-est-1");
  const asProfessional = t.withIdentity(identityFor("ti24-pro-1", "ti24-pro-1@uct.cl"));
  await asProfessional.mutation(api.presentation.requests.takeRequest, {
    requestId: created._id as Id<"requests">,
  });

  // Aceptar abre el acompañamiento con vista completa para el Profesional
  const opened = await asProfessional.mutation(api.presentation.requests.acceptRequest, {
    requestId: created._id as Id<"requests">,
    objective: "Acompañar la organización del semestre",
  });
  expect(opened.view).toBe("full");
  expect(opened.status).toBe("active");
  expect(opened.objective).toBe("Acompañar la organización del semestre");
  expect(opened.accessNeeds).toBe("Necesidad de acceso ficticia");
  expect(opened.studentId).toBeDefined();

  // La solicitud queda aceptada y vinculada al acompañamiento resultante
  const accepted = await t.query(internal.operations.requests.getRequestById, {
    id: created._id as Id<"requests">,
  });
  expect(accepted?.status).toBe("accepted");
  const stored = await t.run(async (ctx) => {
    return await ctx.db.get(opened._id);
  });
  expect(stored?.requestId).toEqual(created._id);

  // El cambio queda registrado con actor y fecha
  const logged = await t.run(async (ctx) => {
    return await ctx.db
      .query("requestTransitions")
      .withIndex("by_request", (q) => q.eq("requestId", created._id as Id<"requests">))
      .collect();
  });
  const acceptance = logged.find((row) => row.to === "accepted");
  expect(acceptance?.from).toBe("under_review");
  expect(acceptance?.actorId).toEqual(proId);
  expect(acceptance?.occurredAt).toBeDefined();

  // El Profesional queda asignado como responsable inicial
  const assignment = await t.run(async (ctx) => {
    return await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
        q
          .eq("accompanimentId", opened._id)
          .eq("userId", proId)
          .eq("status", "active")
          .eq("assignedRole", "professional"),
      )
      .unique();
  });
  expect(assignment).not.toBeNull();
});

test("Acepta desde espera de información o aceptación", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  await seedStudent(t, "ti24-est-2");
  await seedProfessional(t, "ti24-pro-2");

  // Flujo público: registra, toma y pide información con motivo
  const created = await registerOwnRequest(t, "ti24-est-2");
  const asProfessional = t.withIdentity(identityFor("ti24-pro-2", "ti24-pro-2@uct.cl"));
  await asProfessional.mutation(api.presentation.requests.takeRequest, {
    requestId: created._id as Id<"requests">,
  });
  await asProfessional.mutation(api.presentation.requests.requestAdditionalInformation, {
    requestId: created._id as Id<"requests">,
    reason: "Falta el horario disponible",
  });

  // Aceptar desde la espera también abre exactamente un acompañamiento
  const opened = await asProfessional.mutation(api.presentation.requests.acceptRequest, {
    requestId: created._id as Id<"requests">,
    objective: "Acompañar la postulación a apoyos",
  });
  expect(opened.status).toBe("active");
  expect(await countAccompanimentsFor(t, created._id as Id<"requests">)).toBe(1);
});

test("Repetir la aceptación no crea duplicados", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  await seedStudent(t, "ti24-est-3");
  await seedProfessional(t, "ti24-pro-3");

  // Primera aceptación por la vía guardada
  const created = await registerOwnRequest(t, "ti24-est-3");
  const asProfessional = t.withIdentity(identityFor("ti24-pro-3", "ti24-pro-3@uct.cl"));
  await asProfessional.mutation(api.presentation.requests.takeRequest, {
    requestId: created._id as Id<"requests">,
  });
  await asProfessional.mutation(api.presentation.requests.acceptRequest, {
    requestId: created._id as Id<"requests">,
    objective: "Acompañar la organización del semestre",
  });

  // La repetición —igual que una segunda aceptación concurrente— se rechaza
  await expect(
    asProfessional.mutation(api.presentation.requests.acceptRequest, {
      requestId: created._id as Id<"requests">,
      objective: "Otro objetivo ficticio",
    }),
  ).rejects.toThrow("ya fue aceptada");
  expect(await countAccompanimentsFor(t, created._id as Id<"requests">)).toBe(1);
  const accepted = await t.query(internal.operations.requests.getRequestById, {
    id: created._id as Id<"requests">,
  });
  expect(accepted?.status).toBe("accepted");
});

test("Sin toma del Profesional se deniega sin modificar nada", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti24-est-4");
  const requestId = await t.mutation(internal.operations.requests.createTestRequest, {
    studentId,
    status: "under_review",
    accessNeeds: "Necesidad de acceso ficticia",
  });
  await seedProfessional(t, "ti24-pro-4");

  // Profesional vigente pero sin toma explícita: denegado sin cambios
  const asStranger = t.withIdentity(identityFor("ti24-pro-4", "ti24-pro-4@uct.cl"));
  await expect(
    asStranger.mutation(api.presentation.requests.acceptRequest, {
      requestId,
      objective: "Acompañar la organización del semestre",
    }),
  ).rejects.toThrow("No autorizado");
  const untouched = await t.query(internal.operations.requests.getRequestById, { id: requestId });
  expect(untouched?.status).toBe("under_review");
  expect(await countAccompanimentsFor(t, requestId)).toBe(0);
});

test("Estudiante o anónimo no aceptan solicitudes", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti24-est-5");
  const requestId = await t.mutation(internal.operations.requests.createTestRequest, {
    studentId,
    status: "under_review",
    accessNeeds: "Necesidad de acceso ficticia",
  });

  // Sin identidad no se acepta
  await expect(
    t.mutation(api.presentation.requests.acceptRequest, {
      requestId,
      objective: "Acompañar la organización del semestre",
    }),
  ).rejects.toThrow("No autorizado");

  // Un Estudiante no acepta solicitudes
  const asStudent = t.withIdentity(identityFor("ti24-est-5", "ti24-est-5@alu.uct.cl"));
  await expect(
    asStudent.mutation(api.presentation.requests.acceptRequest, {
      requestId,
      objective: "Acompañar la organización del semestre",
    }),
  ).rejects.toThrow("No autorizado");
  expect(await countAccompanimentsFor(t, requestId)).toBe(0);
});

test("Fuera de revisión no se acepta aunque exista toma", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti24-est-6");
  const requestId = await t.mutation(internal.operations.requests.createTestRequest, {
    studentId,
    status: "received",
    accessNeeds: "Necesidad de acceso ficticia",
  });
  const proId = await seedProfessional(t, "ti24-pro-6");

  // Toma manual sobre una recibida: la transición a aceptada no existe
  await t.run(async (ctx) => {
    return await ctx.db.insert("requestAssignments", {
      requestId,
      userId: proId,
      grantedBy: proId,
      grantedAt: 1,
      status: "active",
    });
  });
  const asProfessional = t.withIdentity(identityFor("ti24-pro-6", "ti24-pro-6@uct.cl"));
  await expect(
    asProfessional.mutation(api.presentation.requests.acceptRequest, {
      requestId,
      objective: "Acompañar la organización del semestre",
    }),
  ).rejects.toThrow("estado actual");
  const untouched = await t.query(internal.operations.requests.getRequestById, { id: requestId });
  expect(untouched?.status).toBe("received");
  expect(await countAccompanimentsFor(t, requestId)).toBe(0);
});

test("Sin objetivo se rechaza sin modificar nada", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  await seedStudent(t, "ti24-est-7");
  await seedProfessional(t, "ti24-pro-7");

  // En revisión con toma: el objetivo vacío indica qué corregir
  const created = await registerOwnRequest(t, "ti24-est-7");
  const asProfessional = t.withIdentity(identityFor("ti24-pro-7", "ti24-pro-7@uct.cl"));
  await asProfessional.mutation(api.presentation.requests.takeRequest, {
    requestId: created._id as Id<"requests">,
  });
  await expect(
    asProfessional.mutation(api.presentation.requests.acceptRequest, {
      requestId: created._id as Id<"requests">,
      objective: "  ",
    }),
  ).rejects.toThrow("objetivo");
  const untouched = await t.query(internal.operations.requests.getRequestById, {
    id: created._id as Id<"requests">,
  });
  expect(untouched?.status).toBe("under_review");
  expect(await countAccompanimentsFor(t, created._id as Id<"requests">)).toBe(0);
});

test("Dos profesionales en contienda abren un solo acompañamiento", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  await seedStudent(t, "ti27-est-1");
  await seedProfessional(t, "ti27-pro-1");

  // Solicitud en revisión con toma del primer profesional por la vía pública
  const created = await registerOwnRequest(t, "ti27-est-1");
  const first = t.withIdentity(identityFor("ti27-pro-1", "ti27-pro-1@uct.cl"));
  const secondId = await seedProfessional(t, "ti27-pro-2");
  const second = t.withIdentity(identityFor("ti27-pro-2", "ti27-pro-2@uct.cl"));
  await first.mutation(api.presentation.requests.takeRequest, {
    requestId: created._id as Id<"requests">,
  });

  // Segunda toma coexistente sembrada a mano: por la vía pública no coexisten
  // en secuencia (la segunda toma se rechaza porque la solicitud ya salió de
  // `received`), pero filas así existen vía escrituras legacy o tomas
  // concurrentes en un backend en vivo, que los listados ya toleran
  await t.run(async (ctx) => {
    await ctx.db.insert("requestAssignments", {
      requestId: created._id as Id<"requests">,
      userId: secondId,
      grantedBy: secondId,
      grantedAt: 1,
      status: "active",
    });
  });

  // La primera aceptación abre el acompañamiento
  const opened = await first.mutation(api.presentation.requests.acceptRequest, {
    requestId: created._id as Id<"requests">,
    objective: "Acompañar la organización del semestre",
  });
  expect(opened.status).toBe("active");

  // La segunda, aunque tiene toma activa, se rechaza sin duplicar. Nota:
  // convex-test@0.0.58 ejecuta en secuencia las transacciones de nivel
  // superior (TransactionManager toma un lock por transacción), así que esta
  // prueba fija el rechazo entre actores en contienda en secuencia, no
  // transacciones solapadas; el solapamiento real solo se verifica contra un
  // backend en vivo.
  await expect(
    second.mutation(api.presentation.requests.acceptRequest, {
      requestId: created._id as Id<"requests">,
      objective: "Otro objetivo ficticio",
    }),
  ).rejects.toThrow("ya fue aceptada");
  expect(await countAccompanimentsFor(t, created._id as Id<"requests">)).toBe(1);
  const accepted = await t.query(internal.operations.requests.getRequestById, {
    id: created._id as Id<"requests">,
  });
  expect(accepted?.status).toBe("accepted");
});

test("Estudiante y Profesional consultan el acompañamiento resultante", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  await seedStudent(t, "ti24-est-8");
  await seedProfessional(t, "ti24-pro-8");

  // Aceptación por la vía guardada
  const created = await registerOwnRequest(t, "ti24-est-8");
  const asProfessional = t.withIdentity(identityFor("ti24-pro-8", "ti24-pro-8@uct.cl"));
  await asProfessional.mutation(api.presentation.requests.takeRequest, {
    requestId: created._id as Id<"requests">,
  });
  const opened = await asProfessional.mutation(api.presentation.requests.acceptRequest, {
    requestId: created._id as Id<"requests">,
    objective: "Acompañar la organización del semestre",
  });

  // El Estudiante dueño lo ve completo y el Profesional asignado también
  const asStudent = t.withIdentity(identityFor("ti24-est-8", "ti24-est-8@alu.uct.cl"));
  const studentView = await asStudent.query(api.presentation.accompaniments.getAccompaniment, {
    accompanimentId: opened._id,
  });
  expect(studentView.view).toBe("full");
  const professionalView = await asProfessional.query(
    api.presentation.accompaniments.getAccompaniment,
    { accompanimentId: opened._id },
  );
  expect(professionalView.view).toBe("full");
});

test("Dos intentos sobre el mismo cupo crean como máximo una atención (TI2-84)", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentA = await seedStudent(t, "ti84-est-a");
  const studentB = await seedStudent(t, "ti84-est-b");
  const pro = await seedProfessional(t, "ti84-pro-1");
  const accompanimentA = await seedAccompaniment(t, studentA);
  const accompanimentB = await seedAccompaniment(t, studentB);

  // Primer intento: ocupa el cupo en la misma transacción que crea la atención
  const first = await t.run(async (ctx) => {
    return await occupySlotAtomically(ctx, {
      accompanimentId: accompanimentA,
      studentId: studentA,
      professionalId: pro,
      modality: "online",
      startsAt: TI84_SLOT_START,
      endsAt: TI84_SLOT_END,
    });
  });
  if (!isOkResult(first)) throw new Error("Se esperaba ocupación del cupo");
  expect(Object.keys(first).sort()).toEqual(["data", "status"]);

  // Segundo intento sobre el mismo profesional e inicio: se rechaza con el
  // código estable de conflicto, distinto de la ausencia de cupo en búsqueda.
  // Nota: convex-test@0.0.58 ejecuta en secuencia las transacciones de nivel
  // superior (TransactionManager toma un lock por transacción), así que esta
  // prueba fija el rechazo entre intentos en contienda en secuencia, no
  // transacciones solapadas; el solapamiento real (contienda OCC) solo se
  // verifica contra un backend en vivo con datos ficticios.
  const second = await t.run(async (ctx) => {
    return await occupySlotAtomically(ctx, {
      accompanimentId: accompanimentB,
      studentId: studentB,
      professionalId: pro,
      modality: "online",
      startsAt: TI84_SLOT_START,
      endsAt: TI84_SLOT_END,
    });
  });
  if (!isErrorResult(second)) throw new Error("Se esperaba rechazo por contienda");
  expect(Object.keys(second).sort()).toEqual(["error", "status"]);
  expect(Object.keys(second.error).sort()).toEqual(["code", "message"]);
  expect(second.error.code).toBe(CONFLICT_ERROR_CODE);
  expect(second.error.code).not.toBe(NO_AVAILABILITY_ERROR_CODE);

  // Una sola atención en el cupo, la del primer intento
  const agenda = await t.run(async (ctx) => {
    return await ctx.db
      .query("appointments")
      .withIndex("by_professionalId_and_startsAt", (q) =>
        q.eq("professionalId", pro).eq("startsAt", TI84_SLOT_START),
      )
      .take(10);
  });
  expect(agenda.map((row) => row._id)).toEqual([first.data.appointmentId]);

  // Ausencia de escrituras parciales: el segundo estudiante no tiene atenciones
  const foreign = await t.run(async (ctx) => {
    return await ctx.db
      .query("appointments")
      .withIndex("by_studentId", (q) => q.eq("studentId", studentB))
      .take(10);
  });
  expect(foreign).toHaveLength(0);

  // El rechazo preserva el estado: la primera atención sigue intacta
  const stored = await t.run(async (ctx) => {
    return await ctx.db.get(first.data.appointmentId);
  });
  expect(stored?.status).toBe("scheduled");
  expect(stored?.startsAt).toBe(TI84_SLOT_START);
  expect(stored?.endsAt).toBe(TI84_SLOT_END);
  expect(stored?.professionalId).toEqual(pro);
});

test("El cupo con intervalo invertido se rechaza sin persistir (TI2-84)", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const student = await seedStudent(t, "ti84-est-c");
  const pro = await seedProfessional(t, "ti84-pro-2");
  const accompaniment = await seedAccompaniment(t, student);

  // El servidor no confía en el cliente: el fin anterior al inicio es un
  // error operativo que indica qué corregir, sin guardar nada.
  await expect(
    t.run(async (ctx) => {
      return await occupySlotAtomically(ctx, {
        accompanimentId: accompaniment,
        studentId: student,
        professionalId: pro,
        modality: "online",
        startsAt: TI84_SLOT_END,
        endsAt: TI84_SLOT_START,
      });
    }),
  ).rejects.toThrow("posterior");
  const agenda = await t.run(async (ctx) => {
    return await ctx.db
      .query("appointments")
      .withIndex("by_professionalId", (q) => q.eq("professionalId", pro))
      .take(10);
  });
  expect(agenda).toHaveLength(0);
});

test("El cupo liberado por cancelación se puede volver a ocupar (TI2-84)", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const student = await seedStudent(t, "ti84-est-d");
  const pro = await seedProfessional(t, "ti84-pro-3");
  const accompaniment = await seedAccompaniment(t, student);

  // Atención cancelada por el estudiante: libera el cupo
  await t.run(async (ctx) => {
    return await ctx.db.insert("appointments", {
      accompanimentId: accompaniment,
      studentId: student,
      professionalId: pro,
      modality: "online",
      status: "cancelled_by_student",
      startsAt: TI84_SLOT_START,
      endsAt: TI84_SLOT_END,
      createdAt: 1,
    });
  });

  // La ocupación posterior del mismo cupo crea la atención en `scheduled`
  const retry = await t.run(async (ctx) => {
    return await occupySlotAtomically(ctx, {
      accompanimentId: accompaniment,
      studentId: student,
      professionalId: pro,
      modality: "online",
      startsAt: TI84_SLOT_START,
      endsAt: TI84_SLOT_END,
    });
  });
  if (!isOkResult(retry)) throw new Error("Se esperaba ocupación del cupo liberado");
  const stored = await t.run(async (ctx) => {
    return await ctx.db.get(retry.data.appointmentId);
  });
  expect(stored?.status).toBe("scheduled");
});

test("Diez ciclos de reserva y cancelación no ocultan la atención activa (TI2-84)", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const student = await seedStudent(t, "ti84-est-e");
  const pro = await seedProfessional(t, "ti84-pro-4");
  const accompaniment = await seedAccompaniment(t, student);
  const slot = {
    accompanimentId: accompaniment,
    studentId: student,
    professionalId: pro,
    modality: "online" as const,
    startsAt: TI84_SLOT_START,
    endsAt: TI84_SLOT_END,
  };

  // Historial de diez ciclos de reserva y cancelación en el mismo cupo
  for (let cycle = 0; cycle < 10; cycle += 1) {
    await t.run(async (ctx) => {
      await ctx.db.insert("appointments", {
        ...slot,
        status: "cancelled_by_student",
        createdAt: 1,
      });
    });
  }

  // El cupo sigue libre: la ocupación crea la atención activa posterior
  const first = await t.run(async (ctx) => {
    return await occupySlotAtomically(ctx, slot);
  });
  if (!isOkResult(first)) throw new Error("Se esperaba ocupación del cupo");

  // El intento siguiente ve la atención activa tras el historial y se rechaza
  const second = await t.run(async (ctx) => {
    return await occupySlotAtomically(ctx, slot);
  });
  if (!isErrorResult(second)) throw new Error("Se esperaba rechazo por contienda");
  expect(second.error.code).toBe(CONFLICT_ERROR_CODE);

  // Se conserva la atención existente y no se escribe otra
  const active = await t.run(async (ctx) => {
    return await ctx.db
      .query("appointments")
      .withIndex("by_professionalId_and_startsAt", (q) =>
        q.eq("professionalId", pro).eq("startsAt", TI84_SLOT_START),
      )
      .take(20);
  });
  expect(active.filter((row) => row.status === "scheduled").map((row) => row._id)).toEqual([
    first.data.appointmentId,
  ]);
});

test("Un historial largo no oculta la atención activa (TI2-84)", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const student = await seedStudent(t, "ti84-est-f");
  const pro = await seedProfessional(t, "ti84-pro-5");
  const accompaniment = await seedAccompaniment(t, student);
  const slot = {
    accompanimentId: accompaniment,
    studentId: student,
    professionalId: pro,
    modality: "online" as const,
    startsAt: TI84_SLOT_START,
    endsAt: TI84_SLOT_END,
  };

  // Historial con 55 cancelaciones en el mismo instante: caben bajo el tope de
  // la ventana de TI2-96, que con más filas falla cerrado en vez de cortar
  await t.run(async (ctx) => {
    for (let cycle = 0; cycle < 55; cycle += 1) {
      await ctx.db.insert("appointments", {
        ...slot,
        status: "cancelled_by_student",
        createdAt: 1,
      });
    }
  });

  // La ocupación crea la atención activa posterior al historial
  const first = await t.run(async (ctx) => {
    return await occupySlotAtomically(ctx, slot);
  });
  if (!isOkResult(first)) throw new Error("Se esperaba ocupación del cupo");

  // La ventana leída entera encuentra la atención activa detrás del historial
  const second = await t.run(async (ctx) => {
    return await occupySlotAtomically(ctx, slot);
  });
  if (!isErrorResult(second)) throw new Error("Se esperaba rechazo por contienda");
  expect(second.error.code).toBe(CONFLICT_ERROR_CODE);
});

test("Dos cupos distintos del mismo profesional se ocupan sin conflicto (TI2-84)", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const student = await seedStudent(t, "ti84-est-g");
  const pro = await seedProfessional(t, "ti84-pro-6");
  const accompaniment = await seedAccompaniment(t, student);

  // Intervalos contiguos `[inicio, fin)`: el fin de uno es el inicio del
  // siguiente y no se cruzan, ni para el profesional ni para el estudiante
  for (const startsAt of [TI84_SLOT_START, TI84_SLOT_END]) {
    const occupied = await t.run(async (ctx) => {
      return await occupySlotAtomically(ctx, {
        accompanimentId: accompaniment,
        studentId: student,
        professionalId: pro,
        modality: "online",
        startsAt,
        endsAt: startsAt + 3_600_000,
      });
    });
    if (!isOkResult(occupied)) throw new Error("Se esperaba ocupación del cupo libre");
  }
  const agenda = await t.run(async (ctx) => {
    return await ctx.db
      .query("appointments")
      .withIndex("by_professionalId", (q) => q.eq("professionalId", pro))
      .take(10);
  });
  expect(agenda).toHaveLength(2);
});

/*
 * TI2-85: cancelar y cerrar sin acompañamiento no tienen entrada pública
 * todavía; se invocan dentro de `t.run` con la identidad ya resuelta.
 */

test("TI2-85: cerrar o cancelar no abre acompañamiento y la aceptación posterior se rechaza", async () => {
  const t = convexTest(schema, modules);
  await seedStudent(t, "ti85-acc-est-1");
  await seedProfessional(t, "ti85-acc-pro-1");
  const asProfessional = t.withIdentity(identityFor("ti85-acc-pro-1", "ti85-acc-pro-1@uct.cl"));
  const student = identityFor("ti85-acc-est-1", "ti85-acc-est-1@alu.uct.cl");
  const professional = identityFor("ti85-acc-pro-1", "ti85-acc-pro-1@uct.cl");

  // Cerrada por el Profesional con toma, cancelada por el Estudiante en revisión
  const closedId = (await registerOwnRequest(t, "ti85-acc-est-1"))._id as Id<"requests">;
  await asProfessional.mutation(api.presentation.requests.takeRequest, { requestId: closedId });
  await t.run((ctx) =>
    closeRequestWithoutAccompaniment(ctx, professional, {
      requestId: closedId,
      reason: "La necesidad corresponde a otra unidad",
    }),
  );
  const cancelledId = (await registerOwnRequest(t, "ti85-acc-est-1"))._id as Id<"requests">;
  await asProfessional.mutation(api.presentation.requests.takeRequest, { requestId: cancelledId });
  await t.run((ctx) =>
    cancelRequest(ctx, student, { requestId: cancelledId, reason: "Ya no necesito el apoyo" }),
  );

  // Ninguna abre acompañamiento y la toma vigente no permite aceptarlas después
  for (const requestId of [closedId, cancelledId]) {
    expect(await countAccompanimentsFor(t, requestId)).toBe(0);
    await expect(
      asProfessional.mutation(api.presentation.requests.acceptRequest, {
        requestId,
        objective: "Objetivo ficticio",
      }),
    ).rejects.toThrow("La solicitud no admite la aceptación en su estado actual");
    expect(await countAccompanimentsFor(t, requestId)).toBe(0);
  }
});

test("TI2-85: una solicitud aceptada conserva exactamente un acompañamiento ante cancelar o cerrar", async () => {
  const t = convexTest(schema, modules);
  await seedStudent(t, "ti85-acc-est-2");
  await seedProfessional(t, "ti85-acc-pro-2");
  const asProfessional = t.withIdentity(identityFor("ti85-acc-pro-2", "ti85-acc-pro-2@uct.cl"));
  const requestId = (await registerOwnRequest(t, "ti85-acc-est-2"))._id as Id<"requests">;
  await asProfessional.mutation(api.presentation.requests.takeRequest, { requestId });
  await asProfessional.mutation(api.presentation.requests.acceptRequest, {
    requestId,
    objective: "Acompañar la organización del semestre",
  });

  await expect(
    t.run((ctx) =>
      cancelRequest(ctx, identityFor("ti85-acc-est-2", "ti85-acc-est-2@alu.uct.cl"), {
        requestId,
        reason: "Motivo ficticio",
      }),
    ),
  ).rejects.toThrow("no admite la cancelación");
  await expect(
    t.run((ctx) =>
      closeRequestWithoutAccompaniment(
        ctx,
        identityFor("ti85-acc-pro-2", "ti85-acc-pro-2@uct.cl"),
        { requestId, reason: "Motivo ficticio" },
      ),
    ),
  ).rejects.toThrow("no admite el cierre");

  const stored = await t.query(internal.operations.requests.getRequestById, { id: requestId });
  expect(stored?.status).toBe("accepted");
  expect(await countAccompanimentsFor(t, requestId)).toBe(1);
});

/*
 * TI2-96: cruces de estudiante, profesional y sala al ocupar un cupo. Los
 * intervalos son `[inicio, fin)` y se escriben en minutos desde las 09:00 del
 * cupo de TI2-84.
 */

const TI96_MINUTE = 60_000;

/** Instante a `minutes` minutos de las 09:00 del lunes 2026-10-12 UTC. */
function ti96At(minutes: number): number {
  return TI84_SLOT_START + minutes * TI96_MINUTE;
}

/** Estudiante ficticio con su acompañamiento, listo para ocupar cupos. */
async function seedTi96Student(t: ReturnType<typeof convexTest>, subject: string) {
  const studentId = await seedStudent(t, subject);
  return { studentId, accompanimentId: await seedAccompaniment(t, studentId) };
}

/** Sala ficticia vigente. */
async function seedTi96Space(t: ReturnType<typeof convexTest>, room: string) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("spaces", {
      campus: "Norte",
      building: "C",
      floor: "2",
      room,
      accessConditions: "Condición de acceso ficticia",
      accessInstructions: "Instrucción de llegada ficticia",
      isActive: true,
    });
  });
}

/** Ocupa de `from` a `to` minutos: presencial si trae sala, en línea si no. */
async function occupyTi96(
  t: ReturnType<typeof convexTest>,
  who: { studentId: Id<"users">; accompanimentId: Id<"accompaniments"> },
  professionalId: Id<"users">,
  from: number,
  to: number,
  spaceId?: Id<"spaces">,
  movedAppointmentId?: Id<"appointments">,
) {
  const input: OccupySlotRow = {
    ...who,
    professionalId,
    modality: spaceId === undefined ? "online" : "inPerson",
    ...(spaceId === undefined ? {} : { spaceId }),
    startsAt: ti96At(from),
    endsAt: ti96At(to),
    ...(movedAppointmentId === undefined ? {} : { movedAppointmentId }),
  };
  return await t.run(async (ctx) => await occupySlotAtomically(ctx, input));
}

/** Cambia la atención `moved` al destino indicado, con la misma regla de sala. */
async function moveTi96(
  t: ReturnType<typeof convexTest>,
  moved: Id<"appointments">,
  who: { studentId: Id<"users">; accompanimentId: Id<"accompaniments"> },
  professionalId: Id<"users">,
  from: number,
  to: number,
  spaceId?: Id<"spaces">,
) {
  return await occupyTi96(t, who, professionalId, from, to, spaceId, moved);
}

/** La atención guardada, para comparar el origen antes y después. */
async function getTi96(t: ReturnType<typeof convexTest>, id: Id<"appointments">) {
  return await t.run(async (ctx) => await ctx.db.get(id));
}

/** `ok` o el código estable del error. */
function ti96Code(result: Awaited<ReturnType<typeof occupyTi96>>): string {
  return isOkResult(result) ? "ok" : result.error.code;
}

/** Todas las atenciones guardadas, para afirmar que un rechazo no escribe. */
async function listTi96Appointments(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => await ctx.db.query("appointments").take(500));
}

test("TI2-96: el profesional no se cruza con otra atención y lo contiguo no choca", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedProfessional(t, "ti96-pro-1");
  const first = await seedTi96Student(t, "ti96-est-1");
  const other = await seedTi96Student(t, "ti96-est-2");

  expect(ti96Code(await occupyTi96(t, first, pro, 0, 60))).toBe("ok");
  const before = await listTi96Appointments(t);

  // Empieza adentro, termina adentro, la envuelve o queda dentro: se cruza.
  for (const [from, to] of [
    [30, 90],
    [-30, 30],
    [-60, 120],
    [15, 45],
  ] as const) {
    expect(ti96Code(await occupyTi96(t, other, pro, from, to))).toBe(CONFLICT_ERROR_CODE);
  }
  // Los rechazos no escriben ni tocan la atención que ya estaba.
  expect(await listTi96Appointments(t)).toEqual(before);

  // Contiguas por ambos lados: el fin es exclusivo y el borde no choca.
  expect(ti96Code(await occupyTi96(t, other, pro, 60, 120))).toBe("ok");
  expect(ti96Code(await occupyTi96(t, other, pro, -60, 0))).toBe("ok");
  expect(await listTi96Appointments(t)).toHaveLength(3);
});

test("TI2-96: el estudiante no se cruza consigo mismo aunque cambie de profesional", async () => {
  const t = convexTest(schema, modules);
  const proA = await seedProfessional(t, "ti96-pro-2");
  const proB = await seedProfessional(t, "ti96-pro-3");
  const student = await seedTi96Student(t, "ti96-est-3");
  const second = await seedTi96Student(t, "ti96-est-4");

  expect(ti96Code(await occupyTi96(t, student, proA, 0, 60))).toBe("ok");
  // Otro profesional libre, mismo estudiante: el cruce es del estudiante.
  expect(ti96Code(await occupyTi96(t, student, proB, 30, 90))).toBe(CONFLICT_ERROR_CODE);
  // Otro acompañamiento del mismo estudiante tampoco lo libera.
  const otherAccompaniment = await seedAccompaniment(t, student.studentId);
  expect(
    ti96Code(
      await occupyTi96(t, { ...student, accompanimentId: otherAccompaniment }, proB, 30, 90),
    ),
  ).toBe(CONFLICT_ERROR_CODE);

  // Profesionales distintos con estudiantes distintos atienden a la vez, y el
  // estudiante sigue en el borde con el otro profesional.
  expect(ti96Code(await occupyTi96(t, second, proB, 0, 60))).toBe("ok");
  expect(ti96Code(await occupyTi96(t, student, proB, 60, 120))).toBe("ok");
  expect(await listTi96Appointments(t)).toHaveLength(3);
});

test("TI2-96: la sala no se cruza entre profesionales y una atención en línea no usa sala", async () => {
  const t = convexTest(schema, modules);
  const [proA, proB, proC, proD] = [
    await seedProfessional(t, "ti96-pro-4"),
    await seedProfessional(t, "ti96-pro-5"),
    await seedProfessional(t, "ti96-pro-6"),
    await seedProfessional(t, "ti96-pro-7"),
  ];
  const [studentA, studentB, studentC, studentD] = [
    await seedTi96Student(t, "ti96-est-5"),
    await seedTi96Student(t, "ti96-est-6"),
    await seedTi96Student(t, "ti96-est-7"),
    await seedTi96Student(t, "ti96-est-8"),
  ];
  const roomA = await seedTi96Space(t, "C-201");
  const roomB = await seedTi96Space(t, "C-202");

  expect(ti96Code(await occupyTi96(t, studentA, proA, 0, 60, roomA))).toBe("ok");
  // Otro profesional y otro estudiante, ambos libres: el cruce es de la sala.
  expect(ti96Code(await occupyTi96(t, studentB, proB, 30, 90, roomA))).toBe(CONFLICT_ERROR_CODE);
  // La sala de al lado está libre, y la misma sala queda libre desde el fin.
  expect(ti96Code(await occupyTi96(t, studentB, proB, 30, 90, roomB))).toBe("ok");
  expect(ti96Code(await occupyTi96(t, studentC, proC, 60, 120, roomA))).toBe("ok");

  // En línea, a la misma hora que la sala ocupada: se guarda sin sala.
  const online = await occupyTi96(t, studentD, proD, 0, 60);
  if (!isOkResult(online)) throw new Error("Se esperaba ocupación en línea");
  const stored = await t.run(async (ctx) => await ctx.db.get(online.data.appointmentId));
  expect(stored?.modality).toBe("online");
  expect(stored?.spaceId).toBeUndefined();
  expect(await listTi96Appointments(t)).toHaveLength(4);
});

test("TI2-96: solo las cancelaciones liberan el intervalo", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedProfessional(t, "ti96-pro-8");
  const holder = await seedTi96Student(t, "ti96-est-9");
  const other = await seedTi96Student(t, "ti96-est-10");

  // Un estado por día, separados más que la ventana de lectura.
  for (const [index, status] of APPOINTMENT_STATUS_VALUES.entries()) {
    const day = index * 3 * 1440;
    await t.run(async (ctx) => {
      await ctx.db.insert("appointments", {
        ...holder,
        professionalId: pro,
        modality: "online",
        status,
        startsAt: ti96At(day + 30),
        endsAt: ti96At(day + 90),
        createdAt: 1,
      });
    });
    const code = ti96Code(await occupyTi96(t, other, pro, day, day + 60));
    // El estado va en la comparación para que una falla diga cuál fue.
    expect({ status, code }).toEqual({
      status,
      code: status.startsWith("cancelled_") ? "ok" : CONFLICT_ERROR_CODE,
    });
  }
});

test("TI2-96: la duración máxima acota la lectura sin perder cruces", async () => {
  const t = convexTest(schema, modules);
  const proLong = await seedProfessional(t, "ti96-pro-9");
  const proEdge = await seedProfessional(t, "ti96-pro-10");
  const holder = await seedTi96Student(t, "ti96-est-11");
  const edge = await seedTi96Student(t, "ti96-est-12");
  const other = await seedTi96Student(t, "ti96-est-13");
  const day = MAX_APPOINTMENT_MS / TI96_MINUTE;

  // Una atención de 1440 minutos se acepta; un minuto más es un error que no guarda.
  expect(ti96Code(await occupyTi96(t, holder, proLong, 1 - day, 1))).toBe("ok");
  await expect(occupyTi96(t, other, proEdge, 0, day + 1)).rejects.toThrow("1440");
  expect(await listTi96Appointments(t)).toHaveLength(1);

  // La más larga posible, empezada casi un día antes, todavía se cruza.
  expect(ti96Code(await occupyTi96(t, other, proLong, 0, 60))).toBe(CONFLICT_ERROR_CODE);
  // La que dura un día y termina justo al inicio es contigua.
  expect(ti96Code(await occupyTi96(t, edge, proEdge, -day, 0))).toBe("ok");
  expect(ti96Code(await occupyTi96(t, other, proEdge, 0, 60))).toBe("ok");
});

test("TI2-96: con más filas que el tope en la ventana la ocupación falla cerrada", async () => {
  const t = convexTest(schema, modules);
  const proAtCap = await seedProfessional(t, "ti96-pro-11");
  const proOverCap = await seedProfessional(t, "ti96-pro-12");
  const holder = await seedTi96Student(t, "ti96-est-14");
  const first = await seedTi96Student(t, "ti96-est-15");
  const second = await seedTi96Student(t, "ti96-est-16");

  // Cancelaciones dentro de la ventana: el índice las lee aunque no ocupen.
  await t.run(async (ctx) => {
    for (const [pro, count] of [
      [proAtCap, MAX_APPOINTMENTS_IN_WINDOW],
      [proOverCap, MAX_APPOINTMENTS_IN_WINDOW + 1],
    ] as const) {
      for (let index = 0; index < count; index += 1) {
        await ctx.db.insert("appointments", {
          ...holder,
          professionalId: pro,
          modality: "online",
          status: "cancelled_by_cereti",
          startsAt: ti96At(index - 600),
          endsAt: ti96At(index - 590),
          createdAt: 1,
        });
      }
    }
  });

  // En el tope todavía se lee la ventana completa, y está libre.
  expect(ti96Code(await occupyTi96(t, first, proAtCap, 0, 60))).toBe("ok");
  // Una fila más y ya no se puede decidir: rechaza sin escribir.
  const before = await listTi96Appointments(t);
  expect(ti96Code(await occupyTi96(t, second, proOverCap, 0, 60))).toBe(CONFLICT_ERROR_CODE);
  expect(await listTi96Appointments(t)).toEqual(before);
});

test("TI2-96: cada recurso aplica los mismos bordes, la misma ventana y el mismo tope", async () => {
  for (const shared of ["professional", "student", "space"] as const) {
    const t = convexTest(schema, modules);
    const [proA, proB, proC] = [
      await seedProfessional(t, `ti96-${shared}-pro-a`),
      await seedProfessional(t, `ti96-${shared}-pro-b`),
      await seedProfessional(t, `ti96-${shared}-pro-c`),
    ];
    const [studentA, studentB, studentC] = [
      await seedTi96Student(t, `ti96-${shared}-est-a`),
      await seedTi96Student(t, `ti96-${shared}-est-b`),
      await seedTi96Student(t, `ti96-${shared}-est-c`),
    ];
    const room = await seedTi96Space(t, `C-${shared}`);
    // Ocupante, contendiente e historial comparten solo el recurso probado, así
    // cada conflicto viene de esa rama de la consulta y no de otra.
    const parties = {
      professional: [
        [studentA, proA, undefined],
        [studentB, proA, undefined],
        [studentC, proA, undefined],
      ],
      student: [
        [studentA, proA, undefined],
        [studentA, proB, undefined],
        [studentA, proC, undefined],
      ],
      space: [
        [studentA, proA, room],
        [studentB, proB, room],
        [studentC, proC, room],
      ],
    } as const;
    const [occupant, contender, history] = parties[shared];
    const occupy = (who: typeof occupant | typeof contender, from: number, to: number) =>
      occupyTi96(t, who[0], who[1], from, to, who[2]);
    // El rechazo es el mismo para los tres recursos: no dice cuál ni de quién.
    const rejected = errResult(conflictError());

    // Bordes: se cruza por dentro y no choca por ninguno de los dos lados.
    expect(ti96Code(await occupy(occupant, 0, 60))).toBe("ok");
    expect(await occupy(contender, 30, 90)).toEqual(rejected);
    expect(ti96Code(await occupy(contender, -60, 0))).toBe("ok");
    expect(ti96Code(await occupy(contender, 60, 120))).toBe("ok");

    // Ventana: la atención más larga, empezada casi un día antes, se ve.
    expect(ti96Code(await occupy(occupant, 3001 - 1440, 3001))).toBe("ok");
    expect(await occupy(contender, 3000, 3060)).toEqual(rejected);

    // Tope: con 200 filas en la ventana se decide; con una más, falla cerrado.
    await t.run(async (ctx) => {
      for (let index = 0; index < MAX_APPOINTMENTS_IN_WINDOW; index += 1) {
        await ctx.db.insert("appointments", {
          ...history[0],
          professionalId: history[1],
          modality: history[2] === undefined ? "online" : "inPerson",
          ...(history[2] === undefined ? {} : { spaceId: history[2] }),
          status: "cancelled_by_student",
          startsAt: ti96At(9400 + index),
          endsAt: ti96At(9410 + index),
          createdAt: 1,
        });
      }
    });
    expect(ti96Code(await occupy(contender, 10000, 10060))).toBe("ok");
    expect(await occupy(occupant, 10060, 10120)).toEqual(rejected);
  }
});

test("TI2-96: cambiar una atención solo descuenta sus propios cruces", async () => {
  const t = convexTest(schema, modules);
  const proA = await seedProfessional(t, "ti96-mov-pro-a");
  const proB = await seedProfessional(t, "ti96-mov-pro-b");
  const student = await seedTi96Student(t, "ti96-mov-est-1");
  const other = await seedTi96Student(t, "ti96-mov-est-2");
  const first = await occupyTi96(t, student, proA, 0, 60);
  const second = await occupyTi96(t, student, proA, 120, 180);
  if (!isOkResult(first) || !isOkResult(second)) throw new Error("Se esperaba ocupar ambos cupos");
  const moved = first.data.appointmentId;

  // Se cruza solo consigo misma: cambia en el mismo lugar, con el mismo id.
  expect(await moveTi96(t, moved, student, proA, 30, 90)).toEqual(
    okResult({ appointmentId: moved }),
  );
  // El cambio no la marca como reagendada: el estado y la fecha original son de TI2-109.
  const shifted = await getTi96(t, moved);
  expect(shifted).toMatchObject({
    status: "scheduled",
    startsAt: ti96At(30),
    endsAt: ti96At(90),
  });
  expect(shifted?.originalStartsAt).toBeUndefined();
  // La otra atención del mismo estudiante y profesional sí cuenta.
  expect(await moveTi96(t, moved, student, proA, 100, 150)).toEqual(errResult(conflictError()));
  expect(await getTi96(t, moved)).toMatchObject({ startsAt: ti96At(30), endsAt: ti96At(90) });

  // Cambiar de profesional libera al anterior en ese horario.
  expect(ti96Code(await moveTi96(t, moved, student, proB, 30, 90))).toBe("ok");
  expect(await getTi96(t, moved)).toMatchObject({ professionalId: proB });
  // Con proB libre, el destino choca solo con el estudiante (su atención con proA).
  expect(await moveTi96(t, moved, student, proB, 150, 200)).toEqual(errResult(conflictError()));
  expect(await getTi96(t, moved)).toMatchObject({
    professionalId: proB,
    startsAt: ti96At(30),
    endsAt: ti96At(90),
  });
  expect(ti96Code(await occupyTi96(t, other, proA, 30, 90))).toBe("ok");
  // Cambiar no crea filas: dos del estudiante y una del otro.
  expect(await listTi96Appointments(t)).toHaveLength(3);
});

test("TI2-96: un destino ocupado conserva íntegro el origen y el cambio no toca el estado", async () => {
  const t = convexTest(schema, modules);
  const proA = await seedProfessional(t, "ti96-mov-pro-c");
  const proB = await seedProfessional(t, "ti96-mov-pro-d");
  const student = await seedTi96Student(t, "ti96-mov-est-3");
  const other = await seedTi96Student(t, "ti96-mov-est-4");
  const roomA = await seedTi96Space(t, "C-301");
  const roomB = await seedTi96Space(t, "C-302");
  // Atención ya reagendada una vez: su estado y su fecha original no son de esta operación.
  const moved = await t.run(async (ctx) => {
    return await ctx.db.insert("appointments", {
      ...student,
      professionalId: proA,
      spaceId: roomA,
      modality: "inPerson",
      status: "rescheduled",
      startsAt: ti96At(0),
      endsAt: ti96At(60),
      originalStartsAt: ti96At(-1440),
      createdAt: 7,
    });
  });
  expect(ti96Code(await occupyTi96(t, other, proB, 120, 180, roomB))).toBe("ok");
  const before = await listTi96Appointments(t);

  // La sala de destino está ocupada por otra atención: no cambia nada.
  expect(await moveTi96(t, moved, student, proA, 150, 210, roomB)).toEqual(
    errResult(conflictError()),
  );
  // En línea y con el estudiante libre, choca solo con el profesional de destino.
  expect(await moveTi96(t, moved, student, proB, 150, 210)).toEqual(errResult(conflictError()));
  expect(await listTi96Appointments(t)).toEqual(before);

  // En su propia sala se cruza solo consigo misma.
  expect(ti96Code(await moveTi96(t, moved, student, proA, 30, 90, roomA))).toBe("ok");
  // A una hora libre en línea: cambian horario, modalidad y sala; lo demás se conserva.
  expect(ti96Code(await moveTi96(t, moved, student, proA, 200, 260))).toBe("ok");
  const after = await getTi96(t, moved);
  expect(after).toMatchObject({
    status: "rescheduled",
    originalStartsAt: ti96At(-1440),
    createdAt: 7,
    modality: "online",
    startsAt: ti96At(200),
    endsAt: ti96At(260),
  });
  expect(after?.spaceId).toBeUndefined();
  // La sala de origen quedó libre en su horario.
  expect(ti96Code(await occupyTi96(t, other, proB, 0, 60, roomA))).toBe("ok");

  // Cambiar solo de sala, en el mismo horario: ocupa la nueva y suelta la anterior.
  const roomMove = await occupyTi96(t, student, proA, 500, 560, roomA);
  if (!isOkResult(roomMove)) throw new Error("Se esperaba ocupar la sala");
  const roomMoved = roomMove.data.appointmentId;
  expect(ti96Code(await moveTi96(t, roomMoved, student, proA, 500, 560, roomB))).toBe("ok");
  expect(await getTi96(t, roomMoved)).toMatchObject({ spaceId: roomB });
  expect(ti96Code(await occupyTi96(t, other, proB, 500, 560, roomA))).toBe("ok");
});

test("TI2-96: al cambiar, la atención propia también ocupa lugar en el tope", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedProfessional(t, "ti96-mov-pro-f");
  const student = await seedTi96Student(t, "ti96-mov-est-7");
  const history = await seedTi96Student(t, "ti96-mov-est-8");
  const active = await seedTi96Student(t, "ti96-mov-est-9");
  const own = await occupyTi96(t, student, pro, 0, 60);
  if (!isOkResult(own)) throw new Error("Se esperaba ocupar el cupo");
  // En la ventana del destino (100–160) caben 200 cancelaciones previas, la
  // propia y, al final del índice, una atención activa que se cruza.
  await t.run(async (ctx) => {
    for (let index = 0; index < MAX_APPOINTMENTS_IN_WINDOW; index += 1) {
      await ctx.db.insert("appointments", {
        ...history,
        professionalId: pro,
        modality: "online",
        status: "cancelled_by_student",
        startsAt: ti96At(index - 1300),
        endsAt: ti96At(index - 1290),
        createdAt: 1,
      });
    }
    await ctx.db.insert("appointments", {
      ...active,
      professionalId: pro,
      modality: "online",
      status: "scheduled",
      startsAt: ti96At(110),
      endsAt: ti96At(170),
      createdAt: 1,
    });
  });
  const before = await listTi96Appointments(t);

  // Sin contar la propia se decidiría con una lista cortada que no ve la activa.
  expect(await moveTi96(t, own.data.appointmentId, student, pro, 100, 160)).toEqual(
    errResult(conflictError()),
  );
  expect(await listTi96Appointments(t)).toEqual(before);
});

test("TI2-96: solo se cambia una atención vigente del mismo estudiante y acompañamiento", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedProfessional(t, "ti96-mov-pro-e");
  const student = await seedTi96Student(t, "ti96-mov-est-5");
  const other = await seedTi96Student(t, "ti96-mov-est-6");
  const own = await occupyTi96(t, student, pro, 0, 60);
  const foreign = await occupyTi96(t, other, pro, 120, 180);
  const gone = await occupyTi96(t, student, pro, 400, 460);
  if (!isOkResult(own) || !isOkResult(foreign) || !isOkResult(gone)) {
    throw new Error("Se esperaba ocupar los cupos");
  }
  const cancelled = await t.run(async (ctx) => {
    return await ctx.db.insert("appointments", {
      ...student,
      professionalId: pro,
      modality: "online",
      status: "cancelled_by_student",
      startsAt: ti96At(300),
      endsAt: ti96At(360),
      createdAt: 1,
    });
  });
  await t.run(async (ctx) => {
    await ctx.db.delete(gone.data.appointmentId);
  });
  const otherAccompaniment = await seedAccompaniment(t, student.studentId);
  const before = await listTi96Appointments(t);

  // El destino está libre para todos: el rechazo viene solo del origen.
  for (const [moved, who] of [
    [foreign.data.appointmentId, student],
    [own.data.appointmentId, other],
    [own.data.appointmentId, { ...student, accompanimentId: otherAccompaniment }],
    // Mismo acompañamiento con otro estudiante: buscaría cruces en otra agenda.
    [own.data.appointmentId, { ...student, studentId: other.studentId }],
    [cancelled, student],
    [gone.data.appointmentId, student],
    [pro as unknown as Id<"appointments">, student],
  ] as const) {
    expect(await moveTi96(t, moved, who, pro, 600, 660)).toEqual(errResult(conflictError()));
  }
  expect(await listTi96Appointments(t)).toEqual(before);
});
