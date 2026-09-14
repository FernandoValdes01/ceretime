/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import { SPRINT_1_REQUEST_STATES } from "./domain/request/state";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ISSUER = "https://accounts.google.com";

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

/**
 * Prueba de integración para la entidad 'requests' utilizando 'convex-test'
 * con el runner Vitest del monorepo.
 */
test("Persistencia de solicitud: crear, consultar y verificar estado en Convex", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti16-est-1");

  // Datos ficticios de la solicitud de prueba
  const dummyRequestData = {
    studentId,
    status: "received" as const,
    accessNeeds: "Necesidad de acceso ficticia",
  };

  // 1. Ejecutar la mutación interna real de Convex
  const createdId = await t.mutation(internal.requests.createTestRequest, dummyRequestData);
  expect(createdId).toBeDefined();

  // 2. Ejecutar la consulta interna real de Convex
  const fetchedRequest = await t.query(internal.requests.getRequestById, {
    id: createdId,
  });

  // 3. Validar datos contra la base de datos de Convex
  expect(fetchedRequest).not.toBeNull();
  expect(fetchedRequest?.studentId).toEqual(studentId);
  expect(fetchedRequest?.status).toBe(dummyRequestData.status);
  expect(fetchedRequest?.accessNeeds).toBe(dummyRequestData.accessNeeds);
  expect(fetchedRequest?.createdAt).toBeDefined();
});

test("Consultar una solicitud inexistente retorna null", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti16-est-2");

  // ID con formato válido que no existe: se inserta y elimina una solicitud ficticia
  const missingId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("requests", {
      studentId,
      status: "received",
      accessNeeds: "Temporal ficticia",
      createdAt: 1,
    });
    await ctx.db.delete(id);
    return id;
  });

  // La consulta de un ID inexistente debe retornar null
  const fetchedRequest = await t.query(internal.requests.getRequestById, {
    id: missingId,
  });
  expect(fetchedRequest).toBeNull();
});

test("El estado persiste exactamente los literales de Sprint 1 del dominio", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti16-est-3");

  // Cada estado de Sprint 1 debe aceptarse tal cual lo define el dominio
  for (const status of SPRINT_1_REQUEST_STATES) {
    const createdId = await t.mutation(internal.requests.createTestRequest, {
      studentId,
      status,
      accessNeeds: "Necesidad de acceso ficticia",
    });
    const fetchedRequest = await t.query(internal.requests.getRequestById, {
      id: createdId,
    });
    expect(fetchedRequest?.status).toBe(status);
  }

  // Un estado futuro declarado pero no habilitado debe ser rechazado
  await expect(
    t.mutation(internal.requests.createTestRequest, {
      studentId,
      status: "cancelled" as never,
      accessNeeds: "Necesidad de acceso ficticia",
    }),
  ).rejects.toThrow("Validator error");
});
