/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  APPOINTMENT_STATUS_VALUES,
  transitionAppointment,
  type AppointmentStatus,
} from "../domain/appointments/appointment";
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
  appointmentTransitionRepository,
  occupySlotAtomically,
  type OccupySlotRow,
} from "../infrastructure/appointments/repository";
import { bookAppointment, type BookAppointmentDeps } from "../application/appointments/booking";
import {
  cancelAppointment,
  recordAppointmentAttendance,
  rescheduleAppointment,
  type AppointmentChangeReader,
  type AppointmentTransitionPersister,
  type CancelAppointmentDeps,
  type RecordAppointmentAttendanceDeps,
  type RescheduleAppointmentDeps,
} from "../application/appointments/changes";
import { authorizationReader } from "../infrastructure/accompaniments/repository";
import { availabilityReader } from "../infrastructure/availability/repository";
import { cancelRequest, closeRequestWithoutAccompaniment } from "../application/requests/commands";
import { applyAppointmentTransition } from "../application/appointments/commands";
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

/** Profesional ficticio con cuenta habilitada y, por defecto, vigente. */
async function seedProfessional(
  t: ReturnType<typeof convexTest>,
  subject: string,
  accountStatus: "active" | "inactive" = "active",
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: `${subject}@uct.cl`,
      fullName: "Profesional Ficticio",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus,
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

/** Lunes 2026-10-12 09:00 UTC en milésimas de segundo de época. */
const TI84_SLOT_START = Date.UTC(2026, 9, 12, 9);

/** Lunes 2026-10-12 10:00 UTC en milésimas de segundo de época. */
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

test("Persistir atención: fecha original, motivo de cancelación e inasistencia (TI2-107)", async () => {
  const t = convexTest(schema, modules);
  const student = await seedStudent(t, "ti107-est-1");
  const pro = await seedProfessional(t, "ti107-pro-1");
  const accompaniment = await seedAccompaniment(t, student);

  // Primera atención programada
  const created = await t.run(async (ctx) => {
    return await occupySlotAtomically(ctx, {
      accompanimentId: accompaniment,
      studentId: student,
      professionalId: pro,
      modality: "inPerson",
      startsAt: TI84_SLOT_START,
      endsAt: TI84_SLOT_END,
    });
  });
  if (!isOkResult(created)) throw new Error("Se esperaba ocupar el cupo");

  const stored = await t.run(async (ctx) => {
    return await ctx.db.get(created.data.appointmentId);
  });
  expect(stored?.status).toBe("scheduled");
  expect(stored?.studentId).toEqual(student);
  expect(stored?.professionalId).toEqual(pro);
  expect(stored?.modality).toBe("inPerson");
  expect(stored?.startsAt).toBe(TI84_SLOT_START);
  expect(stored?.endsAt).toBe(TI84_SLOT_END);
  expect(stored?.originalStartsAt).toBeUndefined(); // sin reagendar aún
  expect(stored?.cancelReason).toBeUndefined(); // sin cancelación aún
  expect(stored?.accompanimentId).toEqual(accompaniment);
});

test("Reagendar atención conserva fecha original (TI2-107)", async () => {
  const t = convexTest(schema, modules);
  const student = await seedStudent(t, "ti107-est-2");
  const pro = await seedProfessional(t, "ti107-pro-2");
  const accompaniment = await seedAccompaniment(t, student);

  // Primera atención: lunes 09:00-10:00
  const created = await t.run(async (ctx) => {
    return await occupySlotAtomically(ctx, {
      accompanimentId: accompaniment,
      studentId: student,
      professionalId: pro,
      modality: "inPerson",
      startsAt: TI84_SLOT_START,
      endsAt: TI84_SLOT_END,
    });
  });
  if (!isOkResult(created)) throw new Error("Se esperaba ocupar el cupo");

  // Reagendar a martes 09:00-10:00 (mismo día de la semana siguiente). La
  // política de TI2-93 calcula la fecha original y el estado resultante; el
  // repositorio solo guarda lo que el caso de uso le entrega.
  const movedStart = TI84_SLOT_START + 86_400_000; // +1 día
  const movedEnd = TI84_SLOT_END + 86_400_000;
  const outcome = transitionAppointment({
    from: "scheduled",
    to: "rescheduled",
    actorId: pro,
    occurredAt: TI84_SLOT_END,
    currentStartAt: TI84_SLOT_START,
    newStartAt: movedStart,
    newEndAt: movedEnd,
  });
  if (outcome.status !== "applied") throw new Error("Se esperaba aplicar el reagendamiento");

  const rescheduled = await t.run(async (ctx) => {
    return await occupySlotAtomically(ctx, {
      accompanimentId: accompaniment,
      studentId: student,
      professionalId: pro,
      modality: "inPerson",
      startsAt: movedStart,
      endsAt: movedEnd,
      movedAppointmentId: created.data.appointmentId,
      originalStartsAt: outcome.originalStartAt,
      nextStatus: outcome.change.to,
    });
  });
  if (!isOkResult(rescheduled)) throw new Error("Se esperaba reagendar el cupo");

  const stored = await t.run(async (ctx) => {
    return await ctx.db
      .query("appointments")
      .withIndex("by_accompanimentId", (q) => q.eq("accompanimentId", accompaniment))
      .take(10);
  });
  const rescheduledRow = stored.find((row) => row.startsAt === movedStart);
  expect(rescheduledRow).toBeDefined();
  // El estado resultante es el que la política entregó
  expect(rescheduledRow?.status).toBe("rescheduled");
  // La fecha original se conserva (no se sobrescribe)
  expect(rescheduledRow?.originalStartsAt).toBe(TI84_SLOT_START);
  // La fecha efectiva se actualiza al nuevo horario
  expect(rescheduledRow?.startsAt).toBe(movedStart);
  expect(rescheduledRow?.endsAt).toBe(movedEnd);
  expect(rescheduledRow?.accompanimentId).toEqual(accompaniment);
});

test("Cambiar solo la sala no marca reagendamiento y dos reagendas conservan la primera fecha (TI2-107)", async () => {
  const t = convexTest(schema, modules);
  const student = await seedStudent(t, "ti107-est-6");
  const pro = await seedProfessional(t, "ti107-pro-6");
  const accompaniment = await seedAccompaniment(t, student);
  const roomA = await seedTi96Space(t, "C-107-a");
  const roomB = await seedTi96Space(t, "C-107-b");

  const created = await t.run(async (ctx) => {
    return await occupySlotAtomically(ctx, {
      accompanimentId: accompaniment,
      studentId: student,
      professionalId: pro,
      modality: "inPerson",
      spaceId: roomA,
      startsAt: TI84_SLOT_START,
      endsAt: TI84_SLOT_END,
    });
  });
  if (!isOkResult(created)) throw new Error("Se esperaba ocupar el cupo");

  // Cambiar solo la sala, en la misma hora: el caso de uso no aplica
  // `transitionAppointment`, así que no entrega fecha original ni estado.
  const roomMoved = await t.run(async (ctx) => {
    return await occupySlotAtomically(ctx, {
      accompanimentId: accompaniment,
      studentId: student,
      professionalId: pro,
      modality: "inPerson",
      spaceId: roomB,
      startsAt: TI84_SLOT_START,
      endsAt: TI84_SLOT_END,
      movedAppointmentId: created.data.appointmentId,
    });
  });
  if (!isOkResult(roomMoved)) throw new Error("Se esperaba cambiar la sala");
  const roomRow = await t.run(async (ctx) => {
    return await ctx.db.get(created.data.appointmentId);
  });
  expect(roomRow?.status).toBe("scheduled");
  expect(roomRow?.originalStartsAt).toBeUndefined();
  expect(roomRow?.startsAt).toBe(TI84_SLOT_START);
  expect(roomRow?.spaceId).toEqual(roomB);

  // Primera reagenda: la política entrega la fecha original (la vigente antes
  // de mover) y el estado `rescheduled`; el repositorio los guarda tal cual.
  const firstMoveStart = TI84_SLOT_START + 86_400_000;
  const firstOutcome = transitionAppointment({
    from: "scheduled",
    to: "rescheduled",
    actorId: pro,
    occurredAt: TI84_SLOT_END,
    currentStartAt: TI84_SLOT_START,
    newStartAt: firstMoveStart,
    newEndAt: TI84_SLOT_END + 86_400_000,
  });
  if (firstOutcome.status !== "applied") throw new Error("Se esperaba la primera reagenda");
  const firstMoved = await t.run(async (ctx) => {
    return await occupySlotAtomically(ctx, {
      accompanimentId: accompaniment,
      studentId: student,
      professionalId: pro,
      modality: "inPerson",
      startsAt: firstMoveStart,
      endsAt: TI84_SLOT_END + 86_400_000,
      movedAppointmentId: created.data.appointmentId,
      originalStartsAt: firstOutcome.originalStartAt,
      nextStatus: firstOutcome.change.to,
    });
  });
  if (!isOkResult(firstMoved)) throw new Error("Se esperaba la primera reagenda");
  const firstRow = await t.run(async (ctx) => {
    return await ctx.db.get(created.data.appointmentId);
  });
  expect(firstRow?.status).toBe("rescheduled");
  expect(firstRow?.originalStartsAt).toBe(TI84_SLOT_START);
  expect(firstRow?.startsAt).toBe(firstMoveStart);

  // Segunda reagenda: la política conserva la primera fecha original y el
  // repositorio no la sobrescribe.
  const secondMoveStart = TI84_SLOT_START + 2 * 86_400_000;
  const secondOutcome = transitionAppointment({
    from: "rescheduled",
    to: "rescheduled",
    actorId: pro,
    occurredAt: TI84_SLOT_END,
    currentStartAt: firstMoveStart,
    currentOriginalStartAt: TI84_SLOT_START,
    newStartAt: secondMoveStart,
    newEndAt: TI84_SLOT_END + 2 * 86_400_000,
  });
  if (secondOutcome.status !== "applied") throw new Error("Se esperaba la segunda reagenda");
  expect(secondOutcome.originalStartAt).toBe(TI84_SLOT_START);
  const secondMoved = await t.run(async (ctx) => {
    return await occupySlotAtomically(ctx, {
      accompanimentId: accompaniment,
      studentId: student,
      professionalId: pro,
      modality: "inPerson",
      startsAt: secondMoveStart,
      endsAt: TI84_SLOT_END + 2 * 86_400_000,
      movedAppointmentId: created.data.appointmentId,
      originalStartsAt: secondOutcome.originalStartAt,
      nextStatus: secondOutcome.change.to,
    });
  });
  if (!isOkResult(secondMoved)) throw new Error("Se esperaba la segunda reagenda");
  const secondRow = await t.run(async (ctx) => {
    return await ctx.db.get(created.data.appointmentId);
  });
  expect(secondRow?.status).toBe("rescheduled");
  expect(secondRow?.originalStartsAt).toBe(TI84_SLOT_START);
  expect(secondRow?.startsAt).toBe(secondMoveStart);
  expect(secondRow?.accompanimentId).toEqual(accompaniment);
});

test("Cancelar atención conserva historial y motivo (TI2-107)", async () => {
  const t = convexTest(schema, modules);
  const student = await seedStudent(t, "ti107-est-3");
  const pro = await seedProfessional(t, "ti107-pro-3");
  const accompaniment = await seedAccompaniment(t, student);

  const created = await t.run(async (ctx) => {
    return await occupySlotAtomically(ctx, {
      accompanimentId: accompaniment,
      studentId: student,
      professionalId: pro,
      modality: "inPerson",
      startsAt: TI84_SLOT_START,
      endsAt: TI84_SLOT_END,
    });
  });
  if (!isOkResult(created)) throw new Error("Se esperaba ocupar el cupo");

  // La cancelación de CERETI sin motivo la rechaza la política de TI2-93 vía
  // el caso de uso de TI2-107, con el código estable de conflicto y sin
  // escribir nada en la fila.
  const rejected = await t.run(async (ctx) => {
    return await applyAppointmentTransition(appointmentTransitionRepository(ctx), {
      appointmentId: created.data.appointmentId,
      to: "cancelled_by_cereti",
      actorId: pro,
      occurredAt: TI84_SLOT_START,
    });
  });
  expect(rejected).toEqual(errResult(conflictError()));
  const intact = await t.run(async (ctx) => {
    return await ctx.db.get(created.data.appointmentId);
  });
  expect(intact?.status).toBe("scheduled");
  expect(intact?.cancelReason).toBeUndefined();

  // Cancelar por CERETI con motivo: el caso de uso aplica la política y
  // persiste su resultado
  const cancelled = await t.run(async (ctx) => {
    return await applyAppointmentTransition(appointmentTransitionRepository(ctx), {
      appointmentId: created.data.appointmentId,
      to: "cancelled_by_cereti",
      actorId: pro,
      occurredAt: TI84_SLOT_START,
      reason: "Sala no disponible",
    });
  });
  if (!isOkResult(cancelled)) throw new Error("Se esperaba aplicar la cancelación");
  expect(cancelled).toEqual(okResult({ appointmentId: created.data.appointmentId }));

  const stored = await t.run(async (ctx) => {
    return await ctx.db
      .query("appointments")
      .withIndex("by_accompanimentId", (q) => q.eq("accompanimentId", accompaniment))
      .take(10);
  });
  const cancelledRow = stored.find((row) => row.status === "cancelled_by_cereti");
  expect(cancelledRow).toBeDefined();
  expect(cancelledRow?.cancelReason).toBe("Sala no disponible");
  expect(cancelledRow?.startsAt).toBe(TI84_SLOT_START);
  expect(cancelledRow?.endsAt).toBe(TI84_SLOT_END);
  expect(cancelledRow?.accompanimentId).toEqual(accompaniment);

  // El historial no se borra: sigue existiendo la fila
  expect(cancelledRow?._id).toEqual(created.data.appointmentId);
});

test("Inasistencia (no_show) se persiste como estado de la atención (TI2-107)", async () => {
  const t = convexTest(schema, modules);
  const student = await seedStudent(t, "ti107-est-4");
  const pro = await seedProfessional(t, "ti107-pro-4");
  const accompaniment = await seedAccompaniment(t, student);

  const created = await t.run(async (ctx) => {
    return await occupySlotAtomically(ctx, {
      accompanimentId: accompaniment,
      studentId: student,
      professionalId: pro,
      modality: "online",
      startsAt: TI84_SLOT_START,
      endsAt: TI84_SLOT_END,
    });
  });
  if (!isOkResult(created)) throw new Error("Se esperaba ocupar el cupo");

  // Registrar la inasistencia por el caso de uso: la política exige que el
  // registro no sea anterior al inicio vigente, así ocurrió ya la sesión
  const noShow = await t.run(async (ctx) => {
    return await applyAppointmentTransition(appointmentTransitionRepository(ctx), {
      appointmentId: created.data.appointmentId,
      to: "no_show",
      actorId: pro,
      occurredAt: TI84_SLOT_END,
    });
  });
  if (!isOkResult(noShow)) throw new Error("Se esperaba aplicar la inasistencia");

  // La política rechaza una inasistencia registrada antes de la sesión: es
  // un conflicto con el estado actual, sin escribir nada
  const tooEarly = await t.run(async (ctx) => {
    return await occupySlotAtomically(ctx, {
      accompanimentId: accompaniment,
      studentId: student,
      professionalId: pro,
      modality: "online",
      startsAt: TI84_SLOT_START + 86_400_000,
      endsAt: TI84_SLOT_END + 86_400_000,
    });
  });
  if (!isOkResult(tooEarly)) throw new Error("Se esperaba ocupar el segundo cupo");
  const rejectedNoShow = await t.run(async (ctx) => {
    return await applyAppointmentTransition(appointmentTransitionRepository(ctx), {
      appointmentId: tooEarly.data.appointmentId,
      to: "no_show",
      actorId: pro,
      occurredAt: TI84_SLOT_START,
    });
  });
  expect(rejectedNoShow).toEqual(errResult(conflictError()));
  const untouchedSecond = await t.run(async (ctx) => {
    return await ctx.db.get(tooEarly.data.appointmentId);
  });
  expect(untouchedSecond?.status).toBe("scheduled");

  const stored = await t.run(async (ctx) => {
    return await ctx.db
      .query("appointments")
      .withIndex("by_accompanimentId", (q) => q.eq("accompanimentId", accompaniment))
      .take(10);
  });
  const noShowRow = stored.find((row) => row.status === "no_show");
  expect(noShowRow).toBeDefined();
  expect(noShowRow?.status).toBe("no_show");
  expect(noShowRow?.startsAt).toBe(TI84_SLOT_START);
  expect(noShowRow?.endsAt).toBe(TI84_SLOT_END);
  expect(noShowRow?.accompanimentId).toEqual(accompaniment);
  expect(noShowRow?._id).toEqual(created.data.appointmentId);
});

test("Leer atenciones previas de un profesional por rango de fechas (TI2-107)", async () => {
  const t = convexTest(schema, modules);
  const student = await seedStudent(t, "ti107-est-5");
  const pro = await seedProfessional(t, "ti107-pro-5");
  const otherStudent = await seedStudent(t, "ti107-est-other");
  const otherPro = await seedProfessional(t, "ti107-pro-other");
  const accompaniment = await seedAccompaniment(t, student);
  const otherAccompaniment = await seedAccompaniment(t, otherStudent);

  // 1. Scheduled en rango
  const created1 = await t.run(async (ctx) => {
    return await occupySlotAtomically(ctx, {
      accompanimentId: accompaniment,
      studentId: student,
      professionalId: pro,
      modality: "online",
      startsAt: TI84_SLOT_START,
      endsAt: TI84_SLOT_END,
    });
  });
  if (!isOkResult(created1)) throw new Error("Se esperaba ocupar el cupo");

  // 2. Completed en rango (creado como scheduled y transicionado a completed)
  const created2 = await t.run(async (ctx) => {
    return await occupySlotAtomically(ctx, {
      accompanimentId: accompaniment,
      studentId: student,
      professionalId: pro,
      modality: "online",
      startsAt: TI84_SLOT_START + 3_600_000,
      endsAt: TI84_SLOT_END + 3_600_000,
    });
  });
  if (!isOkResult(created2)) throw new Error("Se esperaba ocupar el cupo");
  await t.run(async (ctx) => {
    return await applyAppointmentTransition(appointmentTransitionRepository(ctx), {
      appointmentId: created2.data.appointmentId,
      to: "completed",
      actorId: pro,
      occurredAt: TI84_SLOT_END + 3_600_000,
    });
  });

  // 3. Cancelled by student en rango (creado como scheduled y transicionado)
  const created3 = await t.run(async (ctx) => {
    return await occupySlotAtomically(ctx, {
      accompanimentId: accompaniment,
      studentId: student,
      professionalId: pro,
      modality: "online",
      startsAt: TI84_SLOT_START + 2 * 3_600_000,
      endsAt: TI84_SLOT_END + 2 * 3_600_000,
    });
  });
  if (!isOkResult(created3)) throw new Error("Se esperaba ocupar el cupo");
  await t.run(async (ctx) => {
    return await applyAppointmentTransition(appointmentTransitionRepository(ctx), {
      appointmentId: created3.data.appointmentId,
      to: "cancelled_by_student",
      actorId: student,
      occurredAt: TI84_SLOT_START + 2 * 3_600_000,
    });
  });

  // 4. Atención de OTRO profesional en el mismo rango (debe ser filtrada)
  const otherProApp = await t.run(async (ctx) => {
    return await occupySlotAtomically(ctx, {
      accompanimentId: otherAccompaniment,
      studentId: otherStudent,
      professionalId: otherPro,
      modality: "online",
      startsAt: TI84_SLOT_START,
      endsAt: TI84_SLOT_END,
    });
  });
  if (!isOkResult(otherProApp)) throw new Error("Se esperaba ocupar el cupo");

  // 5. Atención del mismo profesional FUERA del rango de fechas (anterior)
  const outOfRangeApp = await t.run(async (ctx) => {
    return await occupySlotAtomically(ctx, {
      accompanimentId: accompaniment,
      studentId: student,
      professionalId: pro,
      modality: "online",
      startsAt: TI84_SLOT_START - 86_400_000,
      endsAt: TI84_SLOT_END - 86_400_000,
    });
  });
  if (!isOkResult(outOfRangeApp)) throw new Error("Se esperaba ocupar el cupo");

  const expectedIds = [
    created1.data.appointmentId,
    created2.data.appointmentId,
    created3.data.appointmentId,
  ];

  // Leer atenciones del profesional por rango de fechas exacto
  const all = await t.run(async (ctx) => {
    return await ctx.db
      .query("appointments")
      .withIndex("by_professionalId_and_startsAt", (q) =>
        q.eq("professionalId", pro).gte("startsAt", TI84_SLOT_START),
      )
      .take(50);
  });
  expect(all.map((row) => row._id).sort()).toEqual([...expectedIds].sort());
});

test("Diez ciclos de reserva y cancelación no ocultan la atención activa (TI2-84)", async () => {
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
  await expectNoTi96Crossings(t);
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
  await expectNoTi96Crossings(t);
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
  await expectNoTi96Crossings(t);
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
  // Las canceladas que se cruzan no cuentan como cruce: el invariante las ignora.
  await expectNoTi96Crossings(t);
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
  // El cambio no la marca como reagendada: el estado y la fecha original los
  // entrega el caso de uso que aplica `transitionAppointment` (TI2-93).
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

/**
 * Invariante de TI2-96: ninguna pareja de atenciones que siguen ocupando su
 * cupo se cruza en su estudiante, su profesional o su sala.
 */
async function expectNoTi96Crossings(t: ReturnType<typeof convexTest>) {
  const rows = (await listTi96Appointments(t)).filter(
    (row) => !row.status.startsWith("cancelled_"),
  );
  const crossings: string[] = [];
  for (const [index, a] of rows.entries()) {
    for (const b of rows.slice(index + 1)) {
      const overlap = a.startsAt < b.endsAt && b.startsAt < a.endsAt;
      const shared =
        a.studentId === b.studentId ||
        a.professionalId === b.professionalId ||
        (a.spaceId !== undefined && a.spaceId === b.spaceId);
      if (overlap && shared) crossings.push(`${a._id} × ${b._id}`);
    }
  }
  expect(crossings).toEqual([]);
}

/*
 * Contienda. convex-test@0.0.58 ejecuta en secuencia las transacciones de
 * nivel superior y toma su candado en el orden de llamada: de dos intentos
 * lanzados a la vez gana siempre el primero, y el segundo ya ve su atención.
 * Por eso cada escenario se corre en los dos órdenes y se afirma quién gana.
 * El solapamiento real lo resuelve el control optimista de Convex: cada
 * intento lee por rango las ventanas que el otro escribiría, así que Convex
 * obliga a reintentar uno de los dos y ese ya ve la atención del otro. No se
 * ejecutó contra un deployment: la issue pide uno autorizado con datos
 * ficticios.
 */

test("TI2-96: dos intentos en contienda que comparten un recurso dejan una sola atención", async () => {
  for (const shared of ["professional", "student", "space"] as const) {
    for (const reversed of [false, true]) {
      const t = convexTest(schema, modules);
      const proA = await seedProfessional(t, `ti96-occ-${shared}-pro-a`);
      const proB = await seedProfessional(t, `ti96-occ-${shared}-pro-b`);
      const studentA = await seedTi96Student(t, `ti96-occ-${shared}-est-a`);
      const studentB = await seedTi96Student(t, `ti96-occ-${shared}-est-b`);
      const room = await seedTi96Space(t, `C-occ-${shared}`);
      const attempts = {
        professional: [
          [studentA, proA, undefined, 0, 60],
          [studentB, proA, undefined, 30, 90],
        ],
        student: [
          [studentA, proA, undefined, 0, 60],
          [studentA, proB, undefined, 30, 90],
        ],
        space: [
          [studentA, proA, room, 0, 60],
          [studentB, proB, room, 30, 90],
        ],
      } as const;
      const [first, second] = reversed
        ? [attempts[shared][1], attempts[shared][0]]
        : [attempts[shared][0], attempts[shared][1]];

      const results = await Promise.all(
        [first, second].map(([who, pro, space, from, to]) =>
          occupyTi96(t, who, pro, from, to, space),
        ),
      );
      expect(results.map(ti96Code)).toEqual(["ok", CONFLICT_ERROR_CODE]);

      // El documento final es el del primero; el segundo no dejó nada.
      const [who, pro, space, from, to] = first;
      const rows = await listTi96Appointments(t);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        ...who,
        professionalId: pro,
        startsAt: ti96At(from),
        endsAt: ti96At(to),
        status: "scheduled",
      });
      expect(rows[0].spaceId).toBe(space);
    }
  }
});

test("TI2-96: un cambio y una creación en contienda no dejan cruces y el perdedor no escribe", async () => {
  for (const moveFirst of [true, false]) {
    const t = convexTest(schema, modules);
    const pro = await seedProfessional(t, "ti96-occ-pro-c");
    const student = await seedTi96Student(t, "ti96-occ-est-c");
    const other = await seedTi96Student(t, "ti96-occ-est-d");
    const own = await occupyTi96(t, student, pro, 0, 60);
    if (!isOkResult(own)) throw new Error("Se esperaba ocupar el cupo");
    const origin = await getTi96(t, own.data.appointmentId);

    // El cambio a 100–160 y la creación en 120–180 se cruzan en el profesional.
    const move = () => moveTi96(t, own.data.appointmentId, student, pro, 100, 160);
    const create = () => occupyTi96(t, other, pro, 120, 180);
    const results = await Promise.all(moveFirst ? [move(), create()] : [create(), move()]);
    expect(results.map(ti96Code)).toEqual(["ok", CONFLICT_ERROR_CODE]);

    // Si ganó el cambio, la atención está en el destino y la creación no escribió;
    // si ganó la creación, el origen quedó íntegro y existe la atención nueva.
    const rows = await listTi96Appointments(t);
    expect({ rows: rows.length, own: await getTi96(t, own.data.appointmentId) }).toEqual(
      moveFirst
        ? {
            rows: 1,
            own: {
              ...origin,
              startsAt: ti96At(100),
              endsAt: ti96At(160),
            },
          }
        : { rows: 2, own: origin },
    );
    await expectNoTi96Crossings(t);
  }
});

/** Lunes 2026-10-26 09:00 UTC, dentro del bloque ficticio de TI2-98. */
const TI98_SLOT_START = Date.UTC(2026, 9, 26, 9);

/** Fin del cupo ficticio de TI2-98. */
const TI98_SLOT_END = Date.UTC(2026, 9, 26, 10);

/** Asignación profesional del acompañamiento para el profesional elegido. */
async function seedTi98Assignment(
  t: ReturnType<typeof convexTest>,
  accompanimentId: Id<"accompaniments">,
  professionalId: Id<"users">,
  status: "active" | "revoked" = "active",
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("accompanimentAssignments", {
      accompanimentId,
      userId: professionalId,
      assignedRole: "professional",
      status,
    });
  });
}

/** Bloque en línea semanal del profesional para el lunes de la prueba. */
async function seedTi98Block(t: ReturnType<typeof convexTest>, professionalId: Id<"users">) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("availabilityBlocks", {
      professionalId,
      weekday: 1,
      startMinute: 540,
      endMinute: 600,
      slotMinutes: 60,
      modality: "online",
      isActive: true,
    });
  });
}

/**
 * Ejecuta el caso de uso TI2-98 con los lectores reales de Convex y un
 * ocupador local sobre el mismo `ctx`. Necesidades y compatibilidad siguen
 * siendo dobles porque sus adaptadores pertenecen a TI2-111; las necesidades
 * vacías permiten reservar en línea sin alterar la revalidación de cupo.
 */
async function bookTi98(
  t: ReturnType<typeof convexTest>,
  input: {
    readonly tokenIdentifier: string;
    readonly accompanimentId: Id<"accompaniments">;
    readonly professionalId: Id<"users">;
  },
) {
  return await t.run(async (ctx) => {
    const deps: BookAppointmentDeps = {
      auth: authorizationReader(ctx),
      availability: availabilityReader(ctx),
      needs: {
        findAccompanimentNeeds: async (accompanimentId) =>
          accompanimentId === input.accompanimentId ? { _id: accompanimentId, needs: [] } : null,
      },
      compatibility: {
        findCompatibilitySpace: async () => null,
        listOnlineSupports: async () => [],
      },
      occupier: {
        occupySlot: (slot) =>
          occupySlotAtomically(ctx, {
            accompanimentId: slot.accompanimentId as Id<"accompaniments">,
            studentId: slot.studentId as Id<"users">,
            professionalId: slot.professionalId as Id<"users">,
            modality: slot.modality,
            ...(slot.spaceId === undefined ? {} : { spaceId: slot.spaceId as Id<"spaces"> }),
            startsAt: slot.startAt,
            endsAt: slot.endAt,
          }),
      },
    };

    return await bookAppointment(deps, {
      tokenIdentifier: input.tokenIdentifier,
      accompanimentId: input.accompanimentId,
      professionalId: input.professionalId,
      modality: "online",
      startAt: TI98_SLOT_START,
      endAt: TI98_SLOT_END,
      timeZone: "UTC",
    });
  });
}

test("TI2-98: la reserva guarda una atención y el segundo intento no duplica", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedProfessional(t, "ti98-pro-1");
  const student = await seedStudent(t, "ti98-est-1");
  const accompaniment = await seedAccompaniment(t, student);
  await seedTi98Assignment(t, accompaniment, pro);
  await seedTi98Block(t, pro);
  const input = {
    tokenIdentifier: identityFor("ti98-est-1", "ti98-est-1@alu.uct.cl").tokenIdentifier,
    accompanimentId: accompaniment,
    professionalId: pro,
  };

  const first = await bookTi98(t, input);
  if (!isOkResult(first)) throw new Error("Se esperaba reservar el cupo");

  const second = await bookTi98(t, input);
  if (!isErrorResult(second)) throw new Error("Se esperaba rechazar el segundo intento");
  expect(second.error.code).toBe(CONFLICT_ERROR_CODE);

  const rows = await t.run(async (ctx) => await ctx.db.query("appointments").take(10));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    _id: first.data.appointmentId,
    accompanimentId: accompaniment,
    studentId: student,
    professionalId: pro,
    modality: "online",
    status: "scheduled",
    startsAt: TI98_SLOT_START,
    endsAt: TI98_SLOT_END,
  });
  expect(rows[0]?.spaceId).toBeUndefined();
});

test("TI2-98: no reserva sin asignación activa o con cuenta profesional inactiva", async () => {
  const cases = [
    { label: "sin asignación", assignment: null, accountStatus: "active" as const },
    {
      label: "asignación revocada",
      assignment: "revoked" as const,
      accountStatus: "active" as const,
    },
    { label: "cuenta inactiva", assignment: "active" as const, accountStatus: "inactive" as const },
  ];

  for (const { label, assignment, accountStatus } of cases) {
    const t = convexTest(schema, modules);
    const subject = `ti98-${assignment ?? "none"}-${accountStatus}`;
    const pro = await seedProfessional(t, `pro-${subject}`, accountStatus);
    const student = await seedStudent(t, `est-${subject}`);
    const accompaniment = await seedAccompaniment(t, student);
    await seedTi98Block(t, pro);
    if (assignment !== null) {
      await seedTi98Assignment(t, accompaniment, pro, assignment);
    }

    const result = await bookTi98(t, {
      tokenIdentifier: identityFor(`est-${subject}`, `est-${subject}@alu.uct.cl`).tokenIdentifier,
      accompanimentId: accompaniment,
      professionalId: pro,
    });

    if (!isErrorResult(result)) throw new Error(`Se esperaba rechazar: ${label}`);
    expect(result.error.code).toBe(NO_AVAILABILITY_ERROR_CODE);
    expect(await t.run(async (ctx) => await ctx.db.query("appointments").take(10))).toHaveLength(0);
  }
});

/** Instante fijo de las pruebas TI2-109, lunes 2026-10-26 08:00 UTC. */
const TI109_NOW = Date.UTC(2026, 9, 26, 8);

/** Fecha original ficticia de una atención ya reagendada. */
const TI109_ORIGINAL_START = Date.UTC(2026, 9, 26, 7);

/** Inicio del destino ficticio de TI2-109, 11:00 UTC. */
const TI109_TARGET_START = Date.UTC(2026, 9, 26, 11);

/** Fin del destino ficticio de TI2-109, 12:00 UTC. */
const TI109_TARGET_END = Date.UTC(2026, 9, 26, 12);

type TestMutationCtx = Parameters<typeof occupySlotAtomically>[0];

type PersistedTransition = {
  readonly appointmentId: string;
  readonly fields: {
    readonly status: AppointmentStatus;
    readonly cancelReason?: string;
    readonly originalStartsAt?: number;
  };
};

/** Adaptador de lectura de la atención sobre el `ctx` real de Convex. */
function appointmentChangeReader(ctx: TestMutationCtx): AppointmentChangeReader {
  return {
    getAppointment: async (appointmentId) => {
      const id = ctx.db.normalizeId("appointments", appointmentId);
      if (id === null) return null;
      const doc = await ctx.db.get(id);
      if (doc === null) return null;
      return {
        id: doc._id,
        accompanimentId: doc.accompanimentId,
        studentId: doc.studentId,
        professionalId: doc.professionalId,
        status: doc.status,
        startAt: doc.startsAt,
        endAt: doc.endsAt,
        ...(doc.originalStartsAt === undefined ? {} : { originalStartAt: doc.originalStartsAt }),
      };
    },
  };
}

/**
 * Adaptador de persistencia de prueba, equivalente al de TI2-107: escribe solo
 * los campos que produce la política y permite espiar las transiciones.
 */
function appointmentTransitionPersister(
  ctx: TestMutationCtx,
  transitions: PersistedTransition[] = [],
): AppointmentTransitionPersister {
  return {
    persistAppointmentTransition: async (appointmentId, fields) => {
      transitions.push({ appointmentId, fields });
      const id = ctx.db.normalizeId("appointments", appointmentId);
      if (id === null) throw new Error("Identificador de atención inválido");
      await ctx.db.patch(id, {
        status: fields.status,
        ...(fields.cancelReason === undefined ? {} : { cancelReason: fields.cancelReason }),
        ...(fields.originalStartsAt === undefined
          ? {}
          : { originalStartsAt: fields.originalStartsAt }),
      });
    },
  };
}

/** Bloque en línea de TI2-109 en el lunes ficticio de las pruebas. */
async function seedTi109Block(
  t: ReturnType<typeof convexTest>,
  professionalId: Id<"users">,
  startMinute: number,
  endMinute: number,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("availabilityBlocks", {
      professionalId,
      weekday: 1,
      startMinute,
      endMinute,
      slotMinutes: 60,
      modality: "online",
      isActive: true,
    });
  });
}

/** Lee la atención por su identificador opaco, como lo haría el adaptador real. */
async function getTi109(t: ReturnType<typeof convexTest>, appointmentId: string) {
  return await t.run(async (ctx) => {
    const id = ctx.db.normalizeId("appointments", appointmentId);
    return id === null ? null : await ctx.db.get(id);
  });
}

/** Ejecuta la cancelación con los lectores reales y el persister de prueba. */
async function cancelTi109(
  t: ReturnType<typeof convexTest>,
  input: {
    readonly tokenIdentifier: string;
    readonly appointmentId: string;
    readonly reason?: string;
    readonly transitions?: PersistedTransition[];
  },
) {
  return await t.run(async (ctx) => {
    const deps: CancelAppointmentDeps = {
      auth: authorizationReader(ctx),
      appointments: appointmentChangeReader(ctx),
      persister: appointmentTransitionPersister(ctx, input.transitions),
      now: () => TI109_NOW,
    };
    return await cancelAppointment(deps, {
      tokenIdentifier: input.tokenIdentifier,
      appointmentId: input.appointmentId,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    });
  });
}

/** Ejecuta el reagendamiento con disponibilidad, ocupación y persistencia reales. */
async function rescheduleTi109(
  t: ReturnType<typeof convexTest>,
  input: {
    readonly tokenIdentifier: string;
    readonly appointmentId: string;
    readonly professionalId: Id<"users">;
    readonly startAt: number;
    readonly endAt: number;
    readonly transitions?: PersistedTransition[];
  },
) {
  return await t.run(async (ctx) => {
    const deps: RescheduleAppointmentDeps = {
      auth: authorizationReader(ctx),
      appointments: appointmentChangeReader(ctx),
      persister: appointmentTransitionPersister(ctx, input.transitions),
      occupier: {
        occupySlot: (slot) =>
          occupySlotAtomically(ctx, {
            accompanimentId: slot.accompanimentId as Id<"accompaniments">,
            studentId: slot.studentId as Id<"users">,
            professionalId: slot.professionalId as Id<"users">,
            modality: slot.modality,
            ...(slot.spaceId === undefined ? {} : { spaceId: slot.spaceId as Id<"spaces"> }),
            startsAt: slot.startAt,
            endsAt: slot.endAt,
            ...(slot.movedAppointmentId === undefined
              ? {}
              : { movedAppointmentId: slot.movedAppointmentId as Id<"appointments"> }),
          }),
      },
      availability: availabilityReader(ctx),
      needs: {
        findAccompanimentNeeds: async (accompanimentId) => ({
          _id: accompanimentId,
          needs: [],
        }),
      },
      compatibility: {
        findCompatibilitySpace: async () => null,
        listOnlineSupports: async () => [],
      },
      now: () => TI109_NOW,
    };
    return await rescheduleAppointment(deps, {
      tokenIdentifier: input.tokenIdentifier,
      appointmentId: input.appointmentId,
      professionalId: input.professionalId,
      modality: "online",
      startAt: input.startAt,
      endAt: input.endAt,
      timeZone: "UTC",
    });
  });
}

test("TI2-109: cancelar libera el cupo y permite volver a reservarlo", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedProfessional(t, "ti109-cancel-pro");
  const student = await seedStudent(t, "ti109-cancel-est");
  const accompaniment = await seedAccompaniment(t, student);
  await seedTi98Assignment(t, accompaniment, pro);
  await seedTi98Block(t, pro);
  const tokenIdentifier = identityFor(
    "ti109-cancel-est",
    "ti109-cancel-est@alu.uct.cl",
  ).tokenIdentifier;
  const booking = { tokenIdentifier, accompanimentId: accompaniment, professionalId: pro };

  const first = await bookTi98(t, booking);
  if (!isOkResult(first)) throw new Error("Se esperaba reservar el cupo inicial");

  const transitions: PersistedTransition[] = [];
  const canceled = await cancelTi109(t, {
    tokenIdentifier,
    appointmentId: first.data.appointmentId,
    reason: "Motivo ficticio de cancelación",
    transitions,
  });
  if (!isOkResult(canceled)) throw new Error("Se esperaba cancelar la atención");

  expect(transitions).toEqual([
    {
      appointmentId: first.data.appointmentId,
      fields: {
        status: "cancelled_by_student",
        cancelReason: "Motivo ficticio de cancelación",
      },
    },
  ]);

  const canceledRow = await getTi109(t, first.data.appointmentId);
  if (canceledRow === null) throw new Error("Se esperaba la atención cancelada");
  expect(canceledRow).toMatchObject({
    _id: first.data.appointmentId,
    accompanimentId: accompaniment,
    studentId: student,
    professionalId: pro,
    modality: "online",
    status: "cancelled_by_student",
    cancelReason: "Motivo ficticio de cancelación",
    startsAt: TI98_SLOT_START,
    endsAt: TI98_SLOT_END,
  });
  expect(canceledRow.originalStartsAt).toBeUndefined();

  const second = await bookTi98(t, booking);
  if (!isOkResult(second)) throw new Error("Se esperaba reutilizar el cupo liberado");
  expect(second.data.appointmentId).not.toBe(first.data.appointmentId);

  const nuevaReserva = await getTi109(t, second.data.appointmentId);
  if (nuevaReserva === null) throw new Error("Se esperaba la nueva atención");
  expect(nuevaReserva).toMatchObject({
    accompanimentId: accompaniment,
    studentId: student,
    professionalId: pro,
    modality: "online",
    status: "scheduled",
    startsAt: TI98_SLOT_START,
    endsAt: TI98_SLOT_END,
  });
  expect(nuevaReserva.originalStartsAt).toBeUndefined();
  expect(await t.run(async (ctx) => await ctx.db.query("appointments").take(10))).toHaveLength(2);
});

test("TI2-109: un destino ocupado conserva horario, estado y fecha original", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedProfessional(t, "ti109-occupied-pro");
  const student = await seedStudent(t, "ti109-occupied-est");
  const accompaniment = await seedAccompaniment(t, student);
  await seedTi98Assignment(t, accompaniment, pro);
  await seedTi98Block(t, pro);
  await seedTi109Block(t, pro, 660, 720);
  const otherStudent = await seedStudent(t, "ti109-occupied-other");
  const otherAccompaniment = await seedAccompaniment(t, otherStudent);

  const originId = await t.run(
    async (ctx) =>
      await ctx.db.insert("appointments", {
        accompanimentId: accompaniment,
        studentId: student,
        professionalId: pro,
        modality: "online",
        status: "rescheduled",
        startsAt: TI98_SLOT_START,
        endsAt: TI98_SLOT_END,
        originalStartsAt: TI109_ORIGINAL_START,
        createdAt: 1,
      }),
  );
  const occupied = await t.run(
    async (ctx) =>
      await occupySlotAtomically(ctx, {
        accompanimentId: otherAccompaniment,
        studentId: otherStudent,
        professionalId: pro,
        modality: "online",
        startsAt: TI109_TARGET_START,
        endsAt: TI109_TARGET_END,
      }),
  );
  if (!isOkResult(occupied)) throw new Error("Se esperaba ocupar el destino");

  const transitions: PersistedTransition[] = [];
  const result = await rescheduleTi109(t, {
    tokenIdentifier: identityFor("ti109-occupied-est", "ti109-occupied-est@alu.uct.cl")
      .tokenIdentifier,
    appointmentId: originId,
    professionalId: pro,
    startAt: TI109_TARGET_START,
    endAt: TI109_TARGET_END,
    transitions,
  });
  if (!isErrorResult(result)) throw new Error("Se esperaba rechazar el destino ocupado");
  expect(result.error.code).toBe(CONFLICT_ERROR_CODE);
  expect(transitions).toHaveLength(0);

  const origin = await getTi109(t, originId);
  if (origin === null) throw new Error("Se esperaba la atención de origen");
  expect(origin).toMatchObject({
    status: "rescheduled",
    professionalId: pro,
    modality: "online",
    startsAt: TI98_SLOT_START,
    endsAt: TI98_SLOT_END,
    originalStartsAt: TI109_ORIGINAL_START,
  });
  expect(origin.spaceId).toBeUndefined();

  const target = await getTi109(t, occupied.data.appointmentId);
  if (target === null) throw new Error("Se esperaba la atención del destino");
  expect(target).toMatchObject({
    status: "scheduled",
    studentId: otherStudent,
    professionalId: pro,
    modality: "online",
    startsAt: TI109_TARGET_START,
    endsAt: TI109_TARGET_END,
  });
  expect(await t.run(async (ctx) => await ctx.db.query("appointments").take(10))).toHaveLength(2);
});

test("TI2-109: reagendar mueve la misma fila y conserva la primera fecha original", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedProfessional(t, "ti109-move-pro");
  const student = await seedStudent(t, "ti109-move-est");
  const accompaniment = await seedAccompaniment(t, student);
  await seedTi98Assignment(t, accompaniment, pro);
  await seedTi98Block(t, pro);
  await seedTi109Block(t, pro, 660, 720);

  const originId = await t.run(
    async (ctx) =>
      await ctx.db.insert("appointments", {
        accompanimentId: accompaniment,
        studentId: student,
        professionalId: pro,
        modality: "online",
        status: "rescheduled",
        startsAt: TI98_SLOT_START,
        endsAt: TI98_SLOT_END,
        originalStartsAt: TI109_ORIGINAL_START,
        createdAt: 1,
      }),
  );

  const transitions: PersistedTransition[] = [];
  const result = await rescheduleTi109(t, {
    tokenIdentifier: identityFor("ti109-move-est", "ti109-move-est@alu.uct.cl").tokenIdentifier,
    appointmentId: originId,
    professionalId: pro,
    startAt: TI109_TARGET_START,
    endAt: TI109_TARGET_END,
    transitions,
  });
  if (!isOkResult(result)) throw new Error("Se esperaba reagendar la atención");
  expect(result.data.appointmentId).toBe(originId);
  expect(transitions).toEqual([
    {
      appointmentId: originId,
      fields: {
        status: "rescheduled",
        originalStartsAt: TI109_ORIGINAL_START,
      },
    },
  ]);

  const moved = await getTi109(t, originId);
  if (moved === null) throw new Error("Se esperaba la atención movida");
  expect(moved).toMatchObject({
    _id: originId,
    accompanimentId: accompaniment,
    studentId: student,
    professionalId: pro,
    modality: "online",
    status: "rescheduled",
    startsAt: TI109_TARGET_START,
    endsAt: TI109_TARGET_END,
    originalStartsAt: TI109_ORIGINAL_START,
  });
  expect(moved.spaceId).toBeUndefined();
  expect(await t.run(async (ctx) => await ctx.db.query("appointments").take(10))).toHaveLength(1);
});

/** Instante fijo de TI2-110, media hora después del inicio del cupo. */
const TI110_NOW = Date.UTC(2026, 9, 26, 9, 30);

/** Atención ficticia de TI2-110 con la fila que lee el caso de uso. */
async function seedTi110Appointment(
  t: ReturnType<typeof convexTest>,
  input: {
    readonly accompanimentId: Id<"accompaniments">;
    readonly studentId: Id<"users">;
    readonly professionalId: Id<"users">;
    readonly status?: "scheduled" | "rescheduled";
    readonly originalStartsAt?: number;
  },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("appointments", {
      accompanimentId: input.accompanimentId,
      studentId: input.studentId,
      professionalId: input.professionalId,
      modality: "online",
      status: input.status ?? "scheduled",
      startsAt: TI98_SLOT_START,
      endsAt: TI98_SLOT_END,
      ...(input.originalStartsAt === undefined ? {} : { originalStartsAt: input.originalStartsAt }),
      createdAt: 1,
    });
  });
}

/** Ejecuta el registro de TI2-110 con los adaptadores reales de Convex. */
async function recordTi110(
  t: ReturnType<typeof convexTest>,
  input: {
    readonly tokenIdentifier: string;
    readonly appointmentId: string;
    readonly outcome: "completed" | "no_show";
    readonly transitions?: PersistedTransition[];
  },
) {
  return await t.run(async (ctx) => {
    const deps: RecordAppointmentAttendanceDeps = {
      auth: authorizationReader(ctx),
      appointments: appointmentChangeReader(ctx),
      persister: appointmentTransitionPersister(ctx, input.transitions),
      now: () => TI110_NOW,
    };
    return await recordAppointmentAttendance(deps, {
      tokenIdentifier: input.tokenIdentifier,
      appointmentId: input.appointmentId,
      outcome: input.outcome,
    });
  });
}

test("TI2-110: el Profesional registra la realización sobre la única atención", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedProfessional(t, "ti110-complete-pro");
  const student = await seedStudent(t, "ti110-complete-est");
  const accompaniment = await seedAccompaniment(t, student);
  await seedTi98Assignment(t, accompaniment, pro);
  const appointmentId = await seedTi110Appointment(t, {
    accompanimentId: accompaniment,
    studentId: student,
    professionalId: pro,
  });

  const transitions: PersistedTransition[] = [];
  const result = await recordTi110(t, {
    tokenIdentifier: identityFor("ti110-complete-pro", "ti110-complete-pro@uct.cl").tokenIdentifier,
    appointmentId,
    outcome: "completed",
    transitions,
  });
  if (!isOkResult(result)) throw new Error("Se esperaba registrar la realización");
  expect(result.data.appointmentId).toBe(appointmentId);
  expect(transitions).toEqual([{ appointmentId, fields: { status: "completed" } }]);

  const row = await getTi109(t, appointmentId);
  if (row === null) throw new Error("Se esperaba la atención registrada");
  expect(row).toMatchObject({
    _id: appointmentId,
    accompanimentId: accompaniment,
    studentId: student,
    professionalId: pro,
    modality: "online",
    status: "completed",
    startsAt: TI98_SLOT_START,
    endsAt: TI98_SLOT_END,
  });
  expect(row.originalStartsAt).toBeUndefined();

  const [appointments, accompaniments, assignments] = await t.run(async (ctx) => [
    await ctx.db.query("appointments").take(10),
    await ctx.db.query("accompaniments").take(10),
    await ctx.db.query("accompanimentAssignments").take(10),
  ]);
  expect(appointments).toHaveLength(1);
  expect(accompaniments).toHaveLength(1);
  expect(assignments).toHaveLength(1);
});

test("TI2-110: inasistencia repetida o salto a realizada no alteran el historial", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedProfessional(t, "ti110-no-show-pro");
  const student = await seedStudent(t, "ti110-no-show-est");
  const accompaniment = await seedAccompaniment(t, student);
  await seedTi98Assignment(t, accompaniment, pro);
  const appointmentId = await seedTi110Appointment(t, {
    accompanimentId: accompaniment,
    studentId: student,
    professionalId: pro,
  });
  const tokenIdentifier = identityFor(
    "ti110-no-show-pro",
    "ti110-no-show-pro@uct.cl",
  ).tokenIdentifier;

  const transitions: PersistedTransition[] = [];
  const first = await recordTi110(t, {
    tokenIdentifier,
    appointmentId,
    outcome: "no_show",
    transitions,
  });
  if (!isOkResult(first)) throw new Error("Se esperaba registrar la inasistencia");

  const repeated = await recordTi110(t, {
    tokenIdentifier,
    appointmentId,
    outcome: "no_show",
    transitions,
  });
  if (!isErrorResult(repeated)) throw new Error("Se esperaba rechazar la repetición");
  expect(repeated.error.code).toBe(CONFLICT_ERROR_CODE);

  const jump = await recordTi110(t, {
    tokenIdentifier,
    appointmentId,
    outcome: "completed",
    transitions,
  });
  if (!isErrorResult(jump)) throw new Error("Se esperaba rechazar el salto a realizada");
  expect(jump.error.code).toBe(CONFLICT_ERROR_CODE);

  expect(transitions).toEqual([{ appointmentId, fields: { status: "no_show" } }]);
  const row = await getTi109(t, appointmentId);
  if (row === null) throw new Error("Se esperaba la atención con inasistencia");
  expect(row).toMatchObject({
    status: "no_show",
    startsAt: TI98_SLOT_START,
    endsAt: TI98_SLOT_END,
  });
  expect(row.originalStartsAt).toBeUndefined();
  expect(await t.run(async (ctx) => await ctx.db.query("appointments").take(10))).toHaveLength(1);
});

test("TI2-110: Estudiante dueño y Profesional revocado no registran la atención", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedProfessional(t, "ti110-denied-pro");
  const student = await seedStudent(t, "ti110-denied-est");
  const accompaniment = await seedAccompaniment(t, student);
  await seedTi98Assignment(t, accompaniment, pro, "revoked");
  const appointmentId = await seedTi110Appointment(t, {
    accompanimentId: accompaniment,
    studentId: student,
    professionalId: pro,
  });

  const transitions: PersistedTransition[] = [];
  const asStudent = await recordTi110(t, {
    tokenIdentifier: identityFor("ti110-denied-est", "ti110-denied-est@alu.uct.cl").tokenIdentifier,
    appointmentId,
    outcome: "completed",
    transitions,
  });
  if (!isErrorResult(asStudent)) throw new Error("Se esperaba denegar al Estudiante");
  expect(asStudent.error.code).toBe("unauthorized");

  const asRevokedProfessional = await recordTi110(t, {
    tokenIdentifier: identityFor("ti110-denied-pro", "ti110-denied-pro@uct.cl").tokenIdentifier,
    appointmentId,
    outcome: "completed",
    transitions,
  });
  if (!isErrorResult(asRevokedProfessional)) {
    throw new Error("Se esperaba denegar al Profesional revocado");
  }
  expect(asRevokedProfessional.error.code).toBe("unauthorized");

  expect(transitions).toHaveLength(0);
  const row = await getTi109(t, appointmentId);
  if (row === null) throw new Error("Se esperaba la atención intacta");
  expect(row).toMatchObject({
    status: "scheduled",
    startsAt: TI98_SLOT_START,
    endsAt: TI98_SLOT_END,
  });
  expect(await t.run(async (ctx) => await ctx.db.query("appointments").take(10))).toHaveLength(1);
});

test("TI2-110: el registro conserva la fecha original de una atención reagendada", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedProfessional(t, "ti110-original-pro");
  const student = await seedStudent(t, "ti110-original-est");
  const accompaniment = await seedAccompaniment(t, student);
  await seedTi98Assignment(t, accompaniment, pro);
  const appointmentId = await seedTi110Appointment(t, {
    accompanimentId: accompaniment,
    studentId: student,
    professionalId: pro,
    status: "rescheduled",
    originalStartsAt: TI109_ORIGINAL_START,
  });

  const transitions: PersistedTransition[] = [];
  const result = await recordTi110(t, {
    tokenIdentifier: identityFor("ti110-original-pro", "ti110-original-pro@uct.cl").tokenIdentifier,
    appointmentId,
    outcome: "completed",
    transitions,
  });
  if (!isOkResult(result)) throw new Error("Se esperaba registrar la realización");

  expect(transitions).toEqual([
    {
      appointmentId,
      fields: { status: "completed", originalStartsAt: TI109_ORIGINAL_START },
    },
  ]);
  const row = await getTi109(t, appointmentId);
  if (row === null) throw new Error("Se esperaba la atención registrada");
  expect(row).toMatchObject({
    status: "completed",
    originalStartsAt: TI109_ORIGINAL_START,
    startsAt: TI98_SLOT_START,
    endsAt: TI98_SLOT_END,
  });
});
