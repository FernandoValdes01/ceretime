/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Cobertura integrada de Practicante, contratos públicos y ruta crítica (TI2-29).
 *
 * Cierra el Sprint 1 sobre la ruta real Solicitud → Acompañamiento → asignación:
 * el Estudiante registra, el Profesional toma y acepta (apertura única), concede
 * al Practicante habilitado y este lee solo la vista minimizada. Cada caso
 * negativo demuestra el rechazo exacto `No autorizado` y que no se filtra
 * información (ni el ID, ni el objetivo, ni la necesidad de acceso).
 *
 * Cada prueba usa identidad simulada (`withIdentity` con `tokenIdentifier`
 * explícito) y datos ficticios. La autorización se resuelve en el servidor a
 * partir de `ctx.auth.getUserIdentity()`; ningún `userId` del cliente se usa
 * como prueba. La superficie pública son solo `presentation/*`; la escritura
 * de asignaciones es la vía interna guardada (`internal.assignments.*`).
 */

const ISSUER = "https://accounts.google.com";

// Exacto y no por inclusión: un mensaje que agregue el motivo debe fallar.
const DENIED = /^No autorizado$/;

function identityFor(subject: string, email: string) {
  return {
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    email,
    name: "Ficticio",
  };
}

function pageOpts(numItems: number, cursor: string | null = null) {
  return { numItems, cursor };
}

async function seedUser(
  t: ReturnType<typeof convexTest>,
  input: {
    subject: string;
    email: string;
    role: "student" | "professional" | "intern";
  },
) {
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: input.email,
      fullName: "Ficticio",
      role: input.role,
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|${input.subject}`,
    });
  });
  return id;
}

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
 * Ruta crítica completa hasta el Practicante asignado.
 *
 * Devuelve la solicitud aceptada y el acompañamiento abierto por la vía
 * pública, con el Profesional como responsable inicial y el Practicante con
 * asignación explícita y activa. Sirve de fixture común para no dispersar la
 * evidencia entre archivos: cada prueba parte del mismo estado comprobable.
 */
async function seedCriticalPathWithIntern(t: ReturnType<typeof convexTest>, prefix: string) {
  const studentSubject = `${prefix}-est`;
  const proSubject = `${prefix}-pro`;
  const internSubject = `${prefix}-int`;
  const studentId = await seedUser(t, {
    subject: studentSubject,
    email: `${studentSubject}@alu.uct.cl`,
    role: "student",
  });
  await seedUser(t, {
    subject: proSubject,
    email: `${proSubject}@uct.cl`,
    role: "professional",
  });
  const internId = await seedUser(t, {
    subject: internSubject,
    email: `${internSubject}@alu.uct.cl`,
    role: "intern",
  });

  const created = await registerOwnRequest(t, studentSubject);
  const requestId = created._id as Id<"requests">;
  const asProfessional = t.withIdentity(identityFor(proSubject, `${proSubject}@uct.cl`));
  await asProfessional.mutation(api.presentation.requests.takeRequest, { requestId });
  const opened = await asProfessional.mutation(api.presentation.requests.acceptRequest, {
    requestId,
    objective: "Objetivo ficticio de la ruta crítica",
  });
  const accompanimentId = opened._id;

  const asPro = t.withIdentity(identityFor(proSubject, `${proSubject}@uct.cl`));
  await asPro.mutation(internal.assignments.assign, {
    accompanimentId,
    userId: internId,
    assignedRole: "intern",
  });

  return { requestId, accompanimentId, internId, proSubject, internSubject, opened, studentId };
}

/**
 * Cuenta acompañamientos abiertos desde la solicitud con lectura acotada.
 *
 * Basta la primera fila para afirmar 0 o 1 y un duplicado se detecta como
 * distinto de lo esperado; se lee como máximo dos filas (`take(2)` en vez de
 * `collect()`). La vía guardada de producción usa el índice
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

/** Mensaje de la denegación, o falla si la operación fue permitida. */
async function denyMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Se esperaba denegación y la operación fue permitida");
}

test("practicante asignado lee minimizado con claves exactas en la ruta crítica", async () => {
  const t = convexTest(schema, modules);
  const { accompanimentId, internSubject } = await seedCriticalPathWithIntern(t, "ti29-1");

  const asIntern = t.withIdentity(identityFor(internSubject, `${internSubject}@alu.uct.cl`));
  const list = await asIntern.query(api.presentation.accompaniments.listAssignedAccompaniments, {
    limit: 10,
  });
  expect(list.items).toHaveLength(1);
  expect(list.hasMore).toBe(false);
  expect(list.items[0]?._id).toEqual(accompanimentId);
  expect(list.items[0]?.view).toBe("minimized");
  expect(Object.keys(list.items[0] ?? {}).sort()).toEqual(["_id", "objective", "status", "view"]);

  const detail = await asIntern.query(api.presentation.accompaniments.getAccompaniment, {
    accompanimentId,
  });
  expect(detail.view).toBe("minimized");
  expect(Object.keys(detail).sort()).toEqual(["_id", "objective", "status", "view"]);
  expect(detail).toEqual({
    _id: accompanimentId,
    status: "active",
    objective: "Objetivo ficticio de la ruta crítica",
    view: "minimized",
  });
  expect(detail).not.toHaveProperty("studentId");
  expect(detail).not.toHaveProperty("accessNeeds");
});

test("acompañamiento no asignado se rechaza sin filtrar información", async () => {
  const t = convexTest(schema, modules);
  const { accompanimentId, internSubject } = await seedCriticalPathWithIntern(t, "ti29-2");

  const otherStudentId = await seedUser(t, {
    subject: "ti29-2-est-otro",
    email: "ti29-2-est-otro@alu.uct.cl",
    role: "student",
  });
  const otherId = await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId: otherStudentId,
      status: "active",
      objective: "Objetivo ficticio no asignado",
      accessNeeds: "Necesidad de acceso ficticia no asignada",
    });
  });

  const asIntern = t.withIdentity(identityFor(internSubject, `${internSubject}@alu.uct.cl`));
  const list = await asIntern.query(api.presentation.accompaniments.listAssignedAccompaniments, {
    limit: 10,
  });
  expect(list.items.map((item) => item._id)).toEqual([accompanimentId]);

  const detailMessage = await denyMessage(
    asIntern.query(api.presentation.accompaniments.getAccompaniment, {
      accompanimentId: otherId,
    }),
  );
  expect(detailMessage).toMatch(DENIED);
  expect(detailMessage).not.toContain(String(otherId));
  expect(detailMessage).not.toContain("Objetivo ficticio no asignado");
  expect(detailMessage).not.toContain("Necesidad de acceso ficticia no asignada");

  const notesMessage = await denyMessage(
    asIntern.query(api.presentation.accompaniments.getInternalNotes, {
      accompanimentId: otherId,
      paginationOpts: pageOpts(10),
    }),
  );
  expect(notesMessage).toMatch(DENIED);
  expect(notesMessage).not.toContain(String(otherId));
});

test("acceso directo por ID inexistente responde idéntico sin revelar existencia", async () => {
  const t = convexTest(schema, modules);
  const { accompanimentId, internSubject, studentId } = await seedCriticalPathWithIntern(
    t,
    "ti29-3",
  );

  const missingId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("accompaniments", {
      studentId,
      status: "active",
      objective: "Temporal ficticio",
      accessNeeds: "Temporal ficticio",
    });
    await ctx.db.delete(id);
    return id;
  });

  const asIntern = t.withIdentity(identityFor(internSubject, `${internSubject}@alu.uct.cl`));
  const missingMessage = await denyMessage(
    asIntern.query(api.presentation.accompaniments.getAccompaniment, {
      accompanimentId: missingId,
    }),
  );
  expect(missingMessage).toMatch(DENIED);
  expect(missingMessage).not.toContain(String(missingId));
  expect(missingMessage).not.toContain("Temporal ficticio");

  const assigned = await asIntern.query(api.presentation.accompaniments.getAccompaniment, {
    accompanimentId,
  });
  expect(assigned.view).toBe("minimized");
});

test("modificación y autoasignación del practicante se rechazan", async () => {
  const t = convexTest(schema, modules);
  const { accompanimentId, internId, internSubject } = await seedCriticalPathWithIntern(
    t,
    "ti29-4",
  );
  const otherInternId = await seedUser(t, {
    subject: "ti29-4-int-otro",
    email: "ti29-4-int-otro@alu.uct.cl",
    role: "intern",
  });

  const asIntern = t.withIdentity(identityFor(internSubject, `${internSubject}@alu.uct.cl`));
  await expect(
    asIntern.mutation(internal.assignments.assign, {
      accompanimentId,
      userId: internId,
      assignedRole: "intern",
    }),
  ).rejects.toThrow(DENIED);
  await expect(
    asIntern.mutation(internal.assignments.assign, {
      accompanimentId,
      userId: otherInternId,
      assignedRole: "intern",
    }),
  ).rejects.toThrow(DENIED);
  await expect(
    asIntern.mutation(internal.assignments.revoke, {
      accompanimentId,
      userId: internId,
      assignedRole: "intern",
    }),
  ).rejects.toThrow(DENIED);

  await expect(
    asIntern.query(api.presentation.accompaniments.listOwnedAccompaniments, {
      paginationOpts: pageOpts(10),
    }),
  ).rejects.toThrow(DENIED);
  await expect(
    asIntern.query(api.presentation.accompaniments.getInternalNotes, {
      accompanimentId,
      paginationOpts: pageOpts(10),
    }),
  ).rejects.toThrow(DENIED);
});

test("revocación inmediata cierra lectura y listado sin filtrar", async () => {
  const t = convexTest(schema, modules);
  const { accompanimentId, internId, internSubject, proSubject } = await seedCriticalPathWithIntern(
    t,
    "ti29-5",
  );

  const asIntern = t.withIdentity(identityFor(internSubject, `${internSubject}@alu.uct.cl`));
  const before = await asIntern.query(api.presentation.accompaniments.getAccompaniment, {
    accompanimentId,
  });
  expect(before.view).toBe("minimized");

  const asPro = t.withIdentity(identityFor(proSubject, `${proSubject}@uct.cl`));
  await asPro.mutation(internal.assignments.revoke, {
    accompanimentId,
    userId: internId,
    assignedRole: "intern",
  });

  const detailMessage = await denyMessage(
    asIntern.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
  );
  expect(detailMessage).toMatch(DENIED);
  expect(detailMessage).not.toContain(String(accompanimentId));
  expect(detailMessage).not.toContain("Objetivo ficticio de la ruta crítica");
  expect(detailMessage).not.toContain("Necesidad de acceso ficticia");

  const list = await asIntern.query(api.presentation.accompaniments.listAssignedAccompaniments, {
    limit: 10,
  });
  expect(list.items).toHaveLength(0);
  expect(list.hasMore).toBe(false);

  const notesMessage = await denyMessage(
    asIntern.query(api.presentation.accompaniments.getInternalNotes, {
      accompanimentId,
      paginationOpts: pageOpts(10),
    }),
  );
  expect(notesMessage).toMatch(DENIED);
  expect(notesMessage).not.toContain(String(accompanimentId));

  const row = await t.run(async (ctx) => {
    return await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
        q
          .eq("accompanimentId", accompanimentId)
          .eq("userId", internId)
          .eq("status", "revoked")
          .eq("assignedRole", "intern"),
      )
      .unique();
  });
  expect(row?.status).toBe("revoked");
  expect(typeof row?.revokedAt).toBe("number");
});

test("contratos públicos conservan forma estable en respuestas exitosas", async () => {
  const t = convexTest(schema, modules);
  const { accompanimentId, opened, requestId, internSubject } = await seedCriticalPathWithIntern(
    t,
    "ti29-6",
  );

  expect(opened.view).toBe("full");
  expect(Object.keys(opened).sort()).toEqual([
    "_id",
    "accessNeeds",
    "objective",
    "status",
    "studentId",
    "view",
  ]);
  expect(opened._id).toEqual(accompanimentId);
  expect(opened.accessNeeds).toBe("Necesidad de acceso ficticia");

  const asIntern = t.withIdentity(identityFor(internSubject, `${internSubject}@alu.uct.cl`));
  const minimized = await asIntern.query(api.presentation.accompaniments.getAccompaniment, {
    accompanimentId,
  });
  expect(Object.keys(minimized).sort()).toEqual(["_id", "objective", "status", "view"]);

  const accepted = await t.query(internal.requests.getRequestById, { id: requestId });
  expect(accepted?.status).toBe("accepted");
  expect(await countAccompanimentsFor(t, requestId)).toBe(1);
});

test("apertura única no duplica ante aceptación repetida", async () => {
  const t = convexTest(schema, modules);
  const studentSubject = "ti29-7-est";
  const proSubject = "ti29-7-pro";
  await seedUser(t, {
    subject: studentSubject,
    email: `${studentSubject}@alu.uct.cl`,
    role: "student",
  });
  await seedUser(t, {
    subject: proSubject,
    email: `${proSubject}@uct.cl`,
    role: "professional",
  });

  const created = await registerOwnRequest(t, studentSubject);
  const requestId = created._id as Id<"requests">;
  const asProfessional = t.withIdentity(identityFor(proSubject, `${proSubject}@uct.cl`));
  await asProfessional.mutation(api.presentation.requests.takeRequest, { requestId });
  const opened = await asProfessional.mutation(api.presentation.requests.acceptRequest, {
    requestId,
    objective: "Objetivo ficticio de apertura única",
  });
  expect(opened.status).toBe("active");

  const repeatMessage = await denyMessage(
    asProfessional.mutation(api.presentation.requests.acceptRequest, {
      requestId,
      objective: "Otro objetivo ficticio",
    }),
  );
  expect(repeatMessage).toBe("La solicitud ya fue aceptada");
  expect(repeatMessage).not.toContain(String(requestId));
  expect(repeatMessage).not.toContain("Objetivo ficticio de apertura única");
  expect(repeatMessage).not.toContain("Otro objetivo ficticio");
  expect(repeatMessage).not.toContain("Necesidad de acceso ficticia");
  expect(await countAccompanimentsFor(t, requestId)).toBe(1);
  const accepted = await t.query(internal.requests.getRequestById, { id: requestId });
  expect(accepted?.status).toBe("accepted");
});
