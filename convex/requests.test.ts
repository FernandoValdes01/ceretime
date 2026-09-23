/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { FunctionReturnType } from "convex/server";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { SPRINT_1_REQUEST_STATES } from "./domain/request/state";
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
  const takenId = await t.mutation(internal.requests.createTestRequest, {
    studentId,
    status: "received",
    accessNeeds: "Tomada ficticia",
  });
  await t.mutation(internal.requests.createTestRequest, {
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
  const takenId = await t.mutation(internal.requests.createTestRequest, {
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
  const requestId = await t.mutation(internal.requests.createTestRequest, {
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

test("Caminar tomas guardadas no repite ninguna solicitud", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti9-est-18");
  const expected: Id<"requests">[] = [];
  for (const tag of ["a", "b", "c"]) {
    expected.push(
      await t.mutation(internal.requests.createTestRequest, {
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
  const requestId = await t.mutation(internal.requests.createTestRequest, {
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
  const pointed = await t.query(internal.requests.getRequestById, { id: requestId });
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
  const freshId = await t.mutation(internal.requests.createTestRequest, {
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
  const reviewingId = await t.mutation(internal.requests.createTestRequest, {
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
  const receivedId = await t.mutation(internal.requests.createTestRequest, {
    studentId,
    status: "received",
    accessNeeds: "Recibida ficticia",
  });
  await t.mutation(internal.requests.createTestRequest, {
    studentId,
    status: "under_review",
    accessNeeds: "En revisión ficticia",
  });
  await t.mutation(internal.requests.createTestRequest, {
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
  const requestId = await t.mutation(internal.requests.createTestRequest, {
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
  const requestId = await t.mutation(internal.requests.createTestRequest, {
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
  const pendingId = await t.mutation(internal.requests.createTestRequest, {
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
  const untouched = await t.query(internal.requests.getRequestById, { id: pendingId });
  expect(untouched?.status).toBe("under_review");
});

test("Pedir información se deniega sin Profesional vigente o en estado inválido", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti9-est-5");
  const receivedId = await t.mutation(internal.requests.createTestRequest, {
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
  const requestId = await t.mutation(internal.requests.createTestRequest, {
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
  const untouched = await t.query(internal.requests.getRequestById, { id: requestId });
  expect(untouched?.status).toBe("under_review");
});
