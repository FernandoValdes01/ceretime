/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { SPRINT_1_REQUEST_STATES } from "../domain/requests/state";
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
  const createdId = await t.mutation(
    internal.operations.requests.createTestRequest,
    dummyRequestData,
  );
  expect(createdId).toBeDefined();

  // 2. Ejecutar la consulta interna real de Convex
  const fetchedRequest = await t.query(internal.operations.requests.getRequestById, {
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
  const fetchedRequest = await t.query(internal.operations.requests.getRequestById, {
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
    const createdId = await t.mutation(internal.operations.requests.createTestRequest, {
      studentId,
      status,
      accessNeeds: "Necesidad de acceso ficticia",
    });
    const fetchedRequest = await t.query(internal.operations.requests.getRequestById, {
      id: createdId,
    });
    expect(fetchedRequest?.status).toBe(status);
  }

  // La semilla solo crea solicitudes abiertas o aceptadas: un cierre de
  // TI2-85 se persiste por su caso de uso, no por esta vía
  await expect(
    t.mutation(internal.operations.requests.createTestRequest, {
      studentId,
      status: "cancelled" as never,
      accessNeeds: "Necesidad de acceso ficticia",
    }),
  ).rejects.toThrow("Validator error");
});

test("Estudiante registra su solicitud y recibe la entidad pública", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  await seedStudent(t, "ti9-est-1");

  // La solicitud se registra en estado recibido a nombre del propio Estudiante
  const asStudent = t.withIdentity(identityFor("ti9-est-1", "ti9-est-1@alu.uct.cl"));
  const created = await asStudent.mutation(api.presentation.requests.createRequest, {
    accessNeeds: "Necesidad de acceso ficticia",
  });
  expect(created.status).toBe("received");
  expect(created.accessNeeds).toBe("Necesidad de acceso ficticia");
  expect(created.studentId).toBeDefined();
  expect(created.createdAt).toBeDefined();
});

test("Sin identidad o sin rol Estudiante se deniega el registro", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);

  // Sin identidad no se registra nada
  await expect(
    t.mutation(api.presentation.requests.createRequest, {
      accessNeeds: "Necesidad de acceso ficticia",
    }),
  ).rejects.toThrow("No autorizado");

  // Un Profesional no registra solicitudes de Estudiante
  await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "ti9-pro-1@uct.cl",
      fullName: "Profesional Ficticio",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|ti9-pro-1`,
    });
  });
  const asProfessional = t.withIdentity(identityFor("ti9-pro-1", "ti9-pro-1@uct.cl"));
  await expect(
    asProfessional.mutation(api.presentation.requests.createRequest, {
      accessNeeds: "Necesidad de acceso ficticia",
    }),
  ).rejects.toThrow("No autorizado");
});

test("Estudiante lista solo sus solicitudes propias", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  await seedStudent(t, "ti9-est-2");
  await seedStudent(t, "ti9-est-3");

  // Cada estudiante registra su propia solicitud
  const asFirst = t.withIdentity(identityFor("ti9-est-2", "ti9-est-2@alu.uct.cl"));
  await asFirst.mutation(api.presentation.requests.createRequest, {
    accessNeeds: "Primera ficticia",
  });
  const asSecond = t.withIdentity(identityFor("ti9-est-3", "ti9-est-3@alu.uct.cl"));
  await asSecond.mutation(api.presentation.requests.createRequest, {
    accessNeeds: "Segunda ficticia",
  });

  // Cada uno ve solo la suya
  const firstPage = await asFirst.query(api.presentation.requests.listOwnRequests, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(firstPage.page).toHaveLength(1);
  expect(firstPage.page[0]?.accessNeeds).toBe("Primera ficticia");

  const secondPage = await asSecond.query(api.presentation.requests.listOwnRequests, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(secondPage.page).toHaveLength(1);
  expect(secondPage.page[0]?.accessNeeds).toBe("Segunda ficticia");
});

test("Sin identidad o sin rol Estudiante se deniega el listado propio", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);

  // Sin identidad no se lista nada
  await expect(
    t.query(api.presentation.requests.listOwnRequests, {
      paginationOpts: { numItems: 10, cursor: null },
    }),
  ).rejects.toThrow("No autorizado");

  // Un Profesional no lista solicitudes propias
  await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "ti9-pro-2@uct.cl",
      fullName: "Profesional Ficticio",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|ti9-pro-2`,
    });
  });
  const asProfessional = t.withIdentity(identityFor("ti9-pro-2", "ti9-pro-2@uct.cl"));
  await expect(
    asProfessional.query(api.presentation.requests.listOwnRequests, {
      paginationOpts: { numItems: 10, cursor: null },
    }),
  ).rejects.toThrow("No autorizado");
});

test("Profesional lista solo solicitudes tomadas", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti9-est-9");
  const takenId = await t.mutation(internal.operations.requests.createTestRequest, {
    studentId,
    status: "received",
    accessNeeds: "Tomada ficticia",
  });
  await t.mutation(internal.operations.requests.createTestRequest, {
    studentId,
    status: "received",
    accessNeeds: "Suelta ficticia",
  });
  await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "ti9-pro-6@uct.cl",
      fullName: "Profesional Ficticio",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|ti9-pro-6`,
    });
  });

  // Toma una y lista: ve la tomada y no la suelta
  const asProfessional = t.withIdentity(identityFor("ti9-pro-6", "ti9-pro-6@uct.cl"));
  await asProfessional.mutation(api.presentation.requests.takeRequest, {
    requestId: takenId,
  });
  const page = await asProfessional.query(api.presentation.requests.listAuthorizedRequests, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(page.page.map((item) => item._id)).toEqual([takenId]);
});

test("Sin rol Profesional se deniega el listado autorizado", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  await seedStudent(t, "ti9-est-10");

  // Sin identidad no se lista nada
  await expect(
    t.query(api.presentation.requests.listAuthorizedRequests, {
      paginationOpts: { numItems: 10, cursor: null },
    }),
  ).rejects.toThrow("No autorizado");

  // Un Estudiante no lista el conjunto autorizado
  const asStudent = t.withIdentity(identityFor("ti9-est-10", "ti9-est-10@alu.uct.cl"));
  await expect(
    asStudent.query(api.presentation.requests.listAuthorizedRequests, {
      paginationOpts: { numItems: 10, cursor: null },
    }),
  ).rejects.toThrow("No autorizado");
});

test("Fila repetida manual no duplica en el listado", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti9-est-11");
  const takenId = await t.mutation(internal.operations.requests.createTestRequest, {
    studentId,
    status: "received",
    accessNeeds: "Tomada ficticia",
  });
  const proId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "ti9-pro-8@uct.cl",
      fullName: "Profesional Ficticio",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|ti9-pro-8`,
    });
  });
  const asProfessional = t.withIdentity(identityFor("ti9-pro-8", "ti9-pro-8@uct.cl"));
  // Tras la toma guardada aparece una sola vez
  await asProfessional.mutation(api.presentation.requests.takeRequest, {
    requestId: takenId,
  });

  // Toma repetida escrita fuera de la vía protegida: no fija el puntero
  await t.run(async (ctx) => {
    return await ctx.db.insert("requestAssignments", {
      requestId: takenId,
      userId: proId,
      grantedBy: proId,
      grantedAt: 1,
      status: "active",
    });
  });
  const full = await asProfessional.query(api.presentation.requests.listAuthorizedRequests, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(full.page.map((item) => item._id)).toEqual([takenId]);
});

test("Fila manual sin puntero aparece por la fuente legacy", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti9-est-19");
  const requestId = await t.mutation(internal.operations.requests.createTestRequest, {
    studentId,
    status: "received",
    accessNeeds: "Suelta ficticia",
  });
  const proId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "ti9-pro-17@uct.cl",
      fullName: "Profesional Ficticio",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|ti9-pro-17`,
    });
  });
  // Fila manual sin puntero: visible por la fuente legacy
  await t.run(async (ctx) => {
    return await ctx.db.insert("requestAssignments", {
      requestId,
      userId: proId,
      grantedBy: proId,
      grantedAt: 1,
      status: "active",
    });
  });
  const asProfessional = t.withIdentity(identityFor("ti9-pro-17", "ti9-pro-17@uct.cl"));
  const found = await asProfessional.query(api.presentation.requests.listAuthorizedRequests, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(found.page.map((item) => item._id)).toEqual([requestId]);
});

test("Legacy duplicadas en páginas distintas salen una sola vez", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti9-est-20");
  const requestId = await t.mutation(internal.operations.requests.createTestRequest, {
    studentId,
    status: "received",
    accessNeeds: "Duplicada ficticia",
  });
  const proId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "ti9-pro-18@uct.cl",
      fullName: "Profesional Ficticio",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|ti9-pro-18`,
    });
  });
  // Dos filas legacy activas para la misma solicitud
  for (let round = 0; round < 2; round++) {
    await t.run(async (ctx) => {
      return await ctx.db.insert("requestAssignments", {
        requestId,
        userId: proId,
        grantedBy: proId,
        grantedAt: 1,
        status: "active",
      });
    });
  }

  // Caminar de a una emite la solicitud una sola vez en total
  const asProfessional = t.withIdentity(identityFor("ti9-pro-18", "ti9-pro-18@uct.cl"));
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let round = 0; round < 5; round++) {
    const page: FunctionReturnType<typeof api.presentation.requests.listAuthorizedRequests> =
      await asProfessional.query(api.presentation.requests.listAuthorizedRequests, {
        paginationOpts: { numItems: 1, cursor },
      });
    for (const item of page.page) seen.push(item._id);
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  expect(seen).toEqual([requestId]);
});

test("Caminar tomas guardadas no repite ninguna solicitud", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti9-est-18");
  const expected: Id<"requests">[] = [];
  for (const tag of ["a", "b", "c"]) {
    expected.push(
      await t.mutation(internal.operations.requests.createTestRequest, {
        studentId,
        status: "received",
        accessNeeds: `Tomada ${tag} ficticia`,
      }),
    );
  }
  await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "ti9-pro-16@uct.cl",
      fullName: "Profesional Ficticio",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|ti9-pro-16`,
    });
  });

  // Tres tomas por la vía guardada (la única que crea filas)
  const asProfessional = t.withIdentity(identityFor("ti9-pro-16", "ti9-pro-16@uct.cl"));
  for (const requestId of expected) {
    await asProfessional.mutation(api.presentation.requests.takeRequest, {
      requestId,
    });
  }

  // Caminar de a una trae las tres, únicas y completas
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let round = 0; round < 5; round++) {
    const page: FunctionReturnType<typeof api.presentation.requests.listAuthorizedRequests> =
      await asProfessional.query(api.presentation.requests.listAuthorizedRequests, {
        paginationOpts: { numItems: 1, cursor },
      });
    for (const item of page.page) seen.push(item._id);
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  expect(seen.sort()).toEqual(expected.sort());
  expect(new Set(seen).size).toBe(seen.length);
});

test("Profesional toma una solicitud y la retoma se rechaza", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti9-est-12");
  const requestId = await t.mutation(internal.operations.requests.createTestRequest, {
    studentId,
    status: "received",
    accessNeeds: "Tomada ficticia",
  });
  await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "ti9-pro-9@uct.cl",
      fullName: "Profesional Ficticio",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|ti9-pro-9`,
    });
  });

  // Toma una vez y la retoma se rechaza por estado
  const asProfessional = t.withIdentity(identityFor("ti9-pro-9", "ti9-pro-9@uct.cl"));
  const taken = await asProfessional.mutation(api.presentation.requests.takeRequest, {
    requestId,
  });
  expect(taken._id).toEqual(requestId);
  expect(taken.status).toBe("under_review");

  // La toma fija el puntero en la misma transacción: fila y listado
  // no pueden divergir por la vía guardada
  const pointed = await t.query(internal.operations.requests.getRequestById, { id: requestId });
  const proId = await t.run(async (ctx) => {
    const profile = await ctx.db
      .query("users")
      .withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", `${ISSUER}|ti9-pro-9`))
      .unique();
    if (profile === null) throw new Error("Perfil ficticio ausente");
    return profile._id;
  });
  expect(pointed?.takenBy).toEqual(proId);
  await expect(
    asProfessional.mutation(api.presentation.requests.takeRequest, { requestId }),
  ).rejects.toThrow("recibidas");

  // Una toma activa sobre una recibida también se rechaza como duplicada
  const freshId = await t.mutation(internal.operations.requests.createTestRequest, {
    studentId,
    status: "received",
    accessNeeds: "Otra tomada ficticia",
  });
  await t.run(async (ctx) => {
    return await ctx.db.insert("requestAssignments", {
      requestId: freshId,
      userId: proId,
      grantedBy: proId,
      grantedAt: 1,
      status: "active",
    });
  });
  await expect(
    asProfessional.mutation(api.presentation.requests.takeRequest, { requestId: freshId }),
  ).rejects.toThrow("Ya tomaste");

  // Sin rol Profesional no se toma
  const asStudent = t.withIdentity(identityFor("ti9-est-12", "ti9-est-12@alu.uct.cl"));
  await expect(
    asStudent.mutation(api.presentation.requests.takeRequest, { requestId }),
  ).rejects.toThrow("No autorizado");
});

test("Tomar exige solicitud recibida sin otra toma activa", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti9-est-16");
  const reviewingId = await t.mutation(internal.operations.requests.createTestRequest, {
    studentId,
    status: "under_review",
    accessNeeds: "En revisión ficticia",
  });
  await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "ti9-pro-14@uct.cl",
      fullName: "Profesional Ficticio",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|ti9-pro-14`,
    });
  });

  // Fuera de recibida no se toma, aunque no exista toma previa
  const asProfessional = t.withIdentity(identityFor("ti9-pro-14", "ti9-pro-14@uct.cl"));
  await expect(
    asProfessional.mutation(api.presentation.requests.takeRequest, {
      requestId: reviewingId,
    }),
  ).rejects.toThrow("recibidas");
});

test("Bandeja muestra solo recibidas sin datos sensibles", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti9-est-17");
  const receivedId = await t.mutation(internal.operations.requests.createTestRequest, {
    studentId,
    status: "received",
    accessNeeds: "Recibida ficticia",
  });
  await t.mutation(internal.operations.requests.createTestRequest, {
    studentId,
    status: "under_review",
    accessNeeds: "En revisión ficticia",
  });
  await t.mutation(internal.operations.requests.createTestRequest, {
    studentId,
    status: "accepted",
    accessNeeds: "Aceptada ficticia",
  });
  await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "ti9-pro-15@uct.cl",
      fullName: "Profesional Ficticio",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|ti9-pro-15`,
    });
  });

  // Solo la recibida aparece y sin accessNeeds
  const asProfessional = t.withIdentity(identityFor("ti9-pro-15", "ti9-pro-15@uct.cl"));
  const page = await asProfessional.query(api.presentation.requests.listOpenRequests, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(page.page.map((item) => item._id)).toEqual([receivedId]);
  for (const item of page.page) {
    expect(item).not.toHaveProperty("accessNeeds");
  }

  // Sin rol Profesional no se descubre nada
  const asStudent = t.withIdentity(identityFor("ti9-est-17", "ti9-est-17@alu.uct.cl"));
  await expect(
    asStudent.query(api.presentation.requests.listOpenRequests, {
      paginationOpts: { numItems: 10, cursor: null },
    }),
  ).rejects.toThrow("No autorizado");
});

test("Tomar una solicitud recibida inicia su revisión con registro", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti9-est-14");
  const requestId = await t.mutation(internal.operations.requests.createTestRequest, {
    studentId,
    status: "received",
    accessNeeds: "Tomada ficticia",
  });
  await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "ti9-pro-12@uct.cl",
      fullName: "Profesional Ficticio",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|ti9-pro-12`,
    });
  });

  // La toma mueve a en revisión y lo registra sin motivo
  const asProfessional = t.withIdentity(identityFor("ti9-pro-12", "ti9-pro-12@uct.cl"));
  const taken = await asProfessional.mutation(api.presentation.requests.takeRequest, {
    requestId,
  });
  expect(taken.status).toBe("under_review");
  const logged = await t.run(async (ctx) => {
    return await ctx.db
      .query("requestTransitions")
      .withIndex("by_request", (q) => q.eq("requestId", requestId))
      .collect();
  });
  expect(logged).toHaveLength(1);
  expect(logged[0]?.from).toBe("received");
  expect(logged[0]?.to).toBe("under_review");
  expect(logged[0]?.reason).toBeUndefined();
});

test("Flujo público completo: registrar, tomar y pedir información", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  await seedStudent(t, "ti9-est-15");
  await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "ti9-pro-13@uct.cl",
      fullName: "Profesional Ficticio",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|ti9-pro-13`,
    });
  });

  // 1. El Estudiante registra y queda recibida
  const asStudent = t.withIdentity(identityFor("ti9-est-15", "ti9-est-15@alu.uct.cl"));
  const created = await asStudent.mutation(api.presentation.requests.createRequest, {
    accessNeeds: "Necesidad de acceso ficticia",
  });
  expect(created.status).toBe("received");

  // 2. El Profesional toma e inicia la revisión
  const asProfessional = t.withIdentity(identityFor("ti9-pro-13", "ti9-pro-13@uct.cl"));
  const taken = await asProfessional.mutation(api.presentation.requests.takeRequest, {
    requestId: created._id as Id<"requests">,
  });
  expect(taken.status).toBe("under_review");

  // 3. El Profesional pide información adicional con motivo
  const updated = await asProfessional.mutation(
    api.presentation.requests.requestAdditionalInformation,
    { requestId: created._id as Id<"requests">, reason: "Falta el horario disponible" },
  );
  expect(updated.status).toBe("awaiting_information_or_acceptance");
});

test("Profesional pide información adicional en solicitud en revisión", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti9-est-4");
  const proId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "ti9-pro-3@uct.cl",
      fullName: "Profesional Ficticio",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|ti9-pro-3`,
    });
  });
  const requestId = await t.mutation(internal.operations.requests.createTestRequest, {
    studentId,
    status: "received",
    accessNeeds: "Necesidad de acceso ficticia",
  });

  // El Profesional toma (inicia revisión) y pide información con motivo
  const asProfessional = t.withIdentity(identityFor("ti9-pro-3", "ti9-pro-3@uct.cl"));
  await asProfessional.mutation(api.presentation.requests.takeRequest, { requestId });
  const updated = await asProfessional.mutation(
    api.presentation.requests.requestAdditionalInformation,
    { requestId, reason: "Falta el horario disponible" },
  );
  expect(updated.status).toBe("awaiting_information_or_acceptance");

  // El cambio de información queda registrado con motivo, actor y fecha
  const logged = await t.run(async (ctx) => {
    return await ctx.db
      .query("requestTransitions")
      .withIndex("by_request", (q) => q.eq("requestId", requestId))
      .collect();
  });
  const infoChange = logged.find((row) => row.to === "awaiting_information_or_acceptance");
  expect(infoChange?.from).toBe("under_review");
  expect(infoChange?.reason).toBe("Falta el horario disponible");
  expect(infoChange?.actorId).toEqual(proId);
  expect(infoChange?.occurredAt).toBeDefined();

  // Sin motivo se rechaza indicando qué corregir, sin modificar nada
  const pendingId = await t.mutation(internal.operations.requests.createTestRequest, {
    studentId,
    status: "received",
    accessNeeds: "Otra necesidad ficticia",
  });
  await asProfessional.mutation(api.presentation.requests.takeRequest, {
    requestId: pendingId,
  });
  await expect(
    asProfessional.mutation(api.presentation.requests.requestAdditionalInformation, {
      requestId: pendingId,
      reason: "  ",
    }),
  ).rejects.toThrow("motivo");
  const untouched = await t.query(internal.operations.requests.getRequestById, { id: pendingId });
  expect(untouched?.status).toBe("under_review");
});

test("Pedir información se deniega sin Profesional vigente o en estado inválido", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti9-est-5");
  const receivedId = await t.mutation(internal.operations.requests.createTestRequest, {
    studentId,
    status: "received",
    accessNeeds: "Necesidad de acceso ficticia",
  });

  // Sin identidad no se opera
  await expect(
    t.mutation(api.presentation.requests.requestAdditionalInformation, {
      requestId: receivedId,
      reason: "Falta el horario disponible",
    }),
  ).rejects.toThrow("No autorizado");

  // Un Estudiante no pide información adicional
  const asStudent = t.withIdentity(identityFor("ti9-est-5", "ti9-est-5@alu.uct.cl"));
  await expect(
    asStudent.mutation(api.presentation.requests.requestAdditionalInformation, {
      requestId: receivedId,
      reason: "Falta el horario disponible",
    }),
  ).rejects.toThrow("No autorizado");
});

test("Otro Profesional sin toma recibe denegación sin modificar estado", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti9-est-13");
  const requestId = await t.mutation(internal.operations.requests.createTestRequest, {
    studentId,
    status: "under_review",
    accessNeeds: "Necesidad de acceso ficticia",
  });
  await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "ti9-pro-11@uct.cl",
      fullName: "Profesional Ficticio",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|ti9-pro-11`,
    });
  });

  // Profesional vigente pero sin toma explícita: denegado sin cambios
  const asStranger = t.withIdentity(identityFor("ti9-pro-11", "ti9-pro-11@uct.cl"));
  await expect(
    asStranger.mutation(api.presentation.requests.requestAdditionalInformation, {
      requestId,
      reason: "Falta el horario disponible",
    }),
  ).rejects.toThrow("No autorizado");
  const untouched = await t.query(internal.operations.requests.getRequestById, { id: requestId });
  expect(untouched?.status).toBe("under_review");
});

/*
 * TI2-85 y TI2-141: cancelar y cerrar sin acompañamiento. Desde TI2-141 los
 * dos casos de uso tienen entrada pública, así que estas pruebas pasan por
 * `api.presentation.requests.*` con la identidad de la sesión: lo que se
 * comprueba es el borde completo, no solo el caso de uso.
 */

type SchemaTest = TestConvex<typeof schema>;
type Identity = ReturnType<typeof identityFor> | null;

const ENABLED = { institutionalStatus: "enabled", accountStatus: "active" } as const;

/** Perfil ficticio con rol y vigencia a elección. */
async function seedProfile(
  t: SchemaTest,
  subject: string,
  role: Doc<"users">["role"],
  status: Pick<Doc<"users">, "institutionalStatus" | "accountStatus"> = ENABLED,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: `${subject}@uct.cl`,
      fullName: "Perfil Ficticio",
      role,
      ...status,
      tokenIdentifier: `${ISSUER}|${subject}`,
    });
  });
}

const identityOf = (subject: string) => identityFor(subject, `${subject}@uct.cl`);

/** Solicitud ficticia insertada directo en el estado indicado. */
async function seedRequestIn(
  t: SchemaTest,
  studentId: Id<"users">,
  status: Doc<"requests">["status"],
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("requests", {
      studentId,
      status,
      accessNeeds: "Necesidad de acceso ficticia",
      createdAt: Date.now(),
    });
  });
}

/** Toma ficticia del usuario sobre la solicitud, activa o revocada. */
async function seedTake(
  t: SchemaTest,
  requestId: Id<"requests">,
  userId: Id<"users">,
  status: Doc<"requestAssignments">["status"] = "active",
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("requestAssignments", {
      requestId,
      userId,
      grantedBy: userId,
      grantedAt: 1,
      status,
    });
  });
}

/** Estado, razón de cierre, registro de cambios y acompañamientos de la solicitud. */
async function snapshotOf(t: SchemaTest, requestId: Id<"requests">) {
  return await t.run(async (ctx) => {
    const request = await ctx.db.get(requestId);
    const transitions = await ctx.db
      .query("requestTransitions")
      .withIndex("by_request", (q) => q.eq("requestId", requestId))
      .collect();
    // Filtro en memoria sobre datos mínimos, como en `acceptance.test.ts`.
    const accompaniments = await ctx.db
      .query("accompaniments")
      .filter((q) => q.eq(q.field("requestId"), requestId))
      .take(2);
    return {
      status: request?.status,
      closureReason: request?.closureReason,
      transitions,
      accompaniments: accompaniments.length,
    };
  });
}

/** Sesión de la identidad, o sin sesión cuando es `null`. */
function sessionOf(t: SchemaTest, identity: Identity) {
  return identity === null ? t : t.withIdentity(identity);
}

function cancelAs(t: SchemaTest, identity: Identity, requestId: Id<"requests">, reason: string) {
  return sessionOf(t, identity).mutation(api.presentation.requests.cancelRequest, {
    requestId,
    reason,
  });
}

function closeAs(t: SchemaTest, identity: Identity, requestId: Id<"requests">, reason: string) {
  return sessionOf(t, identity).mutation(
    api.presentation.requests.closeRequestWithoutAccompaniment,
    { requestId, reason },
  );
}

const OPEN_FOR_STUDENT = [
  "received",
  "under_review",
  "awaiting_information_or_acceptance",
] as const;

test("TI2-85: el Estudiante cancela su solicitud abierta y queda el registro con motivo", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedProfile(t, "ti85-est-1", "student");

  for (const from of OPEN_FOR_STUDENT) {
    const requestId = await seedRequestIn(t, studentId, from);
    const cancelled = await cancelAs(
      t,
      identityOf("ti85-est-1"),
      requestId,
      "  Ya recibí el apoyo por otra vía  ",
    );
    expect(cancelled).toMatchObject({ _id: requestId, studentId, status: "cancelled" });

    // Estado y registro en la misma transacción, con el Estudiante como actor
    // y el motivo recortado; no se abre ningún acompañamiento
    const after = await snapshotOf(t, requestId);
    expect(after.status).toBe("cancelled");
    // Cancelar no escribe razón de cierre: el motivo del Estudiante queda en el registro
    expect(after.closureReason).toBeUndefined();
    expect(after.accompaniments).toBe(0);
    expect(after.transitions).toHaveLength(1);
    expect(after.transitions[0]).toMatchObject({
      from,
      to: "cancelled",
      actorId: studentId,
      reason: "Ya recibí el apoyo por otra vía",
    });
    expect(after.transitions[0]?.occurredAt).toBeGreaterThan(0);
  }
});

test("TI2-85: cancelar exige motivo y el rechazo no deja escrituras", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedProfile(t, "ti85-est-2", "student");
  const requestId = await seedRequestIn(t, studentId, "under_review");
  const before = await snapshotOf(t, requestId);

  for (const reason of ["", "   "]) {
    await expect(cancelAs(t, identityOf("ti85-est-2"), requestId, reason)).rejects.toThrow(
      "Se requiere el motivo para cancelar la solicitud.",
    );
  }
  expect(await snapshotOf(t, requestId)).toEqual(before);
});

test("TI2-85: cancelar una solicitud ajena o inexistente se deniega igual, sin escribir", async () => {
  const t = convexTest(schema, modules);
  const ownerId = await seedProfile(t, "ti85-est-3", "student");
  await seedProfile(t, "ti85-est-4", "student");
  const foreignId = await seedRequestIn(t, ownerId, "received");
  const missingId = await seedRequestIn(t, ownerId, "received");
  await t.run(async (ctx) => {
    await ctx.db.delete(missingId);
  });
  const before = await snapshotOf(t, foreignId);

  // Otro Estudiante vigente no distingue una solicitud ajena de una inexistente
  for (const requestId of [foreignId, missingId]) {
    await expect(
      cancelAs(t, identityOf("ti85-est-4"), requestId, "Motivo ficticio"),
    ).rejects.toThrow("No autorizado");
  }
  expect(await snapshotOf(t, foreignId)).toEqual(before);
});

test("TI2-85: sin identidad, sin rol Estudiante o sin cuenta vigente no se cancela", async () => {
  const t = convexTest(schema, modules);
  const ownerId = await seedProfile(t, "ti85-est-5", "student");
  const requestId = await seedRequestIn(t, ownerId, "received");
  const before = await snapshotOf(t, requestId);

  for (const identity of [null, identityOf("ti85-sin-perfil")]) {
    await expect(cancelAs(t, identity, requestId, "Motivo ficticio")).rejects.toThrow(
      "No autorizado",
    );
  }
  expect(await snapshotOf(t, requestId)).toEqual(before);

  // Otro rol sobre una solicitud a su propio nombre: la denegación sale del
  // rol, no de la pertenencia
  for (const [subject, role] of [
    ["ti85-pro-1", "professional"],
    ["ti85-int-1", "intern"],
    ["ti85-adm-1", "admin"],
  ] as const) {
    const profileId = await seedProfile(t, subject, role);
    const ownId = await seedRequestIn(t, profileId, "received");
    await expect(cancelAs(t, identityOf(subject), ownId, "Motivo ficticio")).rejects.toThrow(
      "No autorizado",
    );
    expect((await snapshotOf(t, ownId)).status).toBe("received");
  }

  // Cuenta no vigente sobre su propia solicitud: la vigencia se exige antes
  // que la pertenencia
  for (const [subject, status] of [
    ["ti85-est-inh", { institutionalStatus: "disabled", accountStatus: "active" }],
    ["ti85-est-pen", { institutionalStatus: "pending", accountStatus: "active" }],
    ["ti85-est-ina", { institutionalStatus: "enabled", accountStatus: "inactive" }],
  ] as const) {
    const studentId = await seedProfile(t, subject, "student", status);
    const ownId = await seedRequestIn(t, studentId, "received");
    await expect(cancelAs(t, identityOf(subject), ownId, "Motivo ficticio")).rejects.toThrow(
      "No autorizado",
    );
    expect((await snapshotOf(t, ownId)).status).toBe("received");
  }
});

test("TI2-85: repetir la cancelación o cancelar una aceptada o cerrada se rechaza sin tocar el historial", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedProfile(t, "ti85-est-6", "student");
  const student = identityOf("ti85-est-6");

  // La segunda cancelación parte del estado que dejó la primera
  const requestId = await seedRequestIn(t, studentId, "received");
  await cancelAs(t, student, requestId, "Motivo ficticio");
  const afterFirst = await snapshotOf(t, requestId);
  await expect(cancelAs(t, student, requestId, "Otro motivo")).rejects.toThrow(
    "La solicitud no admite la cancelación en su estado actual.",
  );
  expect(await snapshotOf(t, requestId)).toEqual(afterFirst);
  expect(afterFirst.transitions).toHaveLength(1);

  for (const status of ["accepted", "closed_without_accompaniment"] as const) {
    const endedId = await seedRequestIn(t, studentId, status);
    await expect(cancelAs(t, student, endedId, "Motivo ficticio")).rejects.toThrow(
      "no admite la cancelación",
    );
    expect(await snapshotOf(t, endedId)).toEqual({
      status,
      closureReason: undefined,
      transitions: [],
      accompaniments: 0,
    });
  }
});

test("TI2-85: el Profesional con toma cierra sin acompañamiento desde revisión y desde espera", async () => {
  const t = convexTest(schema, modules);
  await seedStudent(t, "ti85-est-7");
  const proId = await seedProfile(t, "ti85-pro-2", "professional");
  const asStudent = t.withIdentity(identityFor("ti85-est-7", "ti85-est-7@alu.uct.cl"));
  const asProfessional = t.withIdentity(identityOf("ti85-pro-2"));

  // En revisión: registrar y tomar por la vía pública, cerrar por el caso de uso
  const reviewed = await asStudent.mutation(api.presentation.requests.createRequest, {
    accessNeeds: "Necesidad de acceso ficticia",
  });
  await asProfessional.mutation(api.presentation.requests.takeRequest, {
    requestId: reviewed._id,
  });
  const closed = await closeAs(
    t,
    identityOf("ti85-pro-2"),
    reviewed._id,
    "  La necesidad corresponde a otra unidad de la universidad  ",
  );
  expect(closed.status).toBe("closed_without_accompaniment");
  const afterReview = await snapshotOf(t, reviewed._id);
  expect(afterReview.status).toBe("closed_without_accompaniment");
  // La razón vigente queda en la fila, recortada e igual a la del registro
  expect(afterReview.closureReason).toBe(
    "La necesidad corresponde a otra unidad de la universidad",
  );
  expect(afterReview.accompaniments).toBe(0);
  expect(afterReview.transitions.map((row) => `${row.from} -> ${row.to}`)).toEqual([
    "received -> under_review",
    "under_review -> closed_without_accompaniment",
  ]);
  expect(afterReview.transitions[1]).toMatchObject({
    actorId: proId,
    reason: "La necesidad corresponde a otra unidad de la universidad",
  });

  // La toma queda activa como rastro de quién revisó
  const take = await t.run(async (ctx) => {
    return await ctx.db
      .query("requestAssignments")
      .withIndex("by_request_and_user_and_status", (q) =>
        q.eq("requestId", reviewed._id).eq("userId", proId).eq("status", "active"),
      )
      .take(2);
  });
  expect(take).toHaveLength(1);

  // En espera: tras pedir información también se puede cerrar
  const waiting = await asStudent.mutation(api.presentation.requests.createRequest, {
    accessNeeds: "Otra necesidad ficticia",
  });
  await asProfessional.mutation(api.presentation.requests.takeRequest, { requestId: waiting._id });
  await asProfessional.mutation(api.presentation.requests.requestAdditionalInformation, {
    requestId: waiting._id,
    reason: "Falta el horario en que puedes asistir",
  });
  await closeAs(t, identityOf("ti85-pro-2"), waiting._id, "No hubo respuesta en el plazo acordado");
  const afterWaiting = await snapshotOf(t, waiting._id);
  expect(afterWaiting.status).toBe("closed_without_accompaniment");
  expect(afterWaiting.accompaniments).toBe(0);
  expect(afterWaiting.transitions.at(-1)).toMatchObject({
    from: "awaiting_information_or_acceptance",
    to: "closed_without_accompaniment",
  });
});

test("TI2-85: cerrar exige toma activa; sin ella o con una revocada se deniega sin escribir", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedProfile(t, "ti85-est-8", "student");
  const takerId = await seedProfile(t, "ti85-pro-3", "professional");
  await seedProfile(t, "ti85-pro-4", "professional");
  const revokedId = await seedProfile(t, "ti85-pro-5", "professional");
  const requestId = await seedRequestIn(t, studentId, "under_review");
  await seedTake(t, requestId, takerId);
  await seedTake(t, requestId, revokedId, "revoked");
  const missingId = await seedRequestIn(t, studentId, "under_review");
  await t.run(async (ctx) => {
    await ctx.db.delete(missingId);
  });
  const before = await snapshotOf(t, requestId);

  // Otro Profesional sin toma y uno con la toma revocada no operan
  for (const subject of ["ti85-pro-4", "ti85-pro-5"]) {
    await expect(closeAs(t, identityOf(subject), requestId, "Motivo ficticio")).rejects.toThrow(
      "No autorizado",
    );
  }
  // Una solicitud inexistente responde igual que una sin toma
  await expect(closeAs(t, identityOf("ti85-pro-3"), missingId, "Motivo ficticio")).rejects.toThrow(
    "No autorizado",
  );
  expect(await snapshotOf(t, requestId)).toEqual(before);
});

test("TI2-85: cerrar exige motivo y el rechazo no deja escrituras", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedProfile(t, "ti85-est-9", "student");
  const proId = await seedProfile(t, "ti85-pro-6", "professional");
  const requestId = await seedRequestIn(t, studentId, "under_review");
  await seedTake(t, requestId, proId);
  const before = await snapshotOf(t, requestId);

  for (const reason of ["", "   "]) {
    await expect(closeAs(t, identityOf("ti85-pro-6"), requestId, reason)).rejects.toThrow(
      "Se requiere el motivo para cerrar la solicitud sin acompañamiento.",
    );
  }
  expect(await snapshotOf(t, requestId)).toEqual(before);
});

test("TI2-85: sin identidad, sin rol Profesional o sin cuenta vigente no se cierra", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedProfile(t, "ti85-est-10", "student");
  const requestId = await seedRequestIn(t, studentId, "under_review");

  // Cada perfil tiene una toma sembrada: la denegación sale del rol o de la
  // vigencia, no de la falta de toma
  await seedTake(t, requestId, studentId);
  const others = [
    ["ti85-int-2", "intern", ENABLED],
    ["ti85-adm-2", "admin", ENABLED],
    ["ti85-pro-inh", "professional", { institutionalStatus: "disabled", accountStatus: "active" }],
    ["ti85-pro-ina", "professional", { institutionalStatus: "enabled", accountStatus: "inactive" }],
  ] as const;
  for (const [subject, role, status] of others) {
    await seedTake(t, requestId, await seedProfile(t, subject, role, status));
  }
  const before = await snapshotOf(t, requestId);

  const subjects = ["ti85-est-10", ...others.map(([subject]) => subject)];
  for (const identity of [null, identityOf("ti85-sin-perfil"), ...subjects.map(identityOf)]) {
    await expect(closeAs(t, identity, requestId, "Motivo ficticio")).rejects.toThrow(
      "No autorizado",
    );
  }
  expect(await snapshotOf(t, requestId)).toEqual(before);
});

test("TI2-85: cerrar una recibida, una aceptada o una ya cancelada se rechaza sin tocar el historial", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedProfile(t, "ti85-est-11", "student");
  const proId = await seedProfile(t, "ti85-pro-7", "professional");
  const professional = identityOf("ti85-pro-7");

  // Con una toma escrita a mano: el paso no existe aunque haya toma
  for (const status of ["received", "accepted", "cancelled"] as const) {
    const requestId = await seedRequestIn(t, studentId, status);
    await seedTake(t, requestId, proId);
    await expect(closeAs(t, professional, requestId, "Motivo ficticio")).rejects.toThrow(
      "La solicitud no admite el cierre sin acompañamiento en su estado actual.",
    );
    expect(await snapshotOf(t, requestId)).toEqual({
      status,
      closureReason: undefined,
      transitions: [],
      accompaniments: 0,
    });
  }

  // Repetir el cierre parte del estado que dejó el primero
  const requestId = await seedRequestIn(t, studentId, "under_review");
  await seedTake(t, requestId, proId);
  await closeAs(t, professional, requestId, "Motivo ficticio");
  const afterFirst = await snapshotOf(t, requestId);
  await expect(closeAs(t, professional, requestId, "Otro motivo")).rejects.toThrow(
    "no admite el cierre",
  );
  expect(await snapshotOf(t, requestId)).toEqual(afterFirst);
  expect(afterFirst.transitions).toHaveLength(1);
});

test("TI2-141: tras cerrar, el listado y el detalle del Profesional entregan la solicitud cerrada", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedProfile(t, "ti85-est-12", "student");
  const proId = await seedProfile(t, "ti85-pro-8", "professional");
  const closedId = await seedRequestIn(t, studentId, "under_review");
  const openId = await seedRequestIn(t, studentId, "under_review");
  await seedTake(t, closedId, proId);
  await seedTake(t, openId, proId);
  await closeAs(t, identityOf("ti85-pro-8"), closedId, "Motivo ficticio");

  // La cerrada sigue en el listado, con su estado, junto a la abierta
  const asProfessional = t.withIdentity(identityOf("ti85-pro-8"));
  const page = await asProfessional.query(api.presentation.requests.listAuthorizedRequests, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(page.page.map((item) => [item._id, item.status])).toEqual([
    [closedId, "closed_without_accompaniment"],
    [openId, "under_review"],
  ]);

  // El detalle también la entrega
  const detail = await asProfessional.query(api.presentation.requests.getRequest, {
    requestId: closedId,
  });
  expect(detail).toMatchObject({ _id: closedId, status: "closed_without_accompaniment" });
});

test("TI2-141: tras cancelar, el listado del Estudiante y el del Profesional con toma entregan la solicitud cancelada", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedProfile(t, "ti85-est-13", "student");
  const proId = await seedProfile(t, "ti85-pro-9", "professional");
  const cancelledId = await seedRequestIn(t, studentId, "under_review");
  const openId = await seedRequestIn(t, studentId, "received");
  await seedTake(t, cancelledId, proId);
  await cancelAs(t, identityOf("ti85-est-13"), cancelledId, "Motivo ficticio");

  const own = await t
    .withIdentity(identityOf("ti85-est-13"))
    .query(api.presentation.requests.listOwnRequests, {
      paginationOpts: { numItems: 10, cursor: null },
    });
  expect(own.page.map((item) => [item._id, item.status])).toEqual([
    [cancelledId, "cancelled"],
    [openId, "received"],
  ]);
  const ownDetail = await t
    .withIdentity(identityOf("ti85-est-13"))
    .query(api.presentation.requests.getRequest, { requestId: cancelledId });
  expect(ownDetail).toMatchObject({ _id: cancelledId, status: "cancelled" });

  // Cancelar no revoca la toma, así que el Profesional la sigue viendo
  const activeTakes = await t.run((ctx) =>
    ctx.db
      .query("requestAssignments")
      .withIndex("by_request_and_user_and_status", (q) =>
        q.eq("requestId", cancelledId).eq("userId", proId).eq("status", "active"),
      )
      .collect(),
  );
  expect(activeTakes).toHaveLength(1);
  const authorized = await t
    .withIdentity(identityOf("ti85-pro-9"))
    .query(api.presentation.requests.listAuthorizedRequests, {
      paginationOpts: { numItems: 10, cursor: null },
    });
  expect(authorized.page.map((item) => [item._id, item.status])).toEqual([
    [cancelledId, "cancelled"],
  ]);
});

/*
 * TI2-141: respuesta del Estudiante a la información pedida y detalle con
 * los textos del intercambio.
 */

function respondAs(t: SchemaTest, identity: Identity, requestId: Id<"requests">, response: string) {
  return sessionOf(t, identity).mutation(api.presentation.requests.respondToInformationRequest, {
    requestId,
    response,
  });
}

function detailAs(t: SchemaTest, identity: Identity, requestId: Id<"requests">) {
  return sessionOf(t, identity).query(api.presentation.requests.getRequest, { requestId });
}

const PAGE = { numItems: 10, cursor: null };

test("TI2-141: el Estudiante responde lo pedido y la solicitud vuelve a revisión con su registro", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedProfile(t, "ti141-est-1", "student");
  const proId = await seedProfile(t, "ti141-pro-1", "professional");
  const student = identityOf("ti141-est-1");
  const professional = identityOf("ti141-pro-1");
  const asProfessional = t.withIdentity(professional);

  const created = await t
    .withIdentity(student)
    .mutation(api.presentation.requests.createRequest, { accessNeeds: "Necesidad ficticia" });
  const requestId = created._id;
  await asProfessional.mutation(api.presentation.requests.takeRequest, { requestId });
  await asProfessional.mutation(api.presentation.requests.requestAdditionalInformation, {
    requestId,
    reason: "Falta el horario en que puedes asistir",
  });

  // Mientras espera, el dueño y quien la tomó leen lo pedido en el detalle
  for (const identity of [student, professional]) {
    const waiting = await detailAs(t, identity, requestId);
    expect(waiting.status).toBe("awaiting_information_or_acceptance");
    expect(waiting.informationRequest).toBe("Falta el horario en que puedes asistir");
    expect(waiting.informationResponse).toBeUndefined();
  }

  const answered = await respondAs(t, student, requestId, "  Puedo los martes por la tarde  ");
  expect(answered).toMatchObject({ _id: requestId, studentId, status: "under_review" });

  // Estado y registro en la misma transacción: actor Estudiante, respuesta recortada
  const after = await snapshotOf(t, requestId);
  expect(after.status).toBe("under_review");
  expect(after.accompaniments).toBe(0);
  expect(after.transitions.map((row) => `${row.from} -> ${row.to}`)).toEqual([
    "received -> under_review",
    "under_review -> awaiting_information_or_acceptance",
    "awaiting_information_or_acceptance -> under_review",
  ]);
  expect(after.transitions[2]).toMatchObject({
    actorId: studentId,
    reason: "Puedo los martes por la tarde",
  });

  // Ya no hay nada pendiente: el detalle entrega la respuesta y no lo pedido
  for (const identity of [student, professional]) {
    const reviewed = await detailAs(t, identity, requestId);
    expect(reviewed.informationRequest).toBeUndefined();
    expect(reviewed.informationResponse).toBe("Puedo los martes por la tarde");
  }

  // El Profesional retoma: vuelve a pedir y el detalle muestra solo el pedido
  // nuevo, sin la respuesta al anterior, para que no parezca respondido
  await asProfessional.mutation(api.presentation.requests.requestAdditionalInformation, {
    requestId,
    reason: "Indica también la modalidad",
  });
  for (const identity of [student, professional]) {
    const again = await detailAs(t, identity, requestId);
    expect(again.informationRequest).toBe("Indica también la modalidad");
    expect(again.informationResponse).toBeUndefined();
  }

  // La segunda respuesta reemplaza a la primera en el detalle
  await respondAs(t, student, requestId, "En línea");
  for (const identity of [student, professional]) {
    const answered = await detailAs(t, identity, requestId);
    expect(answered.informationRequest).toBeUndefined();
    expect(answered.informationResponse).toBe("En línea");
  }

  // Tras la segunda respuesta se acepta y abre un solo acompañamiento
  await asProfessional.mutation(api.presentation.requests.acceptRequest, {
    requestId,
    objective: "Objetivo ficticio",
  });
  const accepted = await snapshotOf(t, requestId);
  expect(accepted.status).toBe("accepted");
  expect(accepted.accompaniments).toBe(1);
  expect(accepted.transitions.filter((row) => row.actorId === proId)).toHaveLength(4);
});

test("TI2-141: responder una solicitud ajena o inexistente, o sin ser Estudiante vigente, se deniega sin escribir", async () => {
  const t = convexTest(schema, modules);
  const ownerId = await seedProfile(t, "ti141-est-2", "student");
  await seedProfile(t, "ti141-est-3", "student");
  const proId = await seedProfile(t, "ti141-pro-2", "professional");
  await seedProfile(t, "ti141-int-1", "intern");
  await seedProfile(t, "ti141-adm-1", "admin");
  await seedProfile(t, "ti141-est-ina", "student", {
    institutionalStatus: "enabled",
    accountStatus: "inactive",
  });
  const requestId = await seedRequestIn(t, ownerId, "awaiting_information_or_acceptance");
  await seedTake(t, requestId, proId);
  const missingId = await seedRequestIn(t, ownerId, "awaiting_information_or_acceptance");
  await t.run(async (ctx) => {
    await ctx.db.delete(missingId);
  });
  const before = await snapshotOf(t, requestId);

  // Otro Estudiante no distingue una solicitud ajena de una inexistente
  for (const id of [requestId, missingId]) {
    await expect(respondAs(t, identityOf("ti141-est-3"), id, "Respuesta")).rejects.toThrow(
      "No autorizado",
    );
  }
  // Ni el Profesional con toma responde por el Estudiante
  for (const identity of [
    null,
    identityOf("ti141-sin-perfil"),
    identityOf("ti141-pro-2"),
    identityOf("ti141-int-1"),
    identityOf("ti141-adm-1"),
    identityOf("ti141-est-ina"),
  ]) {
    await expect(respondAs(t, identity, requestId, "Respuesta")).rejects.toThrow("No autorizado");
  }
  expect(await snapshotOf(t, requestId)).toEqual(before);
});

test("TI2-141: responder exige la espera, una respuesta con texto y dentro del tope", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedProfile(t, "ti141-est-4", "student");
  const student = identityOf("ti141-est-4");

  // Fuera de la espera no hay nada que responder, ni siquiera desde recibida,
  // donde el par `received -> under_review` existe para la toma
  for (const status of [
    "received",
    "under_review",
    "accepted",
    "cancelled",
    "closed_without_accompaniment",
  ] as const) {
    const requestId = await seedRequestIn(t, studentId, status);
    await expect(respondAs(t, student, requestId, "Respuesta")).rejects.toThrow(
      "La solicitud no admite una respuesta en su estado actual.",
    );
    expect(await snapshotOf(t, requestId)).toMatchObject({ status, transitions: [] });
  }

  const requestId = await seedRequestIn(t, studentId, "awaiting_information_or_acceptance");
  const before = await snapshotOf(t, requestId);
  for (const response of ["", "   "]) {
    await expect(respondAs(t, student, requestId, response)).rejects.toThrow(
      "Se requiere la respuesta a la información pedida.",
    );
  }
  await expect(respondAs(t, student, requestId, "a".repeat(2001))).rejects.toThrow(
    "La respuesta supera el máximo permitido (2000 caracteres).",
  );
  expect(await snapshotOf(t, requestId)).toEqual(before);

  // En el tope exacto se acepta
  await respondAs(t, student, requestId, "a".repeat(2000));
  expect((await snapshotOf(t, requestId)).status).toBe("under_review");
});

test("TI2-141: la razón de cierre llega al detalle del Estudiante y los textos no viajan en los listados", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedProfile(t, "ti141-est-5", "student");
  const proId = await seedProfile(t, "ti141-pro-3", "professional");
  await seedProfile(t, "ti141-pro-4", "professional");
  const student = identityOf("ti141-est-5");
  const professional = identityOf("ti141-pro-3");
  const requestId = await seedRequestIn(t, studentId, "under_review");
  await seedTake(t, requestId, proId);
  await t
    .withIdentity(professional)
    .mutation(api.presentation.requests.requestAdditionalInformation, {
      requestId,
      reason: "Pedido ficticio",
    });
  await respondAs(t, student, requestId, "Respuesta ficticia");
  await closeAs(t, professional, requestId, "La necesidad corresponde a otra unidad");

  const detail = await detailAs(t, student, requestId);
  expect(detail).toMatchObject({
    status: "closed_without_accompaniment",
    closureReason: "La necesidad corresponde a otra unidad",
    informationResponse: "Respuesta ficticia",
  });
  expect(detail.informationRequest).toBeUndefined();

  // Los listados conservan los cinco campos: sin razón ni intercambio
  const BASE_KEYS = ["_id", "accessNeeds", "createdAt", "status", "studentId"];
  const own = await t
    .withIdentity(student)
    .query(api.presentation.requests.listOwnRequests, { paginationOpts: PAGE });
  const authorized = await t
    .withIdentity(professional)
    .query(api.presentation.requests.listAuthorizedRequests, { paginationOpts: PAGE });
  for (const item of [...own.page, ...authorized.page]) {
    expect(Object.keys(item).sort()).toEqual(BASE_KEYS);
  }

  // Un Profesional sin toma no lee el detalle, y con él tampoco la razón
  await expect(detailAs(t, identityOf("ti141-pro-4"), requestId)).rejects.toThrow("No autorizado");
});

/*
 * TI2-141: envío completo con validaciones, límites e idempotencia.
 */

const FULL_SUBMISSION = {
  needSummary: "  Necesito apoyo para seguir las clases en línea  ",
  expectedOutcome: "Acordar ajustes de comunicación con mis docentes",
  accessNeeds: [
    { id: "written-communication", label: "Comunicación escrita" },
    { id: "extended-communication-time", label: "Más tiempo para comunicarme" },
  ],
  otherAccessNeed: "Material enviado con anticipación",
  modalityPreference: "online" as const,
  generalAvailability: {
    preferredWeekdays: [1, 3],
    preferredTimeRange: { from: "09:00", to: "12:00" },
  },
  preferredAccessibleInformationChannel: "Correo con letra grande",
  idempotencyKey: "clave-ficticia-1",
};

async function requestsOf(t: SchemaTest, studentId: Id<"users">) {
  return await t.run((ctx) =>
    ctx.db
      .query("requests")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .take(20),
  );
}

test("TI2-141: el envío completo guarda todos sus campos recortados y su procedencia", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedProfile(t, "ti141-env-1", "student");
  const asStudent = t.withIdentity(identityOf("ti141-env-1"));

  const created = await asStudent.mutation(
    api.presentation.requests.createRequest,
    FULL_SUBMISSION,
  );
  // La respuesta pública conserva sus cinco campos, con el texto unido derivado
  expect(Object.keys(created).sort()).toEqual([
    "_id",
    "accessNeeds",
    "createdAt",
    "status",
    "studentId",
  ]);
  expect(created).toMatchObject({
    studentId,
    status: "received",
    accessNeeds:
      "Comunicación escrita\nMás tiempo para comunicarme\nMaterial enviado con anticipación",
  });

  const [row] = await requestsOf(t, studentId);
  expect(row).toMatchObject({
    needSummary: "Necesito apoyo para seguir las clases en línea",
    expectedOutcome: FULL_SUBMISSION.expectedOutcome,
    accessNeedSelections: FULL_SUBMISSION.accessNeeds,
    otherAccessNeed: FULL_SUBMISSION.otherAccessNeed,
    modalityPreference: "online",
    generalAvailability: FULL_SUBMISSION.generalAvailability,
    preferredAccessibleInformationChannel: FULL_SUBMISSION.preferredAccessibleInformationChannel,
    idempotencyKey: "clave-ficticia-1",
    provenance: { channel: "student" },
  });
  expect(row?.provenance?.receivedAt).toBeGreaterThan(0);
});

test("TI2-141: reintentar el envío con la misma clave no duplica; otra clave u otro estudiante sí crean", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedProfile(t, "ti141-env-2", "student");
  const otherId = await seedProfile(t, "ti141-env-3", "student");
  const asStudent = t.withIdentity(identityOf("ti141-env-2"));

  const first = await asStudent.mutation(api.presentation.requests.createRequest, FULL_SUBMISSION);
  // Reintento, aunque cambie el contenido: la clave identifica el envío
  const retry = await asStudent.mutation(api.presentation.requests.createRequest, {
    ...FULL_SUBMISSION,
    needSummary: "Otro texto del mismo envío",
  });
  expect(retry._id).toBe(first._id);
  expect(await requestsOf(t, studentId)).toHaveLength(1);

  // Envíos simultáneos con la misma clave dejan una sola fila
  const simultaneous = await Promise.all(
    [1, 2, 3].map(() =>
      asStudent.mutation(api.presentation.requests.createRequest, {
        ...FULL_SUBMISSION,
        idempotencyKey: "clave-simultanea",
      }),
    ),
  );
  expect(new Set(simultaneous.map((item) => item._id)).size).toBe(1);
  expect(await requestsOf(t, studentId)).toHaveLength(2);

  // La clave es del estudiante: la misma en otra cuenta es otro envío
  const other = await t
    .withIdentity(identityOf("ti141-env-3"))
    .mutation(api.presentation.requests.createRequest, FULL_SUBMISSION);
  expect(other._id).not.toBe(first._id);
  expect(await requestsOf(t, otherId)).toHaveLength(1);
});

test("TI2-141: el envío completo rechaza campos vacíos, excesos y formas inválidas sin escribir", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedProfile(t, "ti141-env-4", "student");
  const asStudent = t.withIdentity(identityOf("ti141-env-4"));
  const send = (changes: Record<string, unknown>) =>
    asStudent.mutation(api.presentation.requests.createRequest, {
      ...FULL_SUBMISSION,
      ...changes,
    } as typeof FULL_SUBMISSION);

  const cases: [Record<string, unknown>, string][] = [
    [{ needSummary: "   " }, "Describe la barrera o necesidad."],
    [{ needSummary: "a".repeat(2001) }, "La descripción de la necesidad supera el máximo"],
    [{ expectedOutcome: "" }, "Indica qué esperas de CERETI."],
    [{ expectedOutcome: "a".repeat(2001) }, "El resultado esperado supera el máximo"],
    [{ accessNeeds: [], otherAccessNeed: " " }, "Se requiere describir la necesidad de acceso."],
    [
      {
        accessNeeds: [
          { id: "a", label: "Uno" },
          { id: "a", label: "Otro" },
        ],
      },
      "Una necesidad de acceso está repetida.",
    ],
    [{ accessNeeds: [{ id: "a", label: "  " }] }, "Cada necesidad de acceso necesita su nombre."],
    [
      {
        accessNeeds: Array.from({ length: 21 }, (_, index) => ({
          id: `n${index}`,
          label: `Necesidad ${index}`,
        })),
      },
      "Selecciona como máximo 20 necesidades de acceso.",
    ],
    [{ generalAvailability: { preferredWeekdays: [] } }, "Selecciona al menos un día disponible."],
    [{ generalAvailability: { preferredWeekdays: [7] } }, "Los días disponibles van de 0"],
    [{ generalAvailability: { preferredWeekdays: [1, 1] } }, "Un día disponible está repetido."],
    [
      {
        generalAvailability: {
          preferredWeekdays: [1],
          preferredTimeRange: { from: "9:00", to: "12:00" },
        },
      },
      "formato HH:mm",
    ],
    [
      {
        generalAvailability: {
          preferredWeekdays: [1],
          preferredTimeRange: { from: "12:00", to: "09:00" },
        },
      },
      "debe empezar antes de terminar",
    ],
    [{ preferredAccessibleInformationChannel: " " }, "Indica cómo prefieres recibir información."],
    [{ preferredAccessibleInformationChannel: "a".repeat(201) }, "supera el máximo permitido (200"],
    [{ idempotencyKey: "  " }, "La clave del envío debe tener entre 1 y 128"],
    [{ idempotencyKey: "a".repeat(129) }, "La clave del envío debe tener entre 1 y 128"],
    [{ idempotencyKey: undefined }, "Faltan datos de la solicitud."],
    [{ accessNeeds: "Texto suelto" }, "como lista junto con los demás datos"],
    [{ accessNeeds: undefined }, "Faltan datos de la solicitud."],
  ];
  for (const [changes, message] of cases) {
    await expect(send(changes)).rejects.toThrow(message);
  }

  // En los topes exactos se acepta
  await send({
    needSummary: "a".repeat(2000),
    expectedOutcome: "a".repeat(2000),
    preferredAccessibleInformationChannel: "a".repeat(200),
    idempotencyKey: "a".repeat(128),
  });
  expect(await requestsOf(t, studentId)).toHaveLength(1);
});

test("TI2-141: el envío no admite RUT, diagnóstico ni campos fuera del contrato, y solo lo hace un Estudiante vigente", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedProfile(t, "ti141-env-5", "student");
  await seedProfile(t, "ti141-env-pro", "professional");
  const asStudent = t.withIdentity(identityOf("ti141-env-5"));

  for (const extra of [{ rut: "11.111.111-1" }, { diagnosis: "Ficticio" }, { internalArea: "X" }]) {
    await expect(
      asStudent.mutation(api.presentation.requests.createRequest, {
        ...FULL_SUBMISSION,
        ...extra,
      } as typeof FULL_SUBMISSION),
    ).rejects.toThrow("Validator error");
  }
  for (const identity of [null, identityOf("ti141-env-pro")]) {
    await expect(
      sessionOf(t, identity).mutation(api.presentation.requests.createRequest, FULL_SUBMISSION),
    ).rejects.toThrow("No autorizado");
  }
  expect(await requestsOf(t, studentId)).toHaveLength(0);
});

/** Datos del `ConvexError` con que se rechazó la promesa. */
async function publicErrorOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConvexError) return error.data as unknown;
    throw error;
  }
  throw new Error("Se esperaba un rechazo");
}

test("TI2-141: los rechazos de las operaciones nuevas llegan como error público con código", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedProfile(t, "ti141-err-est", "student");
  const proId = await seedProfile(t, "ti141-err-pro", "professional");
  const student = identityOf("ti141-err-est");
  const professional = identityOf("ti141-err-pro");
  const waiting = await seedRequestIn(t, studentId, "awaiting_information_or_acceptance");
  const accepted = await seedRequestIn(t, studentId, "accepted");
  await seedTake(t, waiting, proId);
  await seedTake(t, accepted, proId);

  // Un campo que corregir: `request_fields_invalid` con el mensaje específico
  for (const [promise, message] of [
    [cancelAs(t, student, waiting, " "), "Se requiere el motivo para cancelar la solicitud."],
    [
      closeAs(t, professional, waiting, ""),
      "Se requiere el motivo para cerrar la solicitud sin acompañamiento.",
    ],
    [respondAs(t, student, waiting, " "), "Se requiere la respuesta a la información pedida."],
    [
      t.withIdentity(student).mutation(api.presentation.requests.createRequest, {
        ...FULL_SUBMISSION,
        needSummary: "",
      }),
      "Describe la barrera o necesidad.",
    ],
  ] as const) {
    expect(await publicErrorOf(promise)).toEqual({ code: "request_fields_invalid", message });
  }

  // Las necesidades de acceso conservan sus códigos de Sprint 1, que los clientes traducen
  const requestsBefore = (await requestsOf(t, studentId)).length;
  const createWith = (changes: Record<string, unknown>) =>
    t.withIdentity(student).mutation(api.presentation.requests.createRequest, {
      ...FULL_SUBMISSION,
      ...changes,
    } as typeof FULL_SUBMISSION);
  expect(await publicErrorOf(createWith({ accessNeeds: [], otherAccessNeed: " " }))).toEqual({
    code: "access_needs_empty",
    message: "Se requiere describir la necesidad de acceso.",
  });
  const longNeeds = Array.from({ length: 20 }, (_, index) => ({
    id: `n${index}`,
    label: `${index}`.padEnd(200, "x"),
  }));
  expect(await publicErrorOf(createWith({ accessNeeds: longNeeds }))).toEqual({
    code: "access_needs_too_long",
    message:
      "Las necesidades de acceso y el texto adicional superan juntos el máximo permitido (2000 caracteres).",
  });
  expect(
    await publicErrorOf(
      createWith({ accessNeeds: [{ id: "a".repeat(201), label: "Comunicación escrita" }] }),
    ),
  ).toEqual({
    code: "request_fields_invalid",
    message:
      "El identificador de una necesidad de acceso supera el máximo permitido (200 caracteres).",
  });
  expect(await requestsOf(t, studentId)).toHaveLength(requestsBefore);

  // Un estado que no admite el paso: `conflict` con el mensaje específico
  for (const [promise, message] of [
    [
      cancelAs(t, student, accepted, "Motivo"),
      "La solicitud no admite la cancelación en su estado actual.",
    ],
    [
      closeAs(t, professional, accepted, "Motivo"),
      "La solicitud no admite el cierre sin acompañamiento en su estado actual.",
    ],
    [
      respondAs(t, student, accepted, "Respuesta"),
      "La solicitud no admite una respuesta en su estado actual.",
    ],
  ] as const) {
    expect(await publicErrorOf(promise)).toEqual({ code: "conflict", message });
  }

  // La denegación conserva la forma de Sprint 1
  expect(await publicErrorOf(cancelAs(t, professional, waiting, "Motivo"))).toBe("No autorizado");
});
