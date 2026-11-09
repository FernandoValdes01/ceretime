/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "../_generated/api";
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

test("administrador lista cuentas con detalle mínimo sin tokenIdentifier", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti2-137-adm-1",
    email: "adm1@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  await seedUser(t, {
    subject: "ti2-137-pro-1",
    email: "pro1@uct.cl",
    fullName: "Profesional Ficticio",
    role: "professional",
    institutionalStatus: "pending",
  });

  const asAdmin = t.withIdentity(identityFor("ti2-137-adm-1", "adm1@uct.cl"));
  const page = await asAdmin.query(api.presentation.accounts.listAccounts, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(page.page.length).toBeGreaterThanOrEqual(2);
  for (const item of page.page) {
    expect(item).not.toHaveProperty("tokenIdentifier");
    expect(["admin", "professional", "intern", "student"]).toContain(item.role);
  }
  const target = page.page.find((item) => item.email === "pro1@uct.cl");
  expect(target).toBeDefined();
  const detail = await asAdmin.query(api.presentation.accounts.getAccount, {
    userId: target!._id,
  });
  expect(detail.email).toBe("pro1@uct.cl");
  expect(detail).not.toHaveProperty("tokenIdentifier");
});

test("correo institucional sin perfil no concede acceso", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti2-137-adm-2",
    email: "adm2@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const ghost = t.withIdentity(identityFor("ti2-137-ghost", "fantasma@uct.cl"));
  await expect(
    ghost.query(api.presentation.accounts.listAccounts, {
      paginationOpts: { numItems: 10, cursor: null },
    }),
  ).rejects.toThrow("No autorizado");
});

test("otros roles y anónimo no administran cuentas", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti2-137-adm-3",
    email: "adm3@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const target = await seedUser(t, {
    subject: "ti2-137-pro-2",
    email: "pro2@uct.cl",
    fullName: "Profesional Ficticio",
    role: "professional",
    institutionalStatus: "pending",
  });
  const student = await seedUser(t, {
    subject: "ti2-137-est-1",
    email: "est1@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  void student;

  const asStudent = t.withIdentity(identityFor("ti2-137-est-1", "est1@alu.uct.cl"));
  await expect(
    asStudent.query(api.presentation.accounts.listAccounts, {
      paginationOpts: { numItems: 10, cursor: null },
    }),
  ).rejects.toThrow("No autorizado");
  await expect(
    asStudent.query(api.presentation.accounts.getAccount, { userId: target.id }),
  ).rejects.toThrow("No autorizado");
  await expect(
    asStudent.mutation(api.presentation.accounts.enableAccount, { userId: target.id }),
  ).rejects.toThrow("No autorizado");
  await expect(
    asStudent.mutation(api.presentation.accounts.revokeAccount, { userId: target.id }),
  ).rejects.toThrow("No autorizado");
  await expect(
    t.query(api.presentation.accounts.listAccounts, {
      paginationOpts: { numItems: 10, cursor: null },
    }),
  ).rejects.toThrow("No autorizado");
});

test("administrar no concede acompañamientos ni notas", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti2-137-adm-4",
    email: "adm4@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const student = await seedUser(t, {
    subject: "ti2-137-est-2",
    email: "est2@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const accompanimentId = await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId: student.id,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "Necesidad ficticia",
    });
  });
  const asAdmin = t.withIdentity(identityFor("ti2-137-adm-4", "adm4@uct.cl"));
  await expect(
    asAdmin.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
  ).rejects.toThrow("No autorizado");
  await expect(
    asAdmin.query(api.presentation.accompaniments.getInternalNotes, {
      accompanimentId,
      paginationOpts: { numItems: 10, cursor: null },
    }),
  ).rejects.toThrow("No autorizado");
  await expect(
    asAdmin.query(api.presentation.accompaniments.listAssignedAccompaniments, {
      limit: 10,
    }),
  ).rejects.toThrow("No autorizado");
});

test("habilita profesional pendiente con actor y fecha y rechaza practicante", async () => {
  const t = convexTest(schema, modules);
  const admin = await seedUser(t, {
    subject: "ti2-137-adm-5",
    email: "adm5@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const pro = await seedUser(t, {
    subject: "ti2-137-pro-3",
    email: "pro3@uct.cl",
    fullName: "Profesional Ficticio",
    role: "professional",
    institutionalStatus: "pending",
  });
  const intern = await seedUser(t, {
    subject: "ti2-137-int-1",
    email: "practicante1@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
    institutionalStatus: "pending",
  });

  const asAdmin = t.withIdentity(identityFor("ti2-137-adm-5", "adm5@uct.cl"));
  const enabledId = await asAdmin.mutation(api.presentation.accounts.enableAccount, {
    userId: pro.id,
  });
  expect(enabledId).toEqual(pro.id);
  const stored = await t.run(async (ctx) => {
    return await ctx.db.get(pro.id);
  });
  expect(stored?.institutionalStatus).toBe("enabled");
  expect(stored?.enabledBy).toEqual(admin.id);
  expect(typeof stored?.enabledAt).toBe("number");

  await expect(
    asAdmin.mutation(api.presentation.accounts.enableAccount, { userId: intern.id }),
  ).rejects.toThrow("No autorizado");
});

test("habilita administrador con correo de personal y rechaza correo estudiantil", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti2-137-adm-6",
    email: "adm6@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const pendingAdmin = await seedUser(t, {
    subject: "ti2-137-adm-7",
    email: "nuevo@uct.cl",
    fullName: "Nuevo Administrador",
    role: "admin",
    institutionalStatus: "pending",
  });
  const studentAdmin = await seedUser(t, {
    subject: "ti2-137-adm-8",
    email: "estudiantil@alu.uct.cl",
    fullName: "Administrador Estudiantil",
    role: "admin",
    institutionalStatus: "pending",
  });

  const asAdmin = t.withIdentity(identityFor("ti2-137-adm-6", "adm6@uct.cl"));
  await asAdmin.mutation(api.presentation.accounts.enableAccount, {
    userId: pendingAdmin.id,
  });
  const stored = await t.run(async (ctx) => {
    return await ctx.db.get(pendingAdmin.id);
  });
  expect(stored?.institutionalStatus).toBe("enabled");

  await expect(
    asAdmin.mutation(api.presentation.accounts.enableAccount, {
      userId: studentAdmin.id as Id<"users">,
    }),
  ).rejects.toThrow("No autorizado");
});

test("revoca profesional habilitado y deja de operar en la petición siguiente", async () => {
  const t = convexTest(schema, modules);
  const admin = await seedUser(t, {
    subject: "ti2-137-adm-9",
    email: "adm9@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const pro = await seedUser(t, {
    subject: "ti2-137-pro-4",
    email: "pro4@uct.cl",
    fullName: "Profesional Ficticio",
    role: "professional",
  });

  const asAdmin = t.withIdentity(identityFor("ti2-137-adm-9", "adm9@uct.cl"));
  const revokedId = await asAdmin.mutation(api.presentation.accounts.revokeAccount, {
    userId: pro.id,
  });
  expect(revokedId).toEqual(pro.id);
  const stored = await t.run(async (ctx) => {
    return await ctx.db.get(pro.id);
  });
  expect(stored?.institutionalStatus).toBe("disabled");
  expect(stored?.revokedBy).toEqual(admin.id);
  expect(typeof stored?.revokedAt).toBe("number");

  const asPro = t.withIdentity(identityFor("ti2-137-pro-4", "pro4@uct.cl"));
  await expect(
    asPro.query(api.presentation.spaces.listSpaces, {
      limit: 10,
      version: "v1",
    }),
  ).rejects.toThrow("No autorizado");

  // La rehabilitación vuelve a dejar la cuenta operativa.
  await asAdmin.mutation(api.presentation.accounts.enableAccount, { userId: pro.id });
  const reenabled = await t.run(async (ctx) => {
    return await ctx.db.get(pro.id);
  });
  expect(reenabled?.institutionalStatus).toBe("enabled");
});

test("no permite auto-revocarse ni revocar al último administrador", async () => {
  const t = convexTest(schema, modules);
  const admin = await seedUser(t, {
    subject: "ti2-137-adm-10",
    email: "adm10@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const asAdmin = t.withIdentity(identityFor("ti2-137-adm-10", "adm10@uct.cl"));
  await expect(
    asAdmin.mutation(api.presentation.accounts.revokeAccount, { userId: admin.id }),
  ).rejects.toThrow("No autorizado");

  const second = await seedUser(t, {
    subject: "ti2-137-adm-11",
    email: "adm11@uct.cl",
    fullName: "Segundo Administrador",
    role: "admin",
  });
  await asAdmin.mutation(api.presentation.accounts.revokeAccount, { userId: second.id });
  const stored = await t.run(async (ctx) => {
    return await ctx.db.get(second.id);
  });
  expect(stored?.institutionalStatus).toBe("disabled");
});
