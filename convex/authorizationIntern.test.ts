/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Cadena estricta de Practicante en Backend (TI2-18).
 *
 * Cada prueba usa identidad simulada (`withIdentity` con `tokenIdentifier`
 * explícito) y datos ficticios. La autorización se resuelve en el servidor a
 * partir de `ctx.auth.getUserIdentity()`; ningún `userId` del cliente se usa
 * como prueba. Toda denegación responde `No autorizado`, sin motivo ni
 * existencia del recurso. La asignación siempre la otorga otro profesional
 * autorizado: nadie puede asignarse acceso a sí mismo.
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

/** Mensaje de la denegación, o falla si la operación fue permitida. */
async function denyMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Se esperaba denegación y la operación fue permitida");
}

test("practicante habilitado con asignación explícita lee minimizado sin datos sensibles", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti18-est-1",
    email: "est1@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const intern = await seedUser(t, {
    subject: "ti18-int-1",
    email: "int1@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
  });
  const assigner = await seedUser(t, {
    subject: "ti18-pro-1",
    email: "pro1@uct.cl",
    fullName: "Profesional Asignador",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti18-pro-1b",
    email: "pro1b@uct.cl",
    fullName: "Profesional Bootstrap",
    role: "professional",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);
  await seedAssignment(
    t,
    { accompanimentId, userId: assigner.id, assignedRole: "professional" },
    { subject: "ti18-pro-1b", email: "pro1b@uct.cl" },
  );
  await seedAssignment(
    t,
    { accompanimentId, userId: intern.id, assignedRole: "intern" },
    { subject: "ti18-pro-1", email: "pro1@uct.cl" },
  );

  const asIntern = t.withIdentity(identityFor("ti18-int-1", "int1@alu.uct.cl"));
  const result = await asIntern.query(api.presentation.accompaniments.getAccompaniment, {
    accompanimentId,
  });
  expect(result.view).toBe("minimized");
  expect(result).not.toHaveProperty("accessNeeds");
  expect(result).not.toHaveProperty("studentId");

  await expect(
    asIntern.query(api.presentation.accompaniments.getInternalNotes, {
      accompanimentId,
      paginationOpts: pageOpts(10),
    }),
  ).rejects.toThrow("No autorizado");
});

test("practicante solo lista lo asignado y no descubre el resto", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti18-est-2",
    email: "est2@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const intern = await seedUser(t, {
    subject: "ti18-int-2",
    email: "int2@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
  });
  const assigner = await seedUser(t, {
    subject: "ti18-pro-2",
    email: "pro2@uct.cl",
    fullName: "Profesional Asignador",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti18-pro-2b",
    email: "pro2b@uct.cl",
    fullName: "Profesional Bootstrap",
    role: "professional",
  });
  const assignedId = await seedAccompaniment(t, student.id);
  const otherId = await seedAccompaniment(t, student.id);
  await seedAssignment(
    t,
    { accompanimentId: assignedId, userId: assigner.id, assignedRole: "professional" },
    { subject: "ti18-pro-2b", email: "pro2b@uct.cl" },
  );
  await seedAssignment(
    t,
    { accompanimentId: assignedId, userId: intern.id, assignedRole: "intern" },
    { subject: "ti18-pro-2", email: "pro2@uct.cl" },
  );

  const asIntern = t.withIdentity(identityFor("ti18-int-2", "int2@alu.uct.cl"));
  const list = await asIntern.query(api.presentation.accompaniments.listAssignedAccompaniments, {
    limit: 10,
  });
  expect(list.items).toHaveLength(1);
  expect(list.items[0]?._id).toEqual(assignedId);
  expect(list.items[0]?.view).toBe("minimized");
  expect(list.hasMore).toBe(false);

  const message = await denyMessage(
    asIntern.query(api.presentation.accompaniments.getAccompaniment, {
      accompanimentId: otherId,
    }),
  );
  expect(message).toContain("No autorizado");
  expect(message).not.toContain(String(otherId));
});

test("practicante habilitado sin asignación no lee ni lista", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti18-est-3",
    email: "est3@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  await seedUser(t, {
    subject: "ti18-int-3",
    email: "int3@alu.uct.cl",
    fullName: "Practicante Habilitado Sin Asignación",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);

  const asIntern = t.withIdentity(identityFor("ti18-int-3", "int3@alu.uct.cl"));
  const message = await denyMessage(
    asIntern.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
  );
  expect(message).toContain("No autorizado");
  expect(message).not.toContain("Necesidad de acceso ficticia");

  const list = await asIntern.query(api.presentation.accompaniments.listAssignedAccompaniments, {
    limit: 10,
  });
  expect(list.items).toHaveLength(0);
  expect(list.hasMore).toBe(false);
});

test("asignación revocada deja de autorizar al practicante", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti18-est-4",
    email: "est4@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const intern = await seedUser(t, {
    subject: "ti18-int-4",
    email: "int4@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
  });
  const assigner = await seedUser(t, {
    subject: "ti18-pro-4",
    email: "pro4@uct.cl",
    fullName: "Profesional Asignador",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti18-pro-4b",
    email: "pro4b@uct.cl",
    fullName: "Profesional Bootstrap",
    role: "professional",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);
  const input = { accompanimentId, userId: intern.id, assignedRole: "intern" as const };
  const caller = { subject: "ti18-pro-4", email: "pro4@uct.cl" };
  await seedAssignment(
    t,
    { accompanimentId, userId: assigner.id, assignedRole: "professional" },
    { subject: "ti18-pro-4b", email: "pro4b@uct.cl" },
  );
  await seedAssignment(t, input, caller);
  await seedRevoke(t, input, caller);

  const asIntern = t.withIdentity(identityFor("ti18-int-4", "int4@alu.uct.cl"));
  await expect(
    asIntern.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
  ).rejects.toThrow("No autorizado");

  const list = await asIntern.query(api.presentation.accompaniments.listAssignedAccompaniments, {
    limit: 10,
  });
  expect(list.items).toHaveLength(0);
});

test("cuenta no habilitada o no vigente no lee aunque tenga asignación", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti18-est-5",
    email: "est5@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const disabled = await seedUser(t, {
    subject: "ti18-int-5",
    email: "int5@alu.uct.cl",
    fullName: "Practicante Deshabilitado",
    role: "intern",
    institutionalStatus: "disabled",
  });
  const pending = await seedUser(t, {
    subject: "ti18-int-6",
    email: "int6@alu.uct.cl",
    fullName: "Practicante Pendiente",
    role: "intern",
    institutionalStatus: "pending",
  });
  const inactive = await seedUser(t, {
    subject: "ti18-int-7",
    email: "int7@alu.uct.cl",
    fullName: "Practicante Inactivo",
    role: "intern",
    accountStatus: "inactive",
  });
  await seedUser(t, {
    subject: "ti18-pro-5",
    email: "pro5@uct.cl",
    fullName: "Profesional Asignador",
    role: "professional",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);
  // Asignación directa fuera de la vía guardada para probar lectura con
  // cuenta no habilitada: la vía guardada (TI2-28) ya rechaza conceder a
  // quien no está habilitado, pero la lectura debe seguir denegando aunque
  // exista una fila legacy.
  await t.run(async (ctx) => {
    for (const target of [disabled, pending, inactive]) {
      await ctx.db.insert("accompanimentAssignments", {
        accompanimentId,
        userId: target.id,
        assignedRole: "intern",
        status: "active",
      });
    }
  });

  for (const callerIdentity of [
    { subject: "ti18-int-5", email: "int5@alu.uct.cl" },
    { subject: "ti18-int-6", email: "int6@alu.uct.cl" },
    { subject: "ti18-int-7", email: "int7@alu.uct.cl" },
  ]) {
    const authed = t.withIdentity(identityFor(callerIdentity.subject, callerIdentity.email));
    await expect(
      authed.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
    ).rejects.toThrow("No autorizado");
  }
});

test("practicante no puede crear ni revocar asignaciones", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti18-est-8",
    email: "est8@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const intern = await seedUser(t, {
    subject: "ti18-int-8",
    email: "int8@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);

  const asIntern = t.withIdentity(identityFor("ti18-int-8", "int8@alu.uct.cl"));
  await expect(
    asIntern.mutation(internal.assignments.assign, {
      accompanimentId,
      userId: intern.id,
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

test("nadie puede asignarse acceso a sí mismo", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti18-est-9",
    email: "est9@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const pro = await seedUser(t, {
    subject: "ti18-pro-9",
    email: "pro9@uct.cl",
    fullName: "Profesional Ficticio",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti18-adm-9",
    email: "adm9@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);

  const asPro = t.withIdentity(identityFor("ti18-pro-9", "pro9@uct.cl"));
  await expect(
    asPro.mutation(internal.assignments.assign, {
      accompanimentId,
      userId: pro.id,
      assignedRole: "professional",
    }),
  ).rejects.toThrow("No autorizado");
  // El bloqueo por asignarse a sí mismo precede a la validación de rol:
  // responde el mismo error genérico y no el de coherencia de rol.
  await expect(
    asPro.mutation(internal.assignments.assign, {
      accompanimentId,
      userId: pro.id,
      assignedRole: "intern",
    }),
  ).rejects.toThrow("No autorizado");

  const asAdmin = t.withIdentity(identityFor("ti18-adm-9", "adm9@uct.cl"));
  await expect(
    asAdmin.mutation(internal.assignments.assign, {
      accompanimentId,
      userId: pro.id,
      assignedRole: "professional",
    }),
  ).rejects.toThrow("No autorizado");
});

test("inexistente responde igual que denegado para practicante", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti18-est-10",
    email: "est10@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  await seedUser(t, {
    subject: "ti18-int-10",
    email: "int10@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
  });
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

  const asIntern = t.withIdentity(identityFor("ti18-int-10", "int10@alu.uct.cl"));
  const message = await denyMessage(
    asIntern.query(api.presentation.accompaniments.getAccompaniment, {
      accompanimentId: missingId,
    }),
  );
  expect(message).toContain("No autorizado");
  expect(message).not.toContain(String(missingId));
});
