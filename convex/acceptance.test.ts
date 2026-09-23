/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

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

/** Cuenta acompañamientos abiertos desde la solicitud. */
async function countAccompanimentsFor(t: ReturnType<typeof convexTest>, requestId: Id<"requests">) {
  return await t.run(async (ctx) => {
    return (
      await ctx.db
        .query("accompaniments")
        .withIndex("by_request", (q) => q.eq("requestId", requestId))
        .collect()
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
  const accepted = await t.query(internal.requests.getRequestById, {
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

  // La repetición —como la segunda de dos concurrentes serializadas— se rechaza
  await expect(
    asProfessional.mutation(api.presentation.requests.acceptRequest, {
      requestId: created._id as Id<"requests">,
      objective: "Otro objetivo ficticio",
    }),
  ).rejects.toThrow("ya fue aceptada");
  expect(await countAccompanimentsFor(t, created._id as Id<"requests">)).toBe(1);
  const accepted = await t.query(internal.requests.getRequestById, {
    id: created._id as Id<"requests">,
  });
  expect(accepted?.status).toBe("accepted");
});

test("Sin toma del Profesional se deniega sin modificar nada", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti24-est-4");
  const requestId = await t.mutation(internal.requests.createTestRequest, {
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
  const untouched = await t.query(internal.requests.getRequestById, { id: requestId });
  expect(untouched?.status).toBe("under_review");
  expect(await countAccompanimentsFor(t, requestId)).toBe(0);
});

test("Estudiante o anónimo no aceptan solicitudes", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti24-est-5");
  const requestId = await t.mutation(internal.requests.createTestRequest, {
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
  const requestId = await t.mutation(internal.requests.createTestRequest, {
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
  const untouched = await t.query(internal.requests.getRequestById, { id: requestId });
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
  const untouched = await t.query(internal.requests.getRequestById, {
    id: created._id as Id<"requests">,
  });
  expect(untouched?.status).toBe("under_review");
  expect(await countAccompanimentsFor(t, created._id as Id<"requests">)).toBe(0);
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
