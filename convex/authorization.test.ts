/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { FunctionReturnType } from "convex/server";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Matriz de permisos comprobable en Backend (S2).
 *
 * Cada prueba usa identidad simulada (`withIdentity` con `tokenIdentifier`
 * explícito) y datos ficticios. La autorización se resuelve en el servidor a
 * partir de `ctx.auth.getUserIdentity()`; ningún `userId` del cliente se usa
 * como prueba. Toda denegación responde `No autorizado`, sin motivo ni
 * existencia del recurso. Los listados se consumen paginados.
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
    role: "student" | "professional" | "intern" | "admin";
    institutionalStatus?: "enabled" | "disabled" | "pending";
    accountStatus?: "active" | "inactive";
  },
) {
  const tokenIdentifier = `${ISSUER}|${input.subject}`;
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: input.email,
      fullName: input.fullName,
      role: input.role,
      institutionalStatus: input.institutionalStatus ?? "enabled",
      accountStatus: input.accountStatus ?? "active",
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

async function seedRevoke(
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
    .mutation(internal.assignments.revoke, input);
}

async function seedNote(
  t: ReturnType<typeof convexTest>,
  accompanimentId: Id<"accompaniments">,
  authorId: Id<"users">,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("followUpNotes", {
      accompanimentId,
      authorId,
      body: "Nota interna ficticia",
    });
  });
}

test("estudiante lee su propio acompañamiento en vista completa", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "s2-est-1",
    email: "est1@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);

  const authed = t.withIdentity(identityFor("s2-est-1", "est1@alu.uct.cl"));
  const result = await authed.query(api.presentation.accompaniments.getAccompaniment, {
    accompanimentId,
  });
  expect(result.view).toBe("full");
  expect(result).toMatchObject({
    accessNeeds: "Necesidad de acceso ficticia",
    studentId: student.id,
  });
});

test("profesional asignado lee completo y lee notas internas", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "s2-est-2",
    email: "est2@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const pro = await seedUser(t, {
    subject: "s2-pro-1",
    email: "pro1@uct.cl",
    fullName: "Profesional Ficticio",
    role: "professional",
  });
  await seedUser(t, {
    subject: "s2-pro-0b",
    email: "pro0b@uct.cl",
    fullName: "Profesional Asignador",
    role: "professional",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);
  await seedAssignment(
    t,
    {
      accompanimentId,
      userId: pro.id,
      assignedRole: "professional",
    },
    { subject: "s2-pro-0b", email: "pro0b@uct.cl" },
  );
  await seedNote(t, accompanimentId, pro.id);

  const authed = t.withIdentity(identityFor("s2-pro-1", "pro1@uct.cl"));
  const result = await authed.query(api.presentation.accompaniments.getAccompaniment, {
    accompanimentId,
  });
  expect(result.view).toBe("full");

  const notes = await authed.query(api.presentation.accompaniments.getInternalNotes, {
    accompanimentId,
    paginationOpts: pageOpts(10),
  });
  expect(notes.page).toHaveLength(1);
  expect(notes.page[0]?.body).toBe("Nota interna ficticia");
});

test("practicante asignado lee minimizado y no lee notas internas", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "s2-est-3",
    email: "est3@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const intern = await seedUser(t, {
    subject: "s2-int-1",
    email: "int1@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
  });
  await seedUser(t, {
    subject: "s2-pro-0",
    email: "pro0@uct.cl",
    fullName: "Profesional Asignador",
    role: "professional",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);
  await seedAssignment(
    t,
    {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
    },
    { subject: "s2-pro-0", email: "pro0@uct.cl" },
  );
  await seedNote(t, accompanimentId, student.id);

  const authed = t.withIdentity(identityFor("s2-int-1", "int1@alu.uct.cl"));
  const result = await authed.query(api.presentation.accompaniments.getAccompaniment, {
    accompanimentId,
  });
  expect(result.view).toBe("minimized");
  expect(result).not.toHaveProperty("accessNeeds");

  await expect(
    authed.query(api.presentation.accompaniments.getInternalNotes, {
      accompanimentId,
      paginationOpts: pageOpts(10),
    }),
  ).rejects.toThrow("No autorizado");
});

test("listado respeta alcance: estudiante propios, profesional e intern solo asignados", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "s2-est-4",
    email: "est4@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const pro = await seedUser(t, {
    subject: "s2-pro-2",
    email: "pro2@uct.cl",
    fullName: "Profesional Ficticio",
    role: "professional",
  });
  const intern = await seedUser(t, {
    subject: "s2-int-2",
    email: "int2@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
  });
  await seedUser(t, {
    subject: "s2-pro-2b",
    email: "pro2b@uct.cl",
    fullName: "Profesional Asignador",
    role: "professional",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);
  await seedAssignment(
    t,
    {
      accompanimentId,
      userId: pro.id,
      assignedRole: "professional",
    },
    { subject: "s2-pro-2b", email: "pro2b@uct.cl" },
  );
  await seedAssignment(
    t,
    {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
    },
    { subject: "s2-pro-2b", email: "pro2b@uct.cl" },
  );

  const asStudent = t.withIdentity(identityFor("s2-est-4", "est4@alu.uct.cl"));
  const studentList = await asStudent.query(
    api.presentation.accompaniments.listOwnedAccompaniments,
    { paginationOpts: pageOpts(10) },
  );
  expect(studentList.page).toHaveLength(1);
  expect(studentList.page[0]?.view).toBe("full");

  const asPro = t.withIdentity(identityFor("s2-pro-2", "pro2@uct.cl"));
  const proList = await asPro.query(api.presentation.accompaniments.listAssignedAccompaniments, {
    limit: 10,
  });
  expect(proList.items).toHaveLength(1);
  expect(proList.items[0]?.view).toBe("full");
  expect(proList.hasMore).toBe(false);

  const asIntern = t.withIdentity(identityFor("s2-int-2", "int2@alu.uct.cl"));
  const internList = await asIntern.query(
    api.presentation.accompaniments.listAssignedAccompaniments,
    { limit: 10 },
  );
  expect(internList.items).toHaveLength(1);
  expect(internList.items[0]?.view).toBe("minimized");
  expect(internList.hasMore).toBe(false);
});

test("administrador sin acceso general: lectura, listados y notas denegados", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "s2-est-5",
    email: "est5@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  await seedUser(t, {
    subject: "s2-adm-1",
    email: "adm1@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);

  const asAdmin = t.withIdentity(identityFor("s2-adm-1", "adm1@uct.cl"));
  await expect(
    asAdmin.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
  ).rejects.toThrow("No autorizado");
  await expect(
    asAdmin.query(api.presentation.accompaniments.listOwnedAccompaniments, {
      paginationOpts: pageOpts(10),
    }),
  ).rejects.toThrow("No autorizado");
  await expect(
    asAdmin.query(api.presentation.accompaniments.listAssignedAccompaniments, { limit: 10 }),
  ).rejects.toThrow("No autorizado");
  await expect(
    asAdmin.query(api.presentation.accompaniments.getInternalNotes, {
      accompanimentId,
      paginationOpts: pageOpts(10),
    }),
  ).rejects.toThrow("No autorizado");
});

test("negativos por alcance: ajeno, sin asignación y habilitado sin asignación", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "s2-est-6",
    email: "est6@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  await seedUser(t, {
    subject: "s2-est-7",
    email: "est7@alu.uct.cl",
    fullName: "Otro Estudiante Ficticio",
    role: "student",
  });
  await seedUser(t, {
    subject: "s2-pro-3",
    email: "pro3@uct.cl",
    fullName: "Profesional Sin Asignación",
    role: "professional",
  });
  await seedUser(t, {
    subject: "s2-int-3",
    email: "int3@alu.uct.cl",
    fullName: "Practicante Habilitado Sin Asignación",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);

  const asOther = t.withIdentity(identityFor("s2-est-7", "est7@alu.uct.cl"));
  await expect(
    asOther.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
  ).rejects.toThrow("No autorizado");

  const asPro = t.withIdentity(identityFor("s2-pro-3", "pro3@uct.cl"));
  await expect(
    asPro.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
  ).rejects.toThrow("No autorizado");

  const asIntern = t.withIdentity(identityFor("s2-int-3", "int3@alu.uct.cl"));
  await expect(
    asIntern.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
  ).rejects.toThrow("No autorizado");
});

test("negativos por vigencia y revocación: deshabilitado, inactivo y revocado", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "s2-est-8",
    email: "est8@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const disabledPro = await seedUser(t, {
    subject: "s2-pro-4",
    email: "pro4@uct.cl",
    fullName: "Profesional Deshabilitado",
    role: "professional",
    institutionalStatus: "disabled",
  });
  const inactiveStudent = await seedUser(t, {
    subject: "s2-est-9",
    email: "est9@alu.uct.cl",
    fullName: "Estudiante Inactivo",
    role: "student",
    accountStatus: "inactive",
  });
  const revokedPro = await seedUser(t, {
    subject: "s2-pro-5",
    email: "pro5@uct.cl",
    fullName: "Profesional Revocado",
    role: "professional",
  });
  await seedUser(t, {
    subject: "s2-pro-5b",
    email: "pro5b@uct.cl",
    fullName: "Profesional Asignador",
    role: "professional",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);
  const ownInactiveAccompaniment = await seedAccompaniment(t, inactiveStudent.id);
  const caller = { subject: "s2-pro-5b", email: "pro5b@uct.cl" };
  await seedAssignment(
    t,
    {
      accompanimentId,
      userId: disabledPro.id,
      assignedRole: "professional",
    },
    caller,
  );
  await seedAssignment(
    t,
    {
      accompanimentId,
      userId: revokedPro.id,
      assignedRole: "professional",
    },
    caller,
  );
  await seedRevoke(
    t,
    {
      accompanimentId,
      userId: revokedPro.id,
      assignedRole: "professional",
    },
    caller,
  );

  const asDisabled = t.withIdentity(identityFor("s2-pro-4", "pro4@uct.cl"));
  await expect(
    asDisabled.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
  ).rejects.toThrow("No autorizado");

  const asInactive = t.withIdentity(identityFor("s2-est-9", "est9@alu.uct.cl"));
  await expect(
    asInactive.query(api.presentation.accompaniments.getAccompaniment, {
      accompanimentId: ownInactiveAccompaniment,
    }),
  ).rejects.toThrow("No autorizado");

  const asRevoked = t.withIdentity(identityFor("s2-pro-5", "pro5@uct.cl"));
  await expect(
    asRevoked.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
  ).rejects.toThrow("No autorizado");
});

test("negativos genéricos: sin identidad, estudiante en notas e inexistente", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "s2-est-10",
    email: "est10@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);

  await expect(
    t.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
  ).rejects.toThrow("No autorizado");

  const asStudent = t.withIdentity(identityFor("s2-est-10", "est10@alu.uct.cl"));
  await expect(
    asStudent.query(api.presentation.accompaniments.getInternalNotes, {
      accompanimentId,
      paginationOpts: pageOpts(10),
    }),
  ).rejects.toThrow("No autorizado");

  const missingId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("accompaniments", {
      studentId: student.id,
      status: "active",
      objective: "Temporal ficticio",
      accessNeeds: "Temporal ficticio",
    });
    await ctx.db.delete(id);
    return id;
  });
  await expect(
    asStudent.query(api.presentation.accompaniments.getAccompaniment, {
      accompanimentId: missingId,
    }),
  ).rejects.toThrow("No autorizado");
});

test("asignación activa duplicada se rechaza y la revocada permite reasignar", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "s2-est-11",
    email: "est11@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const pro = await seedUser(t, {
    subject: "s2-pro-6",
    email: "pro6@uct.cl",
    fullName: "Profesional Ficticio",
    role: "professional",
  });
  const intern = await seedUser(t, {
    subject: "s2-int-6",
    email: "int6@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
  });
  await seedUser(t, {
    subject: "s2-pro-6b",
    email: "pro6b@uct.cl",
    fullName: "Profesional Asignador",
    role: "professional",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);

  await seedAssignment(
    t,
    {
      accompanimentId,
      userId: pro.id,
      assignedRole: "professional",
    },
    { subject: "s2-pro-6b", email: "pro6b@uct.cl" },
  );
  await expect(
    seedAssignment(
      t,
      {
        accompanimentId,
        userId: pro.id,
        assignedRole: "professional",
      },
      { subject: "s2-pro-6b", email: "pro6b@uct.cl" },
    ),
  ).rejects.toThrow("Ya existe una asignación activa");

  await seedAssignment(
    t,
    {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
    },
    { subject: "s2-pro-6b", email: "pro6b@uct.cl" },
  );
  await seedRevoke(
    t,
    {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
    },
    { subject: "s2-pro-6b", email: "pro6b@uct.cl" },
  );
  const reassigned = await seedAssignment(
    t,
    {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
    },
    { subject: "s2-pro-6b", email: "pro6b@uct.cl" },
  );
  expect(reassigned).toBeDefined();
});

test("revocar exige profesional vigente y es idempotente", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "s2-est-16",
    email: "est16@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const pro = await seedUser(t, {
    subject: "s2-pro-10",
    email: "pro10@uct.cl",
    fullName: "Profesional Ficticio",
    role: "professional",
  });
  await seedUser(t, {
    subject: "s2-pro-10b",
    email: "pro10b@uct.cl",
    fullName: "Profesional Asignador",
    role: "professional",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);
  const caller = { subject: "s2-pro-10b", email: "pro10b@uct.cl" };
  const input = {
    accompanimentId,
    userId: pro.id,
    assignedRole: "professional" as const,
  };
  await seedAssignment(t, input, caller);

  const asStudent = t.withIdentity(identityFor("s2-est-16", "est16@alu.uct.cl"));
  await expect(asStudent.mutation(internal.assignments.revoke, input)).rejects.toThrow(
    "No autorizado",
  );

  await seedRevoke(t, input, caller);
  const asPro = t.withIdentity(identityFor("s2-pro-10", "pro10@uct.cl"));
  await expect(
    asPro.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
  ).rejects.toThrow("No autorizado");

  const second = await seedRevoke(t, input, caller);
  expect(second).toBeNull();
});

test("revocar cierra todas las filas aunque existan duplicadas fuera del Backend", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "s2-est-17",
    email: "est17@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const pro = await seedUser(t, {
    subject: "s2-pro-11",
    email: "pro11@uct.cl",
    fullName: "Profesional Ficticio",
    role: "professional",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);
  // Corrupción simulada: dos filas activas que la vía guardada jamás crearía.
  await t.run(async (ctx) => {
    await ctx.db.insert("accompanimentAssignments", {
      accompanimentId,
      userId: pro.id,
      assignedRole: "professional",
      status: "active",
      grantedBy: pro.id,
      grantedAt: 1,
    });
    await ctx.db.insert("accompanimentAssignments", {
      accompanimentId,
      userId: pro.id,
      assignedRole: "professional",
      status: "active",
      grantedBy: pro.id,
      grantedAt: 1,
    });
  });

  const caller = { subject: "s2-pro-11", email: "pro11@uct.cl" };
  const revoked = await seedRevoke(
    t,
    {
      accompanimentId,
      userId: pro.id,
      assignedRole: "professional",
    },
    caller,
  );
  expect(revoked).toBe(2);

  const asPro = t.withIdentity(identityFor("s2-pro-11", "pro11@uct.cl"));
  await expect(
    asPro.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
  ).rejects.toThrow("No autorizado");
  const list = await asPro.query(api.presentation.accompaniments.listAssignedAccompaniments, {
    limit: 10,
  });
  expect(list.items).toHaveLength(0);
  expect(list.hasMore).toBe(false);
});

test("asignar exige profesional vigente: anónimo, estudiante e inhabilitado denegados", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "s2-est-15",
    email: "est15@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const intern = await seedUser(t, {
    subject: "s2-int-4",
    email: "int4@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
  });
  await seedUser(t, {
    subject: "s2-pro-9",
    email: "pro9@uct.cl",
    fullName: "Profesional Deshabilitado",
    role: "professional",
    institutionalStatus: "disabled",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);
  const input = {
    accompanimentId,
    userId: intern.id,
    assignedRole: "intern" as const,
  };

  await expect(t.mutation(internal.assignments.assign, input)).rejects.toThrow("No autorizado");

  const asStudent = t.withIdentity(identityFor("s2-est-15", "est15@alu.uct.cl"));
  await expect(asStudent.mutation(internal.assignments.assign, input)).rejects.toThrow(
    "No autorizado",
  );

  const asDisabled = t.withIdentity(identityFor("s2-pro-9", "pro9@uct.cl"));
  await expect(asDisabled.mutation(internal.assignments.assign, input)).rejects.toThrow(
    "No autorizado",
  );
});

test("duplicadas fuera del Backend no se repiten ni pierden entre páginas", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "s2-est-12",
    email: "est12@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const pro = await seedUser(t, {
    subject: "s2-pro-7",
    email: "pro7@uct.cl",
    fullName: "Profesional Ficticio",
    role: "professional",
  });
  const accA = await seedAccompaniment(t, student.id);
  const accB = await seedAccompaniment(t, student.id);
  const accC = await seedAccompaniment(t, student.id);
  // Corrupción simulada: la vía guardada (`assign`) rechazaría las filas
  // repetidas; solo una escritura manual fuera del Backend puede producirlas.
  // Se intercalan en tiempo para que un paginado por filas las parta.
  await t.run(async (ctx) => {
    const dup = async (accompanimentId: typeof accA) => {
      await ctx.db.insert("accompanimentAssignments", {
        accompanimentId,
        userId: pro.id,
        assignedRole: "professional",
        status: "active",
        grantedBy: pro.id,
        grantedAt: 1,
      });
    };
    await dup(accA);
    await dup(accB);
    await dup(accA);
    await dup(accC);
    await dup(accB);
  });

  const asPro = t.withIdentity(identityFor("s2-pro-7", "pro7@uct.cl"));
  const seen: string[] = [];
  let after: Id<"accompaniments"> | undefined = undefined;
  let hasMore = true;
  while (hasMore) {
    const page: FunctionReturnType<
      typeof api.presentation.accompaniments.listAssignedAccompaniments
    > = await asPro.query(api.presentation.accompaniments.listAssignedAccompaniments, {
      limit: 1,
      ...(after === undefined ? {} : { after }),
    });
    for (const item of page.items) seen.push(item._id);
    hasMore = page.hasMore;
    after = page.lastId ?? undefined;
  }
  expect(seen.sort()).toEqual([accA, accB, accC].sort());
});

test("listado propio se pagina sin truncar en silencio", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "s2-est-13",
    email: "est13@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  await seedAccompaniment(t, student.id);
  await seedAccompaniment(t, student.id);
  await seedAccompaniment(t, student.id);

  const asStudent = t.withIdentity(identityFor("s2-est-13", "est13@alu.uct.cl"));
  const first = await asStudent.query(api.presentation.accompaniments.listOwnedAccompaniments, {
    paginationOpts: pageOpts(2),
  });
  expect(first.page).toHaveLength(2);
  expect(first.isDone).toBe(false);

  const second = await asStudent.query(api.presentation.accompaniments.listOwnedAccompaniments, {
    paginationOpts: { numItems: 2, cursor: first.continueCursor },
  });
  expect(second.page).toHaveLength(1);
  expect(second.isDone).toBe(true);
});

test("listado asignado se pagina con keyset sin perder ni repetir", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "s2-est-18",
    email: "est18@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const pro = await seedUser(t, {
    subject: "s2-pro-12",
    email: "pro12@uct.cl",
    fullName: "Profesional Ficticio",
    role: "professional",
  });
  const caller = { subject: "s2-pro-12b", email: "pro12b@uct.cl" };
  await seedUser(t, {
    subject: "s2-pro-12b",
    email: "pro12b@uct.cl",
    fullName: "Profesional Asignador",
    role: "professional",
  });
  const expected = [];
  for (let i = 0; i < 3; i++) {
    const accompanimentId = await seedAccompaniment(t, student.id);
    expected.push(accompanimentId);
    await seedAssignment(
      t,
      { accompanimentId, userId: pro.id, assignedRole: "professional" },
      caller,
    );
  }

  const asPro = t.withIdentity(identityFor("s2-pro-12", "pro12@uct.cl"));
  const first = await asPro.query(api.presentation.accompaniments.listAssignedAccompaniments, {
    limit: 2,
  });
  expect(first.items).toHaveLength(2);
  expect(first.hasMore).toBe(true);
  expect(first.lastId).not.toBeNull();

  const second = await asPro.query(api.presentation.accompaniments.listAssignedAccompaniments, {
    limit: 2,
    ...(first.lastId === null ? {} : { after: first.lastId }),
  });
  expect(second.items).toHaveLength(1);
  expect(second.hasMore).toBe(false);

  const all = [...first.items, ...second.items].map((item) => item._id).sort();
  expect(all).toEqual([...expected].sort());
});

test("notas internas se paginan", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "s2-est-14",
    email: "est14@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const pro = await seedUser(t, {
    subject: "s2-pro-8",
    email: "pro8@uct.cl",
    fullName: "Profesional Ficticio",
    role: "professional",
  });
  await seedUser(t, {
    subject: "s2-pro-8b",
    email: "pro8b@uct.cl",
    fullName: "Profesional Asignador",
    role: "professional",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);
  await seedAssignment(
    t,
    {
      accompanimentId,
      userId: pro.id,
      assignedRole: "professional",
    },
    { subject: "s2-pro-8b", email: "pro8b@uct.cl" },
  );
  await seedNote(t, accompanimentId, pro.id);
  await seedNote(t, accompanimentId, pro.id);
  await seedNote(t, accompanimentId, pro.id);

  const asPro = t.withIdentity(identityFor("s2-pro-8", "pro8@uct.cl"));
  const first = await asPro.query(api.presentation.accompaniments.getInternalNotes, {
    accompanimentId,
    paginationOpts: pageOpts(2),
  });
  expect(first.page).toHaveLength(2);
  expect(first.isDone).toBe(false);

  const second = await asPro.query(api.presentation.accompaniments.getInternalNotes, {
    accompanimentId,
    paginationOpts: { numItems: 2, cursor: first.continueCursor },
  });
  expect(second.page).toHaveLength(1);
  expect(second.isDone).toBe(true);
});

test("tramo solo con referencias borradas avanza sin ciclarse", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "s2-est-19",
    email: "est19@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const pro = await seedUser(t, {
    subject: "s2-pro-13",
    email: "pro13@uct.cl",
    fullName: "Profesional Ficticio",
    role: "professional",
  });
  // 600 fantasmas distintos superan el tope de 10 rondas x 51: un solo
  // llamado no agota el tramo aunque todo apunte a borrados.
  const ghosts = await t.run(async (ctx) => {
    const ids = [];
    for (let i = 0; i < 600; i++) {
      const accompanimentId = await ctx.db.insert("accompaniments", {
        studentId: student.id,
        status: "active",
        objective: "Fantasma ficticio",
        accessNeeds: "Fantasma ficticio",
      });
      await ctx.db.insert("accompanimentAssignments", {
        accompanimentId,
        userId: pro.id,
        assignedRole: "professional",
        status: "active",
        grantedBy: pro.id,
        grantedAt: 1,
      });
      ids.push(accompanimentId);
    }
    return ids;
  });
  await t.run(async (ctx) => {
    for (const id of ghosts) {
      await ctx.db.delete(id);
    }
  });

  const asPro = t.withIdentity(identityFor("s2-pro-13", "pro13@uct.cl"));
  const first = await asPro.query(api.presentation.accompaniments.listAssignedAccompaniments, {
    limit: 10,
  });
  expect(first.items).toHaveLength(0);
  expect(first.hasMore).toBe(true);
  expect(first.lastId).not.toBeNull();

  const second = await asPro.query(api.presentation.accompaniments.listAssignedAccompaniments, {
    limit: 10,
    ...(first.lastId === null ? {} : { after: first.lastId }),
  });
  expect(second.items).toHaveLength(0);
  expect(second.hasMore).toBe(false);
});
