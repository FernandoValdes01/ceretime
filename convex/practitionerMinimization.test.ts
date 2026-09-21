/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Casos de uso de lectura restringida del Practicante con minimización (TI2-25).
 *
 * Cubre el checklist de la issue sobre la API ya expuesta por TI2-5 y la
 * cadena estricta de TI2-18: el Practicante solo lista y detalla
 * acompañamientos con asignación explícita y activa, recibe la vista
 * minimizada y no puede descubrir ni modificar otros recursos.
 *
 * Supuesto minimizado pendiente de validación CERETI (PV-01, PV-16, PV-17):
 * CERETI no define la lista exacta de campos visibles del Practicante, así
 * que la vista minimizada expone solo `_id`, `status`, `objective` y `view`.
 * `studentId` y `accessNeeds` nunca se devuelven al Practicante y las notas
 * internas quedan en una consulta separada solo para profesionales
 * autorizados. No se agregan campos visibles nuevos en este incremento.
 *
 * Cada prueba usa identidad simulada (`withIdentity` con `tokenIdentifier`
 * explícito) y datos ficticios. La autorización se resuelve en el servidor a
 * partir de `ctx.auth.getUserIdentity()`; ningún `userId` del cliente se usa
 * como prueba. Toda denegación responde `No autorizado`, sin motivo ni
 * existencia del recurso. La superficie pública de acompañamientos son solo
 * consultas (`getAccompaniment`, `listOwnedAccompaniments`,
 * `listAssignedAccompaniments`, `getInternalNotes`); la única escritura es la
 * vía interna guardada (`internal.assignments.assign` y
 * `internal.assignments.revoke`), que exige un Profesional vigente distinto
 * del destinatario.
 */

const ISSUER = "https://accounts.google.com";

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
    fullName: string;
    role: "student" | "professional" | "intern";
  },
) {
  const tokenIdentifier = `${ISSUER}|${input.subject}`;
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: input.email,
      fullName: input.fullName,
      role: input.role,
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier,
    });
  });
  return { id, tokenIdentifier };
}

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

async function seedAssignment(
  t: ReturnType<typeof convexTest>,
  input: {
    accompanimentId: Id<"accompaniments">;
    userId: Id<"users">;
    assignedRole: "professional" | "intern";
  },
  caller: { subject: string; email: string },
) {
  return await t
    .withIdentity(identityFor(caller.subject, caller.email))
    .mutation(internal.assignments.assign, input);
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

test("lista solo lo asignado con vista minimizada y claves exactas", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti25-est-1",
    email: "est1@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const intern = await seedUser(t, {
    subject: "ti25-int-1",
    email: "int1@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
  });
  const granter = await seedUser(t, {
    subject: "ti25-pro-1",
    email: "pro1@uct.cl",
    fullName: "Profesional que concede",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti25-pro-1b",
    email: "pro1b@uct.cl",
    fullName: "Profesional que autoriza",
    role: "professional",
  });
  const caller = { subject: "ti25-pro-1", email: "pro1@uct.cl" };
  const bootstrap = { subject: "ti25-pro-1b", email: "pro1b@uct.cl" };
  const assignedA = await seedAccompaniment(t, student.id);
  const assignedB = await seedAccompaniment(t, student.id);
  await seedAccompaniment(t, student.id);
  await seedAssignment(
    t,
    { accompanimentId: assignedA, userId: granter.id, assignedRole: "professional" },
    bootstrap,
  );
  await seedAssignment(
    t,
    { accompanimentId: assignedB, userId: granter.id, assignedRole: "professional" },
    bootstrap,
  );
  await seedAssignment(
    t,
    { accompanimentId: assignedA, userId: intern.id, assignedRole: "intern" },
    caller,
  );
  await seedAssignment(
    t,
    { accompanimentId: assignedB, userId: intern.id, assignedRole: "intern" },
    caller,
  );

  const asIntern = t.withIdentity(identityFor("ti25-int-1", "int1@alu.uct.cl"));
  const list = await asIntern.query(api.presentation.accompaniments.listAssignedAccompaniments, {
    limit: 10,
  });
  expect(list.items).toHaveLength(2);
  expect(list.hasMore).toBe(false);
  const ids = list.items.map((item) => item._id).sort();
  expect(ids).toEqual([assignedA, assignedB].sort());
  for (const item of list.items) {
    expect(item.view).toBe("minimized");
    expect(Object.keys(item).sort()).toEqual(["_id", "objective", "status", "view"]);
    expect(item).not.toHaveProperty("studentId");
    expect(item).not.toHaveProperty("accessNeeds");
  }
});

test("listado asignado se pagina sin descubrir el resto", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti25-est-2",
    email: "est2@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const intern = await seedUser(t, {
    subject: "ti25-int-2",
    email: "int2@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
  });
  const granter = await seedUser(t, {
    subject: "ti25-pro-2",
    email: "pro2@uct.cl",
    fullName: "Profesional que concede",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti25-pro-2b",
    email: "pro2b@uct.cl",
    fullName: "Profesional que autoriza",
    role: "professional",
  });
  const caller = { subject: "ti25-pro-2", email: "pro2@uct.cl" };
  const bootstrap = { subject: "ti25-pro-2b", email: "pro2b@uct.cl" };
  const assignedA = await seedAccompaniment(t, student.id);
  const assignedB = await seedAccompaniment(t, student.id);
  await seedAccompaniment(t, student.id);
  await seedAssignment(
    t,
    { accompanimentId: assignedA, userId: granter.id, assignedRole: "professional" },
    bootstrap,
  );
  await seedAssignment(
    t,
    { accompanimentId: assignedB, userId: granter.id, assignedRole: "professional" },
    bootstrap,
  );
  await seedAssignment(
    t,
    { accompanimentId: assignedA, userId: intern.id, assignedRole: "intern" },
    caller,
  );
  await seedAssignment(
    t,
    { accompanimentId: assignedB, userId: intern.id, assignedRole: "intern" },
    caller,
  );

  const asIntern = t.withIdentity(identityFor("ti25-int-2", "int2@alu.uct.cl"));
  const first = await asIntern.query(api.presentation.accompaniments.listAssignedAccompaniments, {
    limit: 1,
  });
  expect(first.items).toHaveLength(1);
  expect(first.items[0]?.view).toBe("minimized");
  expect(first.hasMore).toBe(true);
  expect(first.lastId).not.toBeNull();

  const second = await asIntern.query(api.presentation.accompaniments.listAssignedAccompaniments, {
    limit: 1,
    ...(first.lastId === null ? {} : { after: first.lastId }),
  });
  expect(second.items).toHaveLength(1);
  expect(second.items[0]?.view).toBe("minimized");
  expect(second.hasMore).toBe(false);

  const seen = [...first.items, ...second.items].map((item) => item._id).sort();
  expect(seen).toEqual([assignedA, assignedB].sort());
});

test("detalle asignado minimiza con claves exactas", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti25-est-3",
    email: "est3@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const intern = await seedUser(t, {
    subject: "ti25-int-3",
    email: "int3@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
  });
  const granter3 = await seedUser(t, {
    subject: "ti25-pro-3",
    email: "pro3@uct.cl",
    fullName: "Profesional que concede",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti25-pro-3b",
    email: "pro3b@uct.cl",
    fullName: "Profesional que autoriza",
    role: "professional",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);
  await seedAssignment(
    t,
    { accompanimentId, userId: granter3.id, assignedRole: "professional" },
    { subject: "ti25-pro-3b", email: "pro3b@uct.cl" },
  );
  await seedAssignment(
    t,
    { accompanimentId, userId: intern.id, assignedRole: "intern" },
    { subject: "ti25-pro-3", email: "pro3@uct.cl" },
  );

  const asIntern = t.withIdentity(identityFor("ti25-int-3", "int3@alu.uct.cl"));
  const result = await asIntern.query(api.presentation.accompaniments.getAccompaniment, {
    accompanimentId,
  });
  expect(result.view).toBe("minimized");
  expect(Object.keys(result).sort()).toEqual(["_id", "objective", "status", "view"]);
  expect(result).toEqual({
    _id: accompanimentId,
    status: "active",
    objective: "Objetivo ficticio",
    view: "minimized",
  });
});

test("acceso directo por ID no asignado se rechaza sin filtrar", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti25-est-4",
    email: "est4@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const intern = await seedUser(t, {
    subject: "ti25-int-4",
    email: "int4@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
  });
  const granter4 = await seedUser(t, {
    subject: "ti25-pro-4",
    email: "pro4@uct.cl",
    fullName: "Profesional que concede",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti25-pro-4b",
    email: "pro4b@uct.cl",
    fullName: "Profesional que autoriza",
    role: "professional",
  });
  const assignedId = await seedAccompaniment(t, student.id);
  const otherId = await seedAccompaniment(t, student.id);
  await seedAssignment(
    t,
    { accompanimentId: assignedId, userId: granter4.id, assignedRole: "professional" },
    { subject: "ti25-pro-4b", email: "pro4b@uct.cl" },
  );
  await seedAssignment(
    t,
    { accompanimentId: assignedId, userId: intern.id, assignedRole: "intern" },
    { subject: "ti25-pro-4", email: "pro4@uct.cl" },
  );

  const asIntern = t.withIdentity(identityFor("ti25-int-4", "int4@alu.uct.cl"));
  const detailMessage = await denyMessage(
    asIntern.query(api.presentation.accompaniments.getAccompaniment, {
      accompanimentId: otherId,
    }),
  );
  expect(detailMessage).toContain("No autorizado");
  expect(detailMessage).not.toContain(String(otherId));
  expect(detailMessage).not.toContain("Necesidad de acceso ficticia");
  expect(detailMessage).not.toContain("Objetivo ficticio");

  const notesMessage = await denyMessage(
    asIntern.query(api.presentation.accompaniments.getInternalNotes, {
      accompanimentId: otherId,
      paginationOpts: pageOpts(10),
    }),
  );
  expect(notesMessage).toContain("No autorizado");
  expect(notesMessage).not.toContain(String(otherId));
});

test("vía propia y notas internas denegadas para practicante", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti25-est-5",
    email: "est5@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const intern = await seedUser(t, {
    subject: "ti25-int-5",
    email: "int5@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
  });
  const granter5 = await seedUser(t, {
    subject: "ti25-pro-5",
    email: "pro5@uct.cl",
    fullName: "Profesional que concede",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti25-pro-5b",
    email: "pro5b@uct.cl",
    fullName: "Profesional que autoriza",
    role: "professional",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);
  await seedAssignment(
    t,
    { accompanimentId, userId: granter5.id, assignedRole: "professional" },
    { subject: "ti25-pro-5b", email: "pro5b@uct.cl" },
  );
  await seedAssignment(
    t,
    { accompanimentId, userId: intern.id, assignedRole: "intern" },
    { subject: "ti25-pro-5", email: "pro5@uct.cl" },
  );

  const asIntern = t.withIdentity(identityFor("ti25-int-5", "int5@alu.uct.cl"));
  await expect(
    asIntern.query(api.presentation.accompaniments.listOwnedAccompaniments, {
      paginationOpts: pageOpts(10),
    }),
  ).rejects.toThrow("No autorizado");

  await expect(
    asIntern.query(api.presentation.accompaniments.getInternalNotes, {
      accompanimentId,
      paginationOpts: pageOpts(10),
    }),
  ).rejects.toThrow("No autorizado");
});

test("intentos de modificación del practicante se rechazan", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti25-est-6",
    email: "est6@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const intern = await seedUser(t, {
    subject: "ti25-int-6",
    email: "int6@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
  });
  const otherIntern = await seedUser(t, {
    subject: "ti25-int-7",
    email: "int7@alu.uct.cl",
    fullName: "Otro Practicante Ficticio",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);

  const asIntern = t.withIdentity(identityFor("ti25-int-6", "int6@alu.uct.cl"));
  await expect(
    asIntern.mutation(internal.assignments.assign, {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
    }),
  ).rejects.toThrow("No autorizado");
  await expect(
    asIntern.mutation(internal.assignments.assign, {
      accompanimentId,
      userId: otherIntern.id,
      assignedRole: "intern",
    }),
  ).rejects.toThrow("No autorizado");
  await expect(
    asIntern.mutation(internal.assignments.revoke, {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
    }),
  ).rejects.toThrow("No autorizado");
});
