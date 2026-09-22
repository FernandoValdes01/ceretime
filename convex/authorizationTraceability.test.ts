/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Trazabilidad mínima, errores seguros y pruebas negativas (TI2-19).
 *
 * Cubre solo las operaciones sensibles de Sprint 1: habilitación de cuenta de
 * Practicante por Administrador y concesión o revocación de acceso por
 * Profesional autorizado. No crea un sistema general de auditoría.
 *
 * Cada prueba usa identidad simulada (`withIdentity` con `tokenIdentifier`
 * explícito) y datos ficticios. La autorización se resuelve en el servidor a
 * partir de `ctx.auth.getUserIdentity()`; ningún `userId` del cliente se usa
 * como prueba. Toda denegación responde `No autorizado`, sin motivo ni
 * existencia del recurso.
 */

const ISSUER = "https://accounts.google.com";
const DENIED = "No autorizado";

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
    role: "student" | "professional" | "intern" | "admin";
    institutionalStatus?: "enabled" | "disabled" | "pending";
    accountStatus?: "active" | "inactive";
  },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: input.email,
      fullName: "Ficticio",
      role: input.role,
      institutionalStatus: input.institutionalStatus ?? "enabled",
      accountStatus: input.accountStatus ?? "active",
      tokenIdentifier: `${ISSUER}|${input.subject}`,
    });
  });
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

async function findAssignmentRow(
  t: TestConvex<typeof schema>,
  input: {
    accompanimentId: Id<"accompaniments">;
    userId: Id<"users">;
    assignedRole: "professional" | "intern";
  },
) {
  return await t.run(async (ctx) => {
    for (const status of ["active", "revoked"] as const) {
      const rows = await ctx.db
        .query("accompanimentAssignments")
        .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
          q
            .eq("accompanimentId", input.accompanimentId)
            .eq("userId", input.userId)
            .eq("status", status)
            .eq("assignedRole", input.assignedRole),
        )
        .take(1);
      if (rows[0] !== undefined) return rows[0];
    }
    return null;
  });
}

async function denyMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Se esperaba denegación y la operación fue permitida");
}

async function missingAccompanimentId(t: ReturnType<typeof convexTest>, studentId: Id<"users">) {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("accompaniments", {
      studentId,
      status: "active",
      objective: "Temporal ficticio",
      accessNeeds: "Temporal ficticio",
    });
    await ctx.db.delete(id);
    return id;
  });
}

async function missingUserId(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      email: "temporal.ficticio@alu.uct.cl",
      fullName: "Temporal Ficticio",
      role: "intern",
      institutionalStatus: "pending",
      accountStatus: "active",
      tokenIdentifier: "https://accounts.google.com|temporal-ti19",
    });
    await ctx.db.delete(id);
    return id;
  });
}

test("habilitación registra actor, fecha y recurso sin cambiar el rol", async () => {
  const t = convexTest(schema, modules);
  const adminId = await seedUser(t, {
    subject: "ti19-adm-1",
    email: "adm1@uct.cl",
    role: "admin",
  });
  const internId = await seedUser(t, {
    subject: "ti19-int-1",
    email: "int1@alu.uct.cl",
    role: "intern",
    institutionalStatus: "pending",
  });

  const asAdmin = t.withIdentity(identityFor("ti19-adm-1", "adm1@uct.cl"));
  const enabledId = await asAdmin.mutation(internal.accounts.enableIntern, { userId: internId });
  expect(enabledId).toEqual(internId);

  const stored = await t.run(async (ctx) => {
    return await ctx.db.get(internId);
  });
  expect(stored?.institutionalStatus).toBe("enabled");
  expect(stored?.role).toBe("intern");
  expect(stored?.email).toBe("int1@alu.uct.cl");
  expect(stored?.enabledBy).toEqual(adminId);
  expect(typeof stored?.enabledAt).toBe("number");

  const duplicate = await denyMessage(
    asAdmin.mutation(internal.accounts.enableIntern, { userId: internId }),
  );
  expect(duplicate).toBe(DENIED);
});

test("concesión y revocación registran actor, fecha y recurso", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti19-est-2",
    email: "est2@alu.uct.cl",
    role: "student",
  });
  const granterId = await seedUser(t, {
    subject: "ti19-pro-2",
    email: "pro2@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti19-pro-2b",
    email: "pro2b@uct.cl",
    role: "professional",
  });
  const internId = await seedUser(t, {
    subject: "ti19-int-2",
    email: "int2@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, studentId);
  const input = { accompanimentId, userId: internId, assignedRole: "intern" as const };

  await t
    .withIdentity(identityFor("ti19-pro-2b", "pro2b@uct.cl"))
    .mutation(internal.assignments.assign, {
      accompanimentId,
      userId: granterId,
      assignedRole: "professional",
    });

  const asGranter = t.withIdentity(identityFor("ti19-pro-2", "pro2@uct.cl"));
  await asGranter.mutation(internal.assignments.assign, input);

  const granted = await findAssignmentRow(t, input);
  expect(granted?.status).toBe("active");
  expect(granted?.accompanimentId).toEqual(accompanimentId);
  expect(granted?.userId).toEqual(internId);
  expect(granted?.assignedRole).toBe("intern");
  expect(granted?.grantedBy).toEqual(granterId);
  expect(typeof granted?.grantedAt).toBe("number");
  expect(granted?.revokedBy).toBeUndefined();
  expect(granted?.revokedAt).toBeUndefined();

  await asGranter.mutation(internal.assignments.revoke, input);
  const revoked = await findAssignmentRow(t, input);
  expect(revoked?.status).toBe("revoked");
  expect(revoked?.grantedBy).toEqual(granterId);
  expect(typeof revoked?.grantedAt).toBe("number");
  expect(revoked?.revokedBy).toEqual(granterId);
  expect(typeof revoked?.revokedAt).toBe("number");

  const second = await asGranter.mutation(internal.assignments.revoke, input);
  expect(second).toBeNull();
});

test("denegación normalizada no filtra existencia del recurso", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti19-est-3",
    email: "est3@alu.uct.cl",
    role: "student",
  });
  const granterId = await seedUser(t, {
    subject: "ti19-pro-3",
    email: "pro3@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti19-pro-3b",
    email: "pro3b@uct.cl",
    role: "professional",
  });
  const internId = await seedUser(t, {
    subject: "ti19-int-3",
    email: "int3@alu.uct.cl",
    role: "intern",
  });
  await seedUser(t, {
    subject: "ti19-adm-3",
    email: "adm3@uct.cl",
    role: "admin",
  });
  const accompanimentId = await seedAccompaniment(t, studentId);
  await t
    .withIdentity(identityFor("ti19-pro-3b", "pro3b@uct.cl"))
    .mutation(internal.assignments.assign, {
      accompanimentId,
      userId: granterId,
      assignedRole: "professional",
    });

  const missingAccompaniment = await missingAccompanimentId(t, studentId);
  const missingUser = await missingUserId(t);
  const asIntern = t.withIdentity(identityFor("ti19-int-3", "int3@alu.uct.cl"));
  const asGranter = t.withIdentity(identityFor("ti19-pro-3", "pro3@uct.cl"));
  const asAdmin = t.withIdentity(identityFor("ti19-adm-3", "adm3@uct.cl"));

  const detailMissing = await denyMessage(
    asIntern.query(api.presentation.accompaniments.getAccompaniment, {
      accompanimentId: missingAccompaniment,
    }),
  );
  const detailDenied = await denyMessage(
    asIntern.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
  );
  expect(detailMissing).toBe(DENIED);
  expect(detailDenied).toBe(DENIED);
  expect(detailMissing).not.toContain(String(missingAccompaniment));
  expect(detailDenied).not.toContain("Necesidad de acceso ficticia");

  const notesMissing = await denyMessage(
    asIntern.query(api.presentation.accompaniments.getInternalNotes, {
      accompanimentId: missingAccompaniment,
      paginationOpts: pageOpts(10),
    }),
  );
  expect(notesMissing).toBe(DENIED);
  expect(notesMissing).not.toContain(String(missingAccompaniment));

  const assignMissing = await denyMessage(
    asGranter.mutation(internal.assignments.assign, {
      accompanimentId: missingAccompaniment,
      userId: internId,
      assignedRole: "intern",
    }),
  );
  expect(assignMissing).toBe(DENIED);
  expect(assignMissing).not.toContain(String(missingAccompaniment));

  const revokeMissing = await denyMessage(
    asGranter.mutation(internal.assignments.revoke, {
      accompanimentId: missingAccompaniment,
      userId: internId,
      assignedRole: "intern",
    }),
  );
  expect(revokeMissing).toBe(DENIED);

  const enableMissing = await denyMessage(
    asAdmin.mutation(internal.accounts.enableIntern, { userId: missingUser }),
  );
  expect(enableMissing).toBe(DENIED);
  expect(enableMissing).not.toContain(String(missingUser));

  const anonymous = await denyMessage(
    t.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
  );
  expect(anonymous).toBe(DENIED);
});

test("administrador no obtiene acceso irrestricto a acompañamientos", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti19-est-4",
    email: "est4@alu.uct.cl",
    role: "student",
  });
  await seedUser(t, {
    subject: "ti19-adm-4",
    email: "adm4@uct.cl",
    role: "admin",
  });
  const internId = await seedUser(t, {
    subject: "ti19-int-4",
    email: "int4@alu.uct.cl",
    role: "intern",
    institutionalStatus: "pending",
  });
  const accompanimentId = await seedAccompaniment(t, studentId);

  const asAdmin = t.withIdentity(identityFor("ti19-adm-4", "adm4@uct.cl"));
  await asAdmin.mutation(internal.accounts.enableIntern, { userId: internId });

  expect(
    await denyMessage(
      asAdmin.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
    ),
  ).toBe(DENIED);
  expect(
    await denyMessage(
      asAdmin.query(api.presentation.accompaniments.listOwnedAccompaniments, {
        paginationOpts: pageOpts(10),
      }),
    ),
  ).toBe(DENIED);
  expect(
    await denyMessage(
      asAdmin.query(api.presentation.accompaniments.listAssignedAccompaniments, { limit: 10 }),
    ),
  ).toBe(DENIED);
  expect(
    await denyMessage(
      asAdmin.query(api.presentation.accompaniments.getInternalNotes, {
        accompanimentId,
        paginationOpts: pageOpts(10),
      }),
    ),
  ).toBe(DENIED);
  expect(
    await denyMessage(
      asAdmin.mutation(internal.assignments.assign, {
        accompanimentId,
        userId: internId,
        assignedRole: "intern",
      }),
    ),
  ).toBe(DENIED);
  expect(
    await denyMessage(
      asAdmin.mutation(internal.assignments.revoke, {
        accompanimentId,
        userId: internId,
        assignedRole: "intern",
      }),
    ),
  ).toBe(DENIED);
});

test("asignación propia de practicante queda rechazada", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti19-est-5",
    email: "est5@alu.uct.cl",
    role: "student",
  });
  const granterId = await seedUser(t, {
    subject: "ti19-pro-5",
    email: "pro5@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti19-pro-5b",
    email: "pro5b@uct.cl",
    role: "professional",
  });
  const internId = await seedUser(t, {
    subject: "ti19-int-5",
    email: "int5@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, studentId);
  await t
    .withIdentity(identityFor("ti19-pro-5b", "pro5b@uct.cl"))
    .mutation(internal.assignments.assign, {
      accompanimentId,
      userId: granterId,
      assignedRole: "professional",
    });

  const asGranter = t.withIdentity(identityFor("ti19-pro-5", "pro5@uct.cl"));
  const selfProfessional = await denyMessage(
    asGranter.mutation(internal.assignments.assign, {
      accompanimentId,
      userId: granterId,
      assignedRole: "professional",
    }),
  );
  expect(selfProfessional).toBe(DENIED);

  const selfIntern = await denyMessage(
    asGranter.mutation(internal.assignments.assign, {
      accompanimentId,
      userId: granterId,
      assignedRole: "intern",
    }),
  );
  expect(selfIntern).toBe(DENIED);

  const asIntern = t.withIdentity(identityFor("ti19-int-5", "int5@alu.uct.cl"));
  const internSelf = await denyMessage(
    asIntern.mutation(internal.assignments.assign, {
      accompanimentId,
      userId: internId,
      assignedRole: "intern",
    }),
  );
  expect(internSelf).toBe(DENIED);

  expect(
    await findAssignmentRow(t, {
      accompanimentId,
      userId: granterId,
      assignedRole: "intern",
    }),
  ).toBeNull();
  expect(
    await findAssignmentRow(t, {
      accompanimentId,
      userId: internId,
      assignedRole: "intern",
    }),
  ).toBeNull();
});

test("acceso posterior a revocación queda rechazado", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti19-est-6",
    email: "est6@alu.uct.cl",
    role: "student",
  });
  const granterId = await seedUser(t, {
    subject: "ti19-pro-6",
    email: "pro6@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti19-pro-6b",
    email: "pro6b@uct.cl",
    role: "professional",
  });
  const internId = await seedUser(t, {
    subject: "ti19-int-6",
    email: "int6@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, studentId);
  const input = { accompanimentId, userId: internId, assignedRole: "intern" as const };

  await t
    .withIdentity(identityFor("ti19-pro-6b", "pro6b@uct.cl"))
    .mutation(internal.assignments.assign, {
      accompanimentId,
      userId: granterId,
      assignedRole: "professional",
    });
  const asGranter = t.withIdentity(identityFor("ti19-pro-6", "pro6@uct.cl"));
  await asGranter.mutation(internal.assignments.assign, input);

  const asIntern = t.withIdentity(identityFor("ti19-int-6", "int6@alu.uct.cl"));
  const before = await asIntern.query(api.presentation.accompaniments.getAccompaniment, {
    accompanimentId,
  });
  expect(before.view).toBe("minimized");
  const listedBefore = await asIntern.query(
    api.presentation.accompaniments.listAssignedAccompaniments,
    { limit: 10 },
  );
  expect(listedBefore.items).toHaveLength(1);

  await asGranter.mutation(internal.assignments.revoke, input);

  expect(
    await denyMessage(
      asIntern.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
    ),
  ).toBe(DENIED);
  const listedAfter = await asIntern.query(
    api.presentation.accompaniments.listAssignedAccompaniments,
    { limit: 10 },
  );
  expect(listedAfter.items).toHaveLength(0);
  expect(listedAfter.hasMore).toBe(false);
  expect(
    await denyMessage(
      asIntern.query(api.presentation.accompaniments.getInternalNotes, {
        accompanimentId,
        paginationOpts: pageOpts(10),
      }),
    ),
  ).toBe(DENIED);
});

test("trazabilidad mínima no expone datos innecesarios", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti19-est-7",
    email: "est7@alu.uct.cl",
    role: "student",
  });
  const granterId = await seedUser(t, {
    subject: "ti19-pro-7",
    email: "pro7@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti19-pro-7b",
    email: "pro7b@uct.cl",
    role: "professional",
  });
  const internId = await seedUser(t, {
    subject: "ti19-int-7",
    email: "int7@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, studentId);
  await t
    .withIdentity(identityFor("ti19-pro-7b", "pro7b@uct.cl"))
    .mutation(internal.assignments.assign, {
      accompanimentId,
      userId: granterId,
      assignedRole: "professional",
    });
  await t
    .withIdentity(identityFor("ti19-pro-7", "pro7@uct.cl"))
    .mutation(internal.assignments.assign, {
      accompanimentId,
      userId: internId,
      assignedRole: "intern",
    });
  await t.run(async (ctx) => {
    await ctx.db.insert("followUpNotes", {
      accompanimentId,
      authorId: granterId,
      body: "Nota interna ficticia",
    });
  });

  const asGranter = t.withIdentity(identityFor("ti19-pro-7", "pro7@uct.cl"));
  const full = await asGranter.query(api.presentation.accompaniments.getAccompaniment, {
    accompanimentId,
  });
  expect(full.view).toBe("full");
  expect(Object.keys(full).sort()).toEqual([
    "_id",
    "accessNeeds",
    "objective",
    "status",
    "studentId",
    "view",
  ]);
  expect(full).not.toHaveProperty("grantedBy");
  expect(full).not.toHaveProperty("grantedAt");
  expect(full).not.toHaveProperty("revokedBy");
  expect(full).not.toHaveProperty("revokedAt");
  expect(full).not.toHaveProperty("enabledBy");
  expect(full).not.toHaveProperty("enabledAt");

  const asIntern = t.withIdentity(identityFor("ti19-int-7", "int7@alu.uct.cl"));
  const minimized = await asIntern.query(api.presentation.accompaniments.getAccompaniment, {
    accompanimentId,
  });
  expect(Object.keys(minimized).sort()).toEqual(["_id", "objective", "status", "view"]);
  expect(minimized).not.toHaveProperty("studentId");
  expect(minimized).not.toHaveProperty("accessNeeds");
  expect(minimized).not.toHaveProperty("grantedBy");
  expect(minimized).not.toHaveProperty("revokedBy");

  const assigned = await asIntern.query(
    api.presentation.accompaniments.listAssignedAccompaniments,
    { limit: 10 },
  );
  expect(assigned.items).toHaveLength(1);
  expect(Object.keys(assigned.items[0] ?? {}).sort()).toEqual([
    "_id",
    "objective",
    "status",
    "view",
  ]);

  const notes = await asGranter.query(api.presentation.accompaniments.getInternalNotes, {
    accompanimentId,
    paginationOpts: pageOpts(10),
  });
  expect(notes.page).toHaveLength(1);
  expect(Object.keys(notes.page[0] ?? {}).sort()).toEqual(["_id", "accompanimentId", "body"]);
  expect(notes.page[0]).not.toHaveProperty("authorId");
  expect(notes.page[0]).not.toHaveProperty("grantedBy");
});
