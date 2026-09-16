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
    role: "student" | "professional" | "intern";
  },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: input.email,
      fullName: "Ficticio",
      role: input.role,
      institutionalStatus: "enabled",
      accountStatus: "active",
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

/**
 * Trazabilidad de asignaciones (TI2-16): quién concede y cuándo, quién
 * revoca y cuándo. Solo persistencia con datos ficticios.
 */
test("Asignar registra quién concede y cuándo", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti16-est-10",
    email: "est10@alu.uct.cl",
    role: "student",
  });
  const proId = await seedUser(t, {
    subject: "ti16-pro-10",
    email: "pro10@uct.cl",
    role: "professional",
  });
  const internId = await seedUser(t, {
    subject: "ti16-int-10",
    email: "int10@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, studentId);
  const input = {
    accompanimentId,
    userId: internId,
    assignedRole: "intern" as const,
  };

  const asPro = t.withIdentity(identityFor("ti16-pro-10", "pro10@uct.cl"));
  await asPro.mutation(internal.assignments.assign, input);

  const row = await findAssignmentRow(t, input);
  expect(row).not.toBeNull();
  expect(row?.status).toBe("active");
  expect(row?.grantedBy).toEqual(proId);
  expect(row?.grantedAt).toBeDefined();
  expect(row?.revokedBy).toBeUndefined();
  expect(row?.revokedAt).toBeUndefined();
});

test("Revocar registra quién revoca y cuándo", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti16-est-11",
    email: "est11@alu.uct.cl",
    role: "student",
  });
  const proId = await seedUser(t, {
    subject: "ti16-pro-11",
    email: "pro11@uct.cl",
    role: "professional",
  });
  const internId = await seedUser(t, {
    subject: "ti16-int-11",
    email: "int11@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, studentId);
  const input = {
    accompanimentId,
    userId: internId,
    assignedRole: "intern" as const,
  };

  const asPro = t.withIdentity(identityFor("ti16-pro-11", "pro11@uct.cl"));
  await asPro.mutation(internal.assignments.assign, input);
  await asPro.mutation(internal.assignments.revoke, input);

  const row = await findAssignmentRow(t, input);
  expect(row).not.toBeNull();
  expect(row?.status).toBe("revoked");
  expect(row?.grantedBy).toEqual(proId);
  expect(row?.revokedBy).toEqual(proId);
  expect(row?.revokedAt).toBeDefined();
});

test("Asignar exige que el rol del usuario coincida con el rol asignado", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti16-est-14",
    email: "est14@alu.uct.cl",
    role: "student",
  });
  const proId = await seedUser(t, {
    subject: "ti16-pro-14",
    email: "pro14@uct.cl",
    role: "professional",
  });
  const internId = await seedUser(t, {
    subject: "ti16-int-14",
    email: "int14@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, studentId);
  const asPro = t.withIdentity(identityFor("ti16-pro-14", "pro14@uct.cl"));

  // Un estudiante no puede quedar registrado como Practicante
  await expect(
    asPro.mutation(internal.assignments.assign, {
      accompanimentId,
      userId: studentId,
      assignedRole: "intern",
    }),
  ).rejects.toThrow("no coincide");

  // Un Practicante no puede quedar registrado como Profesional
  await expect(
    asPro.mutation(internal.assignments.assign, {
      accompanimentId,
      userId: internId,
      assignedRole: "professional",
    }),
  ).rejects.toThrow("no coincide");

  // Un Profesional no puede quedar registrado como Practicante
  await expect(
    asPro.mutation(internal.assignments.assign, {
      accompanimentId,
      userId: proId,
      assignedRole: "intern",
    }),
  ).rejects.toThrow("no coincide");
});

test("Revocar falla si no alcanza a cerrar todas las filas activas", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti16-est-15",
    email: "est15@alu.uct.cl",
    role: "student",
  });
  const proId = await seedUser(t, {
    subject: "ti16-pro-15",
    email: "pro15@uct.cl",
    role: "professional",
  });
  const internId = await seedUser(t, {
    subject: "ti16-int-15",
    email: "int15@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await seedAccompaniment(t, studentId);
  const input = {
    accompanimentId,
    userId: internId,
    assignedRole: "intern" as const,
  };

  // Más filas activas que el tope de 10 lotes de 50
  await t.run(async (ctx) => {
    for (let round = 0; round < 501; round++) {
      await ctx.db.insert("accompanimentAssignments", {
        accompanimentId,
        userId: internId,
        assignedRole: "intern",
        status: "active",
        grantedBy: proId,
        grantedAt: 1,
      });
    }
  });

  const asPro = t.withIdentity(identityFor("ti16-pro-15", "pro15@uct.cl"));
  await expect(asPro.mutation(internal.assignments.revoke, input)).rejects.toThrow("sin revocar");
});
