/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

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

/** Usuario ficticio persistido con identidad vinculada. */
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

/** Acompañamiento ficticio del estudiante. */
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

/** Fila de asignación para la combinación exacta, esté activa o revocada. */
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

/** Profesional autorizado sobre el acompañamiento por la vía guardada. */
async function authorizeProfessional(
  t: ReturnType<typeof convexTest>,
  input: { accompanimentId: Id<"accompaniments">; professionalId: Id<"users"> },
  bootstrap: { subject: string; email: string },
) {
  await t
    .withIdentity(identityFor(bootstrap.subject, bootstrap.email))
    .mutation(internal.assignments.assign, {
      accompanimentId: input.accompanimentId,
      userId: input.professionalId,
      assignedRole: "professional",
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

/**
 * Concesión, retiro y revocación de acceso de Practicantes (TI2-28).
 *
 * Solo un Profesional autorizado sobre el acompañamiento puede conceder,
 * retirar o revocar acceso a un Practicante con cuenta habilitada y vigente;
 * el Administrador solo habilita la cuenta (TI2-11) y jamás concede
 * acompañamientos. Toda operación queda auditada con actor, acompañamiento,
 * fecha y vigencia. El acompañamiento inexistente o no autorizado responde
 * el mismo error genérico, sin revelar existencia. Datos ficticios.
 */

test("profesional autorizado concede acceso al practicante habilitado y queda auditado", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti28-est-1",
    email: "est1@alu.uct.cl",
    role: "student",
  });
  const proId = await seedUser(t, {
    subject: "ti28-pro-1",
    email: "pro1@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti28-pro-1b",
    email: "pro1b@uct.cl",
    role: "professional",
  });
  const internId = await seedUser(t, {
    subject: "ti28-int-1",
    email: "int1@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, studentId);
  await authorizeProfessional(
    t,
    { accompanimentId, professionalId: proId },
    { subject: "ti28-pro-1b", email: "pro1b@uct.cl" },
  );

  const asPro = t.withIdentity(identityFor("ti28-pro-1", "pro1@uct.cl"));
  await asPro.mutation(internal.assignments.assign, {
    accompanimentId,
    userId: internId,
    assignedRole: "intern",
  });

  const row = await findAssignmentRow(t, {
    accompanimentId,
    userId: internId,
    assignedRole: "intern",
  });
  expect(row).not.toBeNull();
  expect(row?.status).toBe("active");
  expect(row?.accompanimentId).toEqual(accompanimentId);
  expect(row?.grantedBy).toEqual(proId);
  expect(typeof row?.grantedAt).toBe("number");
  expect(row?.revokedBy).toBeUndefined();
  expect(row?.revokedAt).toBeUndefined();
});

test("profesional autorizado retira el acceso y la revocación queda auditada", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti28-est-2",
    email: "est2@alu.uct.cl",
    role: "student",
  });
  const proId = await seedUser(t, {
    subject: "ti28-pro-2",
    email: "pro2@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti28-pro-2b",
    email: "pro2b@uct.cl",
    role: "professional",
  });
  const internId = await seedUser(t, {
    subject: "ti28-int-2",
    email: "int2@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, studentId);
  await authorizeProfessional(
    t,
    { accompanimentId, professionalId: proId },
    { subject: "ti28-pro-2b", email: "pro2b@uct.cl" },
  );

  const asPro = t.withIdentity(identityFor("ti28-pro-2", "pro2@uct.cl"));
  const input = { accompanimentId, userId: internId, assignedRole: "intern" as const };
  await asPro.mutation(internal.assignments.assign, input);
  await asPro.mutation(internal.assignments.revoke, input);

  const row = await findAssignmentRow(t, input);
  expect(row).not.toBeNull();
  expect(row?.status).toBe("revoked");
  expect(row?.grantedBy).toEqual(proId);
  expect(typeof row?.grantedAt).toBe("number");
  expect(row?.revokedBy).toEqual(proId);
  expect(typeof row?.revokedAt).toBe("number");

  const second = await asPro.mutation(internal.assignments.revoke, input);
  expect(second).toBeNull();
});

test("practicante sin cuenta habilitada no recibe acceso", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti28-est-3",
    email: "est3@alu.uct.cl",
    role: "student",
  });
  const proId = await seedUser(t, {
    subject: "ti28-pro-3",
    email: "pro3@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti28-pro-3b",
    email: "pro3b@uct.cl",
    role: "professional",
  });
  const disabledId = await seedUser(t, {
    subject: "ti28-int-3",
    email: "int3@alu.uct.cl",
    role: "intern",
    institutionalStatus: "disabled",
  });
  const pendingId = await seedUser(t, {
    subject: "ti28-int-4",
    email: "int4@alu.uct.cl",
    role: "intern",
    institutionalStatus: "pending",
  });
  const inactiveId = await seedUser(t, {
    subject: "ti28-int-5",
    email: "int5@alu.uct.cl",
    role: "intern",
    accountStatus: "inactive",
  });
  const accompanimentId = await seedAccompaniment(t, studentId);
  await authorizeProfessional(
    t,
    { accompanimentId, professionalId: proId },
    { subject: "ti28-pro-3b", email: "pro3b@uct.cl" },
  );

  const asPro = t.withIdentity(identityFor("ti28-pro-3", "pro3@uct.cl"));
  for (const userId of [disabledId, pendingId, inactiveId]) {
    const message = await denyMessage(
      asPro.mutation(internal.assignments.assign, {
        accompanimentId,
        userId,
        assignedRole: "intern",
      }),
    );
    expect(message).toContain("No autorizado");
    const row = await findAssignmentRow(t, {
      accompanimentId,
      userId,
      assignedRole: "intern",
    });
    expect(row).toBeNull();
  }
});

test("profesional no autorizado sobre el acompañamiento no concede ni revoca", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti28-est-4",
    email: "est4@alu.uct.cl",
    role: "student",
  });
  const authorizedId = await seedUser(t, {
    subject: "ti28-pro-4",
    email: "pro4@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti28-pro-4b",
    email: "pro4b@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti28-pro-4c",
    email: "pro4c@uct.cl",
    role: "professional",
  });
  const internId = await seedUser(t, {
    subject: "ti28-int-6",
    email: "int6@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, studentId);
  await authorizeProfessional(
    t,
    { accompanimentId, professionalId: authorizedId },
    { subject: "ti28-pro-4b", email: "pro4b@uct.cl" },
  );
  const asAuthorized = t.withIdentity(identityFor("ti28-pro-4", "pro4@uct.cl"));
  await asAuthorized.mutation(internal.assignments.assign, {
    accompanimentId,
    userId: internId,
    assignedRole: "intern",
  });

  const asOutsider = t.withIdentity(identityFor("ti28-pro-4c", "pro4c@uct.cl"));
  const assignMessage = await denyMessage(
    asOutsider.mutation(internal.assignments.assign, {
      accompanimentId,
      userId: internId,
      assignedRole: "intern",
    }),
  );
  expect(assignMessage).toContain("No autorizado");

  const revokeMessage = await denyMessage(
    asOutsider.mutation(internal.assignments.revoke, {
      accompanimentId,
      userId: internId,
      assignedRole: "intern",
    }),
  );
  expect(revokeMessage).toContain("No autorizado");
});

test("acompañamiento inexistente responde igual que denegado", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti28-est-5",
    email: "est5@alu.uct.cl",
    role: "student",
  });
  const proId = await seedUser(t, {
    subject: "ti28-pro-5",
    email: "pro5@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti28-pro-5b",
    email: "pro5b@uct.cl",
    role: "professional",
  });
  const internId = await seedUser(t, {
    subject: "ti28-int-7",
    email: "int7@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, studentId);
  await authorizeProfessional(
    t,
    { accompanimentId, professionalId: proId },
    { subject: "ti28-pro-5b", email: "pro5b@uct.cl" },
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

  const asPro = t.withIdentity(identityFor("ti28-pro-5", "pro5@uct.cl"));
  const assignMessage = await denyMessage(
    asPro.mutation(internal.assignments.assign, {
      accompanimentId: missingId,
      userId: internId,
      assignedRole: "intern",
    }),
  );
  expect(assignMessage).toContain("No autorizado");
  expect(assignMessage).not.toContain(String(missingId));

  const revokeMessage = await denyMessage(
    asPro.mutation(internal.assignments.revoke, {
      accompanimentId: missingId,
      userId: internId,
      assignedRole: "intern",
    }),
  );
  expect(revokeMessage).toContain("No autorizado");
  expect(revokeMessage).not.toContain(String(missingId));
});

test("autoasignación queda rechazada con el mismo error genérico", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti28-est-6",
    email: "est6@alu.uct.cl",
    role: "student",
  });
  const proId = await seedUser(t, {
    subject: "ti28-pro-6",
    email: "pro6@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti28-pro-6b",
    email: "pro6b@uct.cl",
    role: "professional",
  });
  const internId = await seedUser(t, {
    subject: "ti28-int-8",
    email: "int8@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, studentId);
  await authorizeProfessional(
    t,
    { accompanimentId, professionalId: proId },
    { subject: "ti28-pro-6b", email: "pro6b@uct.cl" },
  );

  const asPro = t.withIdentity(identityFor("ti28-pro-6", "pro6@uct.cl"));
  const selfMessage = await denyMessage(
    asPro.mutation(internal.assignments.assign, {
      accompanimentId,
      userId: proId,
      assignedRole: "intern",
    }),
  );
  expect(selfMessage).toContain("No autorizado");

  const asIntern = t.withIdentity(identityFor("ti28-int-8", "int8@alu.uct.cl"));
  const internMessage = await denyMessage(
    asIntern.mutation(internal.assignments.assign, {
      accompanimentId,
      userId: internId,
      assignedRole: "intern",
    }),
  );
  expect(internMessage).toContain("No autorizado");
});

test("administrador solo habilita y no concede acompañamientos", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti28-est-7",
    email: "est7@alu.uct.cl",
    role: "student",
  });
  await seedUser(t, {
    subject: "ti28-adm-1",
    email: "adm1@uct.cl",
    role: "admin",
  });
  const internId = await seedUser(t, {
    subject: "ti28-int-9",
    email: "int9@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, studentId);

  const asAdmin = t.withIdentity(identityFor("ti28-adm-1", "adm1@uct.cl"));
  const assignMessage = await denyMessage(
    asAdmin.mutation(internal.assignments.assign, {
      accompanimentId,
      userId: internId,
      assignedRole: "intern",
    }),
  );
  expect(assignMessage).toContain("No autorizado");

  const revokeMessage = await denyMessage(
    asAdmin.mutation(internal.assignments.revoke, {
      accompanimentId,
      userId: internId,
      assignedRole: "intern",
    }),
  );
  expect(revokeMessage).toContain("No autorizado");
});
