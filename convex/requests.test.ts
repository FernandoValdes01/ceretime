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

test("Profesional lista solo solicitudes de acompañamientos asignados", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti9-est-9");
  const linkedId = await t.mutation(internal.requests.createTestRequest, {
    studentId,
    status: "accepted",
    accessNeeds: "Vinculada ficticia",
  });
  const looseId = await t.mutation(internal.requests.createTestRequest, {
    studentId,
    status: "received",
    accessNeeds: "Suelta ficticia",
  });
  await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "ti9-pro-5@uct.cl",
      fullName: "Profesional Ficticio",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|ti9-pro-5`,
    });
  });
  const targetId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "ti9-pro-6@uct.cl",
      fullName: "Profesional Asignado",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|ti9-pro-6`,
    });
  });
  const accompanimentId = await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "Necesidad de acceso ficticia",
      requestId: linkedId,
    });
  });
  const asGranter = t.withIdentity(identityFor("ti9-pro-5", "ti9-pro-5@uct.cl"));
  await asGranter.mutation(internal.assignments.assign, {
    accompanimentId,
    userId: targetId,
    assignedRole: "professional",
  });

  // Ve la vinculada y no la suelta
  const asProfessional = t.withIdentity(identityFor("ti9-pro-6", "ti9-pro-6@uct.cl"));
  const page = await asProfessional.query(api.presentation.requests.listAuthorizedRequests, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(page.page.map((item) => item._id).sort()).toEqual([linkedId].sort());
  expect(page.page.find((item) => item._id === looseId)).toBeUndefined();
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

test("Profesional no ve duplicadas aunque existan filas repetidas", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti9-est-11");
  const linkedId = await t.mutation(internal.requests.createTestRequest, {
    studentId,
    status: "accepted",
    accessNeeds: "Vinculada ficticia",
  });
  await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "ti9-pro-7@uct.cl",
      fullName: "Profesional Ficticio",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|ti9-pro-7`,
    });
  });
  const targetId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "ti9-pro-8@uct.cl",
      fullName: "Profesional Asignado",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|ti9-pro-8`,
    });
  });
  const accompanimentId = await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "Necesidad de acceso ficticia",
      requestId: linkedId,
    });
  });
  const asGranter = t.withIdentity(identityFor("ti9-pro-7", "ti9-pro-7@uct.cl"));
  await asGranter.mutation(internal.assignments.assign, {
    accompanimentId,
    userId: targetId,
    assignedRole: "professional",
  });
  // Fila repetida escrita fuera de la vía protegida
  await t.run(async (ctx) => {
    return await ctx.db.insert("accompanimentAssignments", {
      accompanimentId,
      userId: targetId,
      assignedRole: "professional",
      status: "active",
      grantedBy: targetId,
      grantedAt: 1,
    });
  });

  // Una sola vez en página completa y sin repetirse entre páginas
  const asProfessional = t.withIdentity(identityFor("ti9-pro-8", "ti9-pro-8@uct.cl"));
  const full = await asProfessional.query(api.presentation.requests.listAuthorizedRequests, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(full.page.map((item) => item._id)).toEqual([linkedId]);

  const first = await asProfessional.query(api.presentation.requests.listAuthorizedRequests, {
    paginationOpts: { numItems: 1, cursor: null },
  });
  expect(first.page.map((item) => item._id)).toEqual([linkedId]);
  const second = await asProfessional.query(api.presentation.requests.listAuthorizedRequests, {
    paginationOpts: { numItems: 1, cursor: first.continueCursor },
  });
  expect(second.page).toHaveLength(0);
  expect(second.isDone).toBe(true);
});

test("Profesional no pierde solicitudes cuando la página se llena antes", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti9-est-12");
  const expected: Id<"requests">[] = [];
  for (const tag of ["a", "b", "c"]) {
    const requestId = await t.mutation(internal.requests.createTestRequest, {
      studentId,
      status: "accepted",
      accessNeeds: `Vinculada ${tag} ficticia`,
    });
    expected.push(requestId);
  }
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
  const targetId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "ti9-pro-10@uct.cl",
      fullName: "Profesional Asignado",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|ti9-pro-10`,
    });
  });
  const asGranter = t.withIdentity(identityFor("ti9-pro-9", "ti9-pro-9@uct.cl"));
  for (const requestId of expected) {
    const accompanimentId = await t.run(async (ctx) => {
      return await ctx.db.insert("accompaniments", {
        studentId,
        status: "active",
        objective: "Objetivo ficticio",
        accessNeeds: "Necesidad de acceso ficticia",
        requestId,
      });
    });
    await asGranter.mutation(internal.assignments.assign, {
      accompanimentId,
      userId: targetId,
      assignedRole: "professional",
    });
  }

  // Caminar de a una trae las tres sin omitir ninguna
  const asProfessional = t.withIdentity(identityFor("ti9-pro-10", "ti9-pro-10@uct.cl"));
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
});

test("Profesional pide información adicional en solicitud en revisión", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti9-est-4");
  await t.run(async (ctx) => {
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
    status: "under_review",
    accessNeeds: "Necesidad de acceso ficticia",
  });

  // El Profesional mueve la solicitud a espera de información con motivo
  const asProfessional = t.withIdentity(identityFor("ti9-pro-3", "ti9-pro-3@uct.cl"));
  const updated = await asProfessional.mutation(
    api.presentation.requests.requestAdditionalInformation,
    { requestId, reason: "Falta el horario disponible" },
  );
  expect(updated.status).toBe("awaiting_information_or_acceptance");

  // Sin motivo se rechaza indicando qué corregir, sin modificar nada
  const pendingId = await t.mutation(internal.requests.createTestRequest, {
    studentId,
    status: "under_review",
    accessNeeds: "Otra necesidad ficticia",
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
