/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

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

/** Cantidad de solicitudes persistidas. */
async function countRequests(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    return (await ctx.db.query("requests").collect()).length;
  });
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
  expect(await countRequests(t)).toBe(0);
});

test("Necesidad sobre el tope se rechaza como error operativo sin persistir", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, { subject: "ti26-est-3", email: "ti26-est-3@alu.uct.cl", role: "student" });

  const asStudent = t.withIdentity(identityFor("ti26-est-3", "ti26-est-3@alu.uct.cl"));
  await expect(
    asStudent.mutation(api.presentation.requests.createRequest, {
      accessNeeds: "x".repeat(2001),
    }),
  ).rejects.toThrow("máximo");
  expect(await countRequests(t)).toBe(0);
});

test("Toma y operación ajena se deniegan con error genérico sin modificar nada", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti26-est-4",
    email: "ti26-est-4@alu.uct.cl",
    role: "student",
  });
  await seedUser(t, { subject: "ti26-pro-1", email: "ti26-pro-1@uct.cl", role: "professional" });
  const requestId = await t.mutation(internal.requests.createTestRequest, {
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
  const untouched = await t.query(internal.requests.getRequestById, { id: requestId });
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
  const enabledId = await asAdmin.mutation(internal.accounts.enableIntern, { userId: internId });
  expect(enabledId).toEqual(internId);

  // Un Estudiante no habilita cuentas por la vía guardada.
  const asStudent = t.withIdentity(identityFor("ti26-est-5", "ti26-est-5@alu.uct.cl"));
  await expect(
    asStudent.mutation(internal.accounts.enableIntern, { userId: otherId }),
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
  await asBootstrap.mutation(internal.assignments.assign, {
    accompanimentId,
    userId: proId,
    assignedRole: "professional",
  });
  const asPro = t.withIdentity(identityFor("ti26-pro-2", "ti26-pro-2@uct.cl"));
  await asPro.mutation(internal.assignments.assign, {
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
    asIntern.mutation(internal.assignments.assign, {
      accompanimentId,
      userId: internId,
      assignedRole: "intern",
    }),
  ).rejects.toThrow("No autorizado");
});
