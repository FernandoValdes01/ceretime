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

async function expectPublicError(
  promise: Promise<unknown>,
  code: "unauthorized" | "conflict" | "assignment_fields_invalid",
  message: string,
) {
  expect(await publicErrorData(promise)).toEqual({ code, message });
}

const UNAUTHORIZED = { code: "unauthorized", message: "No autorizado" } as const;

async function denyMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Se esperaba denegación y la operación fue permitida");
}

/** Profesional de personal con asignación activa y vigente por la vía interna. */
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

test("habilitación exige profesional de personal o administrador vigente", async () => {
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
  const testPro = await seedUser(t, {
    subject: "ti140-prueba-2",
    email: "ti140-prueba-2@alu.uct.cl",
    role: "professional",
  });
  expect(testPro.id).toBeDefined();
  const target = await seedUser(t, {
    subject: "ti140-int-2",
    email: "ti140-int-2@alu.uct.cl",
    role: "intern",
    institutionalStatus: "pending",
  });

  const asStudent = t.withIdentity(identityFor("ti140-est-2", "ti140-est-2@alu.uct.cl"));
  await expectPublicError(
    asStudent.mutation(api.presentation.accounts.enableIntern, { userId: target.id }),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );
  expect(student.id).toBeDefined();

  await expectPublicError(
    t.mutation(api.presentation.accounts.enableIntern, { userId: target.id }),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );

  const asTest = t.withIdentity(identityFor("ti140-prueba-2", "ti140-prueba-2@alu.uct.cl"));
  await expectPublicError(
    asTest.mutation(api.presentation.accounts.enableIntern, { userId: target.id }),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );
  await expectPublicError(
    asTest.mutation(api.presentation.accounts.enableTestProfessional, { userId: target.id }),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );
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
  await expectPublicError(
    outsider.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
    }),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );

  const leaked = await t.run(async (ctx) => {
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
  expect(leaked).toBeNull();
});

test("la cuenta de prueba jamás habilita, concede, modifica ni retira", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedUser(t, {
    subject: "ti140-pro-8",
    email: "ti140-pro-8@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti140-pro-8b",
    email: "ti140-pro-8b@uct.cl",
    role: "professional",
  });
  const student = await seedUser(t, {
    subject: "ti140-est-8",
    email: "ti140-est-8@alu.uct.cl",
    role: "student",
  });
  const testPro = await seedUser(t, {
    subject: "ti140-prueba-8",
    email: "ti140-prueba-8@alu.uct.cl",
    role: "professional",
    institutionalStatus: "pending",
  });
  const intern = await seedUser(t, {
    subject: "ti140-int-8",
    email: "ti140-int-8@alu.uct.cl",
    role: "intern",
  });
  const pendingIntern = await seedUser(t, {
    subject: "ti140-int-8b",
    email: "ti140-int-8b@alu.uct.cl",
    role: "intern",
    institutionalStatus: "pending",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);
  await authorizeProfessional(
    t,
    { accompanimentId, professionalId: pro.id },
    { subject: "ti140-pro-8b", email: "ti140-pro-8b@uct.cl" },
  );

  const asPro = t.withIdentity(identityFor("ti140-pro-8", "ti140-pro-8@uct.cl"));
  await asPro.mutation(api.presentation.accounts.enableTestProfessional, { userId: testPro.id });
  await asPro.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
    accompanimentId,
    userId: testPro.id,
    assignedRole: "professional",
  });
  await asPro.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
    accompanimentId,
    userId: intern.id,
    assignedRole: "intern",
  });

  const asTest = t.withIdentity(identityFor("ti140-prueba-8", "ti140-prueba-8@alu.uct.cl"));
  await expectPublicError(
    asTest.mutation(api.presentation.accounts.enableIntern, { userId: pendingIntern.id }),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );
  await expectPublicError(
    asTest.mutation(api.presentation.accounts.enableTestProfessional, {
      userId: pendingIntern.id,
    }),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );
  await expectPublicError(
    asTest.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
      accompanimentId,
      userId: pendingIntern.id,
      assignedRole: "intern",
    }),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );
  await expectPublicError(
    asTest.mutation(api.presentation.accompaniments.updateAccompanimentAccess, {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
      validUntil: Date.now() + 3_600_000,
    }),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );
  await expectPublicError(
    asTest.mutation(api.presentation.accompaniments.revokeAccompanimentAccess, {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
    }),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );

  const untouched = await t.run(async (ctx) => ctx.db.get(pendingIntern.id));
  expect(untouched?.institutionalStatus).toBe("pending");
  expect(untouched?.enabledBy).toBeUndefined();
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
  await expectPublicError(
    asPro.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
      accompanimentId,
      userId: pendingIntern.id,
      assignedRole: "intern",
    }),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );

  const asOutsider = t.withIdentity(identityFor("ti140-pro-5c", "ti140-pro-5c@uct.cl"));
  await expectPublicError(
    asOutsider.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
      accompanimentId,
      userId: enabledIntern.id,
      assignedRole: "intern",
    }),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );

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

test("duplicada y rol distinto responden conflict con el motivo", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedUser(t, {
    subject: "ti140-pro-9",
    email: "ti140-pro-9@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti140-pro-9b",
    email: "ti140-pro-9b@uct.cl",
    role: "professional",
  });
  const otherPro = await seedUser(t, {
    subject: "ti140-pro-9c",
    email: "ti140-pro-9c@uct.cl",
    role: "professional",
  });
  const student = await seedUser(t, {
    subject: "ti140-est-9",
    email: "ti140-est-9@alu.uct.cl",
    role: "student",
  });
  const intern = await seedUser(t, {
    subject: "ti140-int-9",
    email: "ti140-int-9@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);
  await authorizeProfessional(
    t,
    { accompanimentId, professionalId: pro.id },
    { subject: "ti140-pro-9b", email: "ti140-pro-9b@uct.cl" },
  );

  const asPro = t.withIdentity(identityFor("ti140-pro-9", "ti140-pro-9@uct.cl"));
  await asPro.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
    accompanimentId,
    userId: intern.id,
    assignedRole: "intern",
  });
  await expectPublicError(
    asPro.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
    }),
    "conflict",
    "Ya existe una asignación activa para este acompañamiento y rol",
  );
  await expectPublicError(
    asPro.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
      accompanimentId,
      userId: otherPro.id,
      assignedRole: "intern",
    }),
    "conflict",
    "El rol del usuario no coincide con el rol asignado",
  );
  await expectPublicError(
    asPro.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
      validFrom: 3000,
      validUntil: 2000,
    }),
    "assignment_fields_invalid",
    "La vigencia acordada es inválida: el inicio no puede ser posterior al fin.",
  );

  const single = await t.run(async (ctx) => {
    return await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
        q
          .eq("accompanimentId", accompanimentId)
          .eq("userId", intern.id)
          .eq("status", "active")
          .eq("assignedRole", "intern"),
      )
      .take(2);
  });
  expect(single).toHaveLength(1);
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

  const asOutsider = t.withIdentity(identityFor("ti140-pro-6c", "ti140-pro-6c@uct.cl"));
  await expectPublicError(
    asOutsider.mutation(api.presentation.accompaniments.updateAccompanimentAccess, {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
      validFrom: 1000,
      validUntil: 3000,
    }),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );

  await expectPublicError(
    asPro.mutation(api.presentation.accompaniments.updateAccompanimentAccess, {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
      validFrom: 4000,
      validUntil: 3000,
    }),
    "assignment_fields_invalid",
    "La vigencia acordada es inválida: el inicio no puede ser posterior al fin.",
  );

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

test("la ventana vencida o futura corta la lectura y el alcance", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedUser(t, {
    subject: "ti140-pro-10",
    email: "ti140-pro-10@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti140-pro-10b",
    email: "ti140-pro-10b@uct.cl",
    role: "professional",
  });
  const student = await seedUser(t, {
    subject: "ti140-est-10",
    email: "ti140-est-10@alu.uct.cl",
    role: "student",
  });
  const expiredIntern = await seedUser(t, {
    subject: "ti140-int-10",
    email: "ti140-int-10@alu.uct.cl",
    role: "intern",
  });
  const futureIntern = await seedUser(t, {
    subject: "ti140-int-10b",
    email: "ti140-int-10b@alu.uct.cl",
    role: "intern",
  });
  const currentIntern = await seedUser(t, {
    subject: "ti140-int-10c",
    email: "ti140-int-10c@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);
  await authorizeProfessional(
    t,
    { accompanimentId, professionalId: pro.id },
    { subject: "ti140-pro-10b", email: "ti140-pro-10b@uct.cl" },
  );

  const asPro = t.withIdentity(identityFor("ti140-pro-10", "ti140-pro-10@uct.cl"));
  const now = Date.now();
  await asPro.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
    accompanimentId,
    userId: expiredIntern.id,
    assignedRole: "intern",
    validFrom: now - 3_600_000,
    validUntil: now - 1_000,
  });
  await asPro.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
    accompanimentId,
    userId: futureIntern.id,
    assignedRole: "intern",
    validFrom: now + 1_000,
    validUntil: now + 3_600_000,
  });
  await asPro.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
    accompanimentId,
    userId: currentIntern.id,
    assignedRole: "intern",
    validFrom: now - 1_000,
    validUntil: now + 3_600_000,
  });

  const asExpired = t.withIdentity(identityFor("ti140-int-10", "ti140-int-10@alu.uct.cl"));
  const expiredDenied = await denyMessage(
    asExpired.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
  );
  expect(expiredDenied).toContain("No autorizado");
  const expiredList = await asExpired.query(
    api.presentation.accompaniments.listAssignedAccompaniments,
    { limit: 10 },
  );
  expect(expiredList.items).toHaveLength(0);

  const asFuture = t.withIdentity(identityFor("ti140-int-10b", "ti140-int-10b@alu.uct.cl"));
  const futureDenied = await denyMessage(
    asFuture.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
  );
  expect(futureDenied).toContain("No autorizado");

  const asCurrent = t.withIdentity(identityFor("ti140-int-10c", "ti140-int-10c@alu.uct.cl"));
  const current = await asCurrent.query(api.presentation.accompaniments.getAccompaniment, {
    accompanimentId,
  });
  expect(current.view).toBe("minimized");
});

test("el alcance vencido del profesional no autoriza a conceder", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedUser(t, {
    subject: "ti140-pro-11",
    email: "ti140-pro-11@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti140-pro-11b",
    email: "ti140-pro-11b@uct.cl",
    role: "professional",
  });
  const student = await seedUser(t, {
    subject: "ti140-est-11",
    email: "ti140-est-11@alu.uct.cl",
    role: "student",
  });
  const intern = await seedUser(t, {
    subject: "ti140-int-11",
    email: "ti140-int-11@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);
  const now = Date.now();
  await t
    .withIdentity(identityFor("ti140-pro-11b", "ti140-pro-11b@uct.cl"))
    .mutation(internal.operations.assignments.assign, {
      accompanimentId,
      userId: pro.id,
      assignedRole: "professional",
    });
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
        q
          .eq("accompanimentId", accompanimentId)
          .eq("userId", pro.id)
          .eq("status", "active")
          .eq("assignedRole", "professional"),
      )
      .unique();
    if (row !== null) await ctx.db.patch(row._id, { validUntil: now - 1_000 });
  });

  const asPro = t.withIdentity(identityFor("ti140-pro-11", "ti140-pro-11@uct.cl"));
  await expectPublicError(
    asPro.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
    }),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );

  const leaked = await t.run(async (ctx) => {
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
  expect(leaked).toBeNull();
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
  await expectPublicError(
    asIntern.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
      accompanimentId,
      userId: otherIntern.id,
      assignedRole: "intern",
    }),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );
  await expectPublicError(
    asIntern.mutation(api.presentation.accompaniments.updateAccompanimentAccess, {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
      validUntil: 9999,
    }),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );
  await expectPublicError(
    asIntern.mutation(api.presentation.accompaniments.revokeAccompanimentAccess, {
      accompanimentId,
      userId: intern.id,
      assignedRole: "intern",
    }),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );
  await expect(
    asIntern.query(api.presentation.accompaniments.getInternalNotes, {
      accompanimentId,
      paginationOpts: { numItems: 10, cursor: null },
    }),
  ).rejects.toThrow("No autorizado");
});
