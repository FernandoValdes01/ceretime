/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

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
  const tokenIdentifier = `${ISSUER}|${input.subject}`;
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: input.email,
      fullName: "Ficticio",
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

async function publicErrorData(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(
    () => {
      throw new Error("Se esperaba un error público");
    },
    (error: unknown) => {
      if (error instanceof ConvexError) return error.data;
      if (typeof error === "object" && error !== null && "data" in error) {
        return (error as { readonly data?: unknown }).data;
      }
      throw error;
    },
  );
}

async function denyMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Se esperaba denegación y la operación fue permitida");
}

/** Profesional con asignación activa sobre el acompañamiento por la vía interna. */
async function authorizeProfessional(
  t: ReturnType<typeof convexTest>,
  input: { accompanimentId: Id<"accompaniments">; professionalId: Id<"users"> },
  bootstrap: { subject: string; email: string },
) {
  await t
    .withIdentity(identityFor(bootstrap.subject, bootstrap.email))
    .mutation(internal.operations.assignments.assign, {
      accompanimentId: input.accompanimentId,
      userId: input.professionalId,
      assignedRole: "professional",
    });
}

test("profesional habilita practicante pendiente y registra actor y fecha", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedUser(t, {
    subject: "ti140-pro-1",
    email: "ti140-pro-1@uct.cl",
    role: "professional",
  });
  const intern = await seedUser(t, {
    subject: "ti140-int-1",
    email: "ti140-int-1@alu.uct.cl",
    role: "intern",
    institutionalStatus: "pending",
  });

  const asPro = t.withIdentity(identityFor("ti140-pro-1", "ti140-pro-1@uct.cl"));
  const enabled = await asPro.mutation(api.presentation.accounts.enableIntern, {
    userId: intern.id,
  });
  expect(enabled).toEqual({ userId: intern.id });

  const stored = await t.run(async (ctx) => ctx.db.get(intern.id));
  expect(stored?.institutionalStatus).toBe("enabled");
  expect(stored?.enabledBy).toEqual(pro.id);
  expect(typeof stored?.enabledAt).toBe("number");
});

test("habilitación exige profesional o administrador vigente", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti140-adm-2",
    email: "ti140-adm-2@uct.cl",
    role: "admin",
  });
  const student = await seedUser(t, {
    subject: "ti140-est-2",
    email: "ti140-est-2@alu.uct.cl",
    role: "student",
  });
  const target = await seedUser(t, {
    subject: "ti140-int-2",
    email: "ti140-int-2@alu.uct.cl",
    role: "intern",
    institutionalStatus: "pending",
  });

  const asStudent = t.withIdentity(identityFor("ti140-est-2", "ti140-est-2@alu.uct.cl"));
  expect(
    await publicErrorData(
      asStudent.mutation(api.presentation.accounts.enableIntern, { userId: target.id }),
    ),
  ).toEqual({ code: "unauthorized", message: "No autorizado" });
  expect(student.id).toBeDefined();

  expect(
    await publicErrorData(
      t.mutation(api.presentation.accounts.enableIntern, { userId: target.id }),
    ),
  ).toEqual({ code: "unauthorized", message: "No autorizado" });
});

test("profesional habilita cuenta de prueba y solo opera en lo asignado con auditoría", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedUser(t, {
    subject: "ti140-pro-3",
    email: "ti140-pro-3@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti140-pro-3b",
    email: "ti140-pro-3b@uct.cl",
    role: "professional",
  });
  const student = await seedUser(t, {
    subject: "ti140-est-3",
    email: "ti140-est-3@alu.uct.cl",
    role: "student",
  });
  const testPro = await seedUser(t, {
    subject: "ti140-prueba-3",
    email: "ti140-prueba-3@alu.uct.cl",
    role: "professional",
    institutionalStatus: "pending",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);
  const otherId = await seedAccompaniment(t, student.id);
  await authorizeProfessional(
    t,
    { accompanimentId, professionalId: pro.id },
    { subject: "ti140-pro-3b", email: "ti140-pro-3b@uct.cl" },
  );

  const asPro = t.withIdentity(identityFor("ti140-pro-3", "ti140-pro-3@uct.cl"));
  const enabled = await asPro.mutation(api.presentation.accounts.enableTestProfessional, {
    userId: testPro.id,
  });
  expect(enabled).toEqual({ userId: testPro.id });
  const stored = await t.run(async (ctx) => ctx.db.get(testPro.id));
  expect(stored?.institutionalStatus).toBe("enabled");
  expect(stored?.enabledBy).toEqual(pro.id);

  await asPro.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
    accompanimentId,
    userId: testPro.id,
    assignedRole: "professional",
  });

  const asTest = t.withIdentity(identityFor("ti140-prueba-3", "ti140-prueba-3@alu.uct.cl"));
  const detail = await asTest.query(api.presentation.accompaniments.getAccompaniment, {
    accompanimentId,
  });
  expect(detail.view).toBe("full");

  const denied = await denyMessage(
    asTest.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId: otherId }),
  );
  expect(denied).toContain("No autorizado");
  expect(denied).not.toContain(String(otherId));

  const row = await t.run(async (ctx) => {
    return await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
        q
          .eq("accompanimentId", accompanimentId)
          .eq("userId", testPro.id)
          .eq("status", "active")
          .eq("assignedRole", "professional"),
      )
      .unique();
  });
  expect(row?.grantedBy).toEqual(pro.id);
  expect(typeof row?.grantedAt).toBe("number");
});

test("cuenta de prueba fuera del alcance no recibe ni concede", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedUser(t, {
    subject: "ti140-pro-4",
    email: "ti140-pro-4@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti140-pro-4b",
    email: "ti140-pro-4b@uct.cl",
    role: "professional",
  });
  const student = await seedUser(t, {
    subject: "ti140-est-4",
    email: "ti140-est-4@alu.uct.cl",
    role: "student",
  });
  const testPro = await seedUser(t, {
    subject: "ti140-prueba-4",
    email: "ti140-prueba-4@alu.uct.cl",
    role: "professional",
    institutionalStatus: "pending",
  });
  const intern = await seedUser(t, {
    subject: "ti140-int-4",
    email: "ti140-int-4@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);
  await authorizeProfessional(
    t,
    { accompanimentId, professionalId: pro.id },
    { subject: "ti140-pro-4b", email: "ti140-pro-4b@uct.cl" },
  );

  const asPro = t.withIdentity(identityFor("ti140-pro-4", "ti140-pro-4@uct.cl"));
  await asPro.mutation(api.presentation.accounts.enableTestProfessional, { userId: testPro.id });

  const outsider = t.withIdentity(identityFor("ti140-prueba-4", "ti140-prueba-4@alu.uct.cl"));
  const message = await denyMessage(
    outsider.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
    }),
  );
  expect(message).toContain("No autorizado");
});

test("rechazo sin habilitación, fuera de alcance y después de revocar por la vía pública", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedUser(t, {
    subject: "ti140-pro-5",
    email: "ti140-pro-5@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti140-pro-5b",
    email: "ti140-pro-5b@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti140-pro-5c",
    email: "ti140-pro-5c@uct.cl",
    role: "professional",
  });
  const student = await seedUser(t, {
    subject: "ti140-est-5",
    email: "ti140-est-5@alu.uct.cl",
    role: "student",
  });
  const pendingIntern = await seedUser(t, {
    subject: "ti140-int-5",
    email: "ti140-int-5@alu.uct.cl",
    role: "intern",
    institutionalStatus: "pending",
  });
  const enabledIntern = await seedUser(t, {
    subject: "ti140-int-5b",
    email: "ti140-int-5b@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);
  await authorizeProfessional(
    t,
    { accompanimentId, professionalId: pro.id },
    { subject: "ti140-pro-5b", email: "ti140-pro-5b@uct.cl" },
  );

  const asPro = t.withIdentity(identityFor("ti140-pro-5", "ti140-pro-5@uct.cl"));
  const withoutEnable = await denyMessage(
    asPro.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
      accompanimentId,
      userId: pendingIntern.id,
      assignedRole: "intern",
    }),
  );
  expect(withoutEnable).toContain("No autorizado");

  const asOutsider = t.withIdentity(identityFor("ti140-pro-5c", "ti140-pro-5c@uct.cl"));
  const outOfScope = await denyMessage(
    asOutsider.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
      accompanimentId,
      userId: enabledIntern.id,
      assignedRole: "intern",
    }),
  );
  expect(outOfScope).toContain("No autorizado");

  await asPro.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
    accompanimentId,
    userId: enabledIntern.id,
    assignedRole: "intern",
  });
  const asIntern = t.withIdentity(identityFor("ti140-int-5b", "ti140-int-5b@alu.uct.cl"));
  const before = await asIntern.query(api.presentation.accompaniments.getAccompaniment, {
    accompanimentId,
  });
  expect(before.view).toBe("minimized");

  await asPro.mutation(api.presentation.accompaniments.revokeAccompanimentAccess, {
    accompanimentId,
    userId: enabledIntern.id,
    assignedRole: "intern",
  });
  const after = await denyMessage(
    asIntern.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
  );
  expect(after).toContain("No autorizado");
  expect(after).not.toContain(String(accompanimentId));

  const list = await asIntern.query(api.presentation.accompaniments.listAssignedAccompaniments, {
    limit: 10,
  });
  expect(list.items).toHaveLength(0);
});

test("modificación comprueba la vigencia y solo la hace el autorizado", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedUser(t, {
    subject: "ti140-pro-6",
    email: "ti140-pro-6@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti140-pro-6b",
    email: "ti140-pro-6b@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti140-pro-6c",
    email: "ti140-pro-6c@uct.cl",
    role: "professional",
  });
  const student = await seedUser(t, {
    subject: "ti140-est-6",
    email: "ti140-est-6@alu.uct.cl",
    role: "student",
  });
  const intern = await seedUser(t, {
    subject: "ti140-int-6",
    email: "ti140-int-6@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);
  await authorizeProfessional(
    t,
    { accompanimentId, professionalId: pro.id },
    { subject: "ti140-pro-6b", email: "ti140-pro-6b@uct.cl" },
  );

  const asPro = t.withIdentity(identityFor("ti140-pro-6", "ti140-pro-6@uct.cl"));
  await asPro.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
    accompanimentId,
    userId: intern.id,
    assignedRole: "intern",
    validFrom: 1000,
    validUntil: 2000,
  });

  await expect(
    asPro.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
      validFrom: 3000,
      validUntil: 2000,
    }),
  ).rejects.toThrow("vigencia");

  const asOutsider = t.withIdentity(identityFor("ti140-pro-6c", "ti140-pro-6c@uct.cl"));
  await expect(
    asOutsider.mutation(api.presentation.accompaniments.updateAccompanimentAccess, {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
      validFrom: 1000,
      validUntil: 3000,
    }),
  ).rejects.toThrow("No autorizado");

  await expect(
    asPro.mutation(api.presentation.accompaniments.updateAccompanimentAccess, {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
      validFrom: 4000,
      validUntil: 3000,
    }),
  ).rejects.toThrow("vigencia");

  const updated = await asPro.mutation(api.presentation.accompaniments.updateAccompanimentAccess, {
    accompanimentId,
    userId: intern.id,
    assignedRole: "intern",
    validFrom: 1000,
    validUntil: 3000,
  });
  expect(updated).toBeDefined();
  const stored = await t.run(async (ctx) => {
    return await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
        q
          .eq("accompanimentId", accompanimentId)
          .eq("userId", intern.id)
          .eq("status", "active")
          .eq("assignedRole", "intern"),
      )
      .unique();
  });
  expect(stored?.validFrom).toBe(1000);
  expect(stored?.validUntil).toBe(3000);

  const cleared = await asPro.mutation(api.presentation.accompaniments.updateAccompanimentAccess, {
    accompanimentId,
    userId: intern.id,
    assignedRole: "intern",
    validFrom: null,
    validUntil: null,
  });
  expect(cleared).toBeDefined();
  const clearedRow = await t.run(async (ctx) => {
    return await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
        q
          .eq("accompanimentId", accompanimentId)
          .eq("userId", intern.id)
          .eq("status", "active")
          .eq("assignedRole", "intern"),
      )
      .unique();
  });
  expect(clearedRow?.validFrom).toBeUndefined();
  expect(clearedRow?.validUntil).toBeUndefined();
});

test("practicante no escribe ni ve notas internas por la vía pública", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedUser(t, {
    subject: "ti140-pro-7",
    email: "ti140-pro-7@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti140-pro-7b",
    email: "ti140-pro-7b@uct.cl",
    role: "professional",
  });
  const student = await seedUser(t, {
    subject: "ti140-est-7",
    email: "ti140-est-7@alu.uct.cl",
    role: "student",
  });
  const intern = await seedUser(t, {
    subject: "ti140-int-7",
    email: "ti140-int-7@alu.uct.cl",
    role: "intern",
  });
  const otherIntern = await seedUser(t, {
    subject: "ti140-int-7b",
    email: "ti140-int-7b@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);
  await authorizeProfessional(
    t,
    { accompanimentId, professionalId: pro.id },
    { subject: "ti140-pro-7b", email: "ti140-pro-7b@uct.cl" },
  );

  const asPro = t.withIdentity(identityFor("ti140-pro-7", "ti140-pro-7@uct.cl"));
  await asPro.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
    accompanimentId,
    userId: intern.id,
    assignedRole: "intern",
  });

  const asIntern = t.withIdentity(identityFor("ti140-int-7", "ti140-int-7@alu.uct.cl"));
  await expect(
    asIntern.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
      accompanimentId,
      userId: otherIntern.id,
      assignedRole: "intern",
    }),
  ).rejects.toThrow("No autorizado");
  await expect(
    asIntern.mutation(api.presentation.accompaniments.updateAccompanimentAccess, {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
      validUntil: 9999,
    }),
  ).rejects.toThrow("No autorizado");
  await expect(
    asIntern.mutation(api.presentation.accompaniments.revokeAccompanimentAccess, {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
    }),
  ).rejects.toThrow("No autorizado");
  await expect(
    asIntern.query(api.presentation.accompaniments.getInternalNotes, {
      accompanimentId,
      paginationOpts: { numItems: 10, cursor: null },
    }),
  ).rejects.toThrow("No autorizado");
});
