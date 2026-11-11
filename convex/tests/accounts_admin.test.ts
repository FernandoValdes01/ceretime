/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import { api } from "../_generated/api";
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

/** Datos públicos del error, sin asumir la clase concreta que envuelve Convex. */
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
  code: "unauthorized" | "conflict",
  message: string,
) {
  expect(await publicErrorData(promise)).toEqual({ code, message });
}

const UNAUTHORIZED = { code: "unauthorized", message: "No autorizado" } as const;

function listArgs(role: "professional" | "admin", numItems: number) {
  return { role, paginationOpts: { numItems, cursor: null } };
}

test("administrador lista el personal por rol con claves exactas y sin estudiantes", async () => {
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
  await seedUser(t, {
    subject: "ti2-137-est-1",
    email: "est1@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  await seedUser(t, {
    subject: "ti2-137-int-1",
    email: "practicante1@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
    institutionalStatus: "pending",
  });

  const asAdmin = t.withIdentity(identityFor("ti2-137-adm-1", "adm1@uct.cl"));
  const professionals = await asAdmin.query(
    api.presentation.accounts.listAccounts,
    listArgs("professional", 10),
  );
  expect(professionals.page.map((item) => item.email)).toEqual(["pro1@uct.cl"]);
  expect(Object.keys(professionals.page[0]!).sort()).toEqual([
    "_id",
    "accountStatus",
    "email",
    "fullName",
    "institutionalStatus",
    "role",
  ]);
  for (const item of professionals.page) {
    expect(item).not.toHaveProperty("tokenIdentifier");
  }

  const admins = await asAdmin.query(api.presentation.accounts.listAccounts, listArgs("admin", 10));
  expect(admins.page.map((item) => item.email)).toEqual(["adm1@uct.cl"]);
  expect(admins.isDone).toBe(true);
  expect(typeof admins.continueCursor).toBe("string");
});

test("el detalle entrega claves exactas con auditoría y deniega cuentas fuera de esta vía", async () => {
  const t = convexTest(schema, modules);
  const admin = await seedUser(t, {
    subject: "ti2-137-adm-2",
    email: "adm2@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const pro = await seedUser(t, {
    subject: "ti2-137-pro-2",
    email: "pro2@uct.cl",
    fullName: "Profesional Ficticio",
    role: "professional",
    institutionalStatus: "pending",
  });
  const student = await seedUser(t, {
    subject: "ti2-137-est-2",
    email: "est2@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });

  const asAdmin = t.withIdentity(identityFor("ti2-137-adm-2", "adm2@uct.cl"));
  await asAdmin.mutation(api.presentation.accounts.enableAccount, { userId: pro.id });
  const detail = await asAdmin.query(api.presentation.accounts.getAccount, { userId: pro.id });
  expect(detail.email).toBe("pro2@uct.cl");
  expect(detail.enabledBy).toEqual(admin.id);
  expect(typeof detail.enabledAt).toBe("number");
  expect(Object.keys(detail).sort()).toEqual([
    "_id",
    "accountStatus",
    "email",
    "enabledAt",
    "enabledBy",
    "fullName",
    "institutionalStatus",
    "role",
  ]);
  expect(detail).not.toHaveProperty("tokenIdentifier");

  await expectPublicError(
    asAdmin.query(api.presentation.accounts.getAccount, { userId: student.id }),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );
});

test("correo institucional sin perfil no concede acceso", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti2-137-adm-3",
    email: "adm3@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const ghost = t.withIdentity(identityFor("ti2-137-ghost", "fantasma@uct.cl"));
  expect(
    await publicErrorData(
      ghost.query(api.presentation.accounts.listAccounts, listArgs("professional", 10)),
    ),
  ).toEqual({ code: UNAUTHORIZED.code, message: UNAUTHORIZED.message });
});

test("otros roles, anónimo y administrador inhabilitado no administran cuentas", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti2-137-adm-4",
    email: "adm4@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const target = await seedUser(t, {
    subject: "ti2-137-pro-3",
    email: "pro3@uct.cl",
    fullName: "Profesional Ficticio",
    role: "professional",
    institutionalStatus: "pending",
  });
  await seedUser(t, {
    subject: "ti2-137-est-3",
    email: "est3@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  await seedUser(t, {
    subject: "ti2-137-adm-5",
    email: "adm5@uct.cl",
    fullName: "Administrador Deshabilitado",
    role: "admin",
    institutionalStatus: "disabled",
  });

  const asStudent = t.withIdentity(identityFor("ti2-137-est-3", "est3@alu.uct.cl"));
  expect(
    await publicErrorData(
      asStudent.query(api.presentation.accounts.listAccounts, listArgs("professional", 10)),
    ),
  ).toEqual({ code: UNAUTHORIZED.code, message: UNAUTHORIZED.message });
  await expectPublicError(
    asStudent.query(api.presentation.accounts.getAccount, { userId: target.id }),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );
  await expectPublicError(
    asStudent.mutation(api.presentation.accounts.enableAccount, { userId: target.id }),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );
  await expectPublicError(
    asStudent.mutation(api.presentation.accounts.revokeAccount, { userId: target.id }),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );
  await expectPublicError(
    t.query(api.presentation.accounts.listAccounts, listArgs("professional", 10)),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );
  const asDisabled = t.withIdentity(identityFor("ti2-137-adm-5", "adm5@uct.cl"));
  await expectPublicError(
    asDisabled.query(api.presentation.accounts.listAccounts, listArgs("professional", 10)),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );
});

test("administrar no concede acompañamientos ni notas", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti2-137-adm-6",
    email: "adm6@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const student = await seedUser(t, {
    subject: "ti2-137-est-4",
    email: "est4@alu.uct.cl",
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
  const asAdmin = t.withIdentity(identityFor("ti2-137-adm-6", "adm6@uct.cl"));
  // Superficie previa a TI2-88: denegación heredada en forma de texto.
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

test("habilita profesional de personal con actor y fecha y rechaza practicante", async () => {
  const t = convexTest(schema, modules);
  const admin = await seedUser(t, {
    subject: "ti2-137-adm-7",
    email: "adm7@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const pro = await seedUser(t, {
    subject: "ti2-137-pro-4",
    email: "pro4@uct.cl",
    fullName: "Profesional Ficticio",
    role: "professional",
    institutionalStatus: "pending",
  });
  const intern = await seedUser(t, {
    subject: "ti2-137-int-2",
    email: "practicante2@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
    institutionalStatus: "pending",
  });

  const asAdmin = t.withIdentity(identityFor("ti2-137-adm-7", "adm7@uct.cl"));
  const enabled = await asAdmin.mutation(api.presentation.accounts.enableAccount, {
    userId: pro.id,
  });
  expect(enabled).toEqual({ userId: pro.id });
  const stored = await t.run(async (ctx) => {
    return await ctx.db.get(pro.id);
  });
  expect(stored?.institutionalStatus).toBe("enabled");
  expect(stored?.enabledBy).toEqual(admin.id);
  expect(typeof stored?.enabledAt).toBe("number");

  await expectPublicError(
    asAdmin.mutation(api.presentation.accounts.enableAccount, { userId: intern.id }),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );
});

test("el profesional de prueba no se habilita por esta vía general", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti2-137-adm-8",
    email: "adm8@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const testPro = await seedUser(t, {
    subject: "ti2-137-pro-5",
    email: "pro5@alu.uct.cl",
    fullName: "Profesional de Prueba",
    role: "professional",
    institutionalStatus: "pending",
  });

  const asAdmin = t.withIdentity(identityFor("ti2-137-adm-8", "adm8@uct.cl"));
  await expectPublicError(
    asAdmin.mutation(api.presentation.accounts.enableAccount, { userId: testPro.id }),
    "conflict",
    "El objetivo debe tener correo institucional de personal.",
  );
  const stored = await t.run(async (ctx) => {
    return await ctx.db.get(testPro.id);
  });
  expect(stored?.institutionalStatus).toBe("pending");
});

test("habilita administrador con correo de personal y rechaza el resto", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti2-137-adm-9",
    email: "adm9@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const pendingAdmin = await seedUser(t, {
    subject: "ti2-137-adm-10",
    email: "nuevo@uct.cl",
    fullName: "Nuevo Administrador",
    role: "admin",
    institutionalStatus: "pending",
  });
  const studentAdmin = await seedUser(t, {
    subject: "ti2-137-adm-11",
    email: "estudiantil@alu.uct.cl",
    fullName: "Administrador Estudiantil",
    role: "admin",
    institutionalStatus: "pending",
  });

  const asAdmin = t.withIdentity(identityFor("ti2-137-adm-9", "adm9@uct.cl"));
  await asAdmin.mutation(api.presentation.accounts.enableAccount, {
    userId: pendingAdmin.id,
  });
  const stored = await t.run(async (ctx) => {
    return await ctx.db.get(pendingAdmin.id);
  });
  expect(stored?.institutionalStatus).toBe("enabled");

  await expectPublicError(
    asAdmin.mutation(api.presentation.accounts.enableAccount, {
      userId: studentAdmin.id,
    }),
    "conflict",
    "El objetivo debe tener correo institucional de personal.",
  );

  const before = await t.run(async (ctx) => {
    return await ctx.db.get(pendingAdmin.id);
  });
  await expectPublicError(
    asAdmin.mutation(api.presentation.accounts.enableAccount, {
      userId: pendingAdmin.id,
    }),
    "conflict",
    "La cuenta ya está habilitada.",
  );
  const after = await t.run(async (ctx) => {
    return await ctx.db.get(pendingAdmin.id);
  });
  expect(after?.enabledAt).toBe(before?.enabledAt);
});

test("revoca profesional habilitado y deja de operar en la petición siguiente", async () => {
  const t = convexTest(schema, modules);
  const admin = await seedUser(t, {
    subject: "ti2-137-adm-12",
    email: "adm12@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const pro = await seedUser(t, {
    subject: "ti2-137-pro-6",
    email: "pro6@uct.cl",
    fullName: "Profesional Ficticio",
    role: "professional",
  });

  const asAdmin = t.withIdentity(identityFor("ti2-137-adm-12", "adm12@uct.cl"));
  const revoked = await asAdmin.mutation(api.presentation.accounts.revokeAccount, {
    userId: pro.id,
  });
  expect(revoked).toEqual({ userId: pro.id });
  const stored = await t.run(async (ctx) => {
    return await ctx.db.get(pro.id);
  });
  expect(stored?.institutionalStatus).toBe("disabled");
  expect(stored?.revokedBy).toEqual(admin.id);
  expect(typeof stored?.revokedAt).toBe("number");

  const asPro = t.withIdentity(identityFor("ti2-137-pro-6", "pro6@uct.cl"));
  // El catálogo conserva la denegación heredada en forma de texto.
  await expect(
    asPro.query(api.presentation.spaces.listSpaces, {
      limit: 10,
      version: "v1",
    }),
  ).rejects.toThrow("No autorizado");

  await asAdmin.mutation(api.presentation.accounts.enableAccount, { userId: pro.id });
  const reenabled = await t.run(async (ctx) => {
    return await ctx.db.get(pro.id);
  });
  expect(reenabled?.institutionalStatus).toBe("enabled");
  expect(reenabled?.enabledBy).toEqual(admin.id);
  expect(typeof reenabled?.enabledAt).toBe("number");
  expect(reenabled?.revokedBy).toEqual(admin.id);
  expect(typeof reenabled?.revokedAt).toBe("number");

  const detail = await asAdmin.query(api.presentation.accounts.getAccount, { userId: pro.id });
  expect(detail.institutionalStatus).toBe("enabled");
  expect(Object.keys(detail).sort()).toEqual([
    "_id",
    "accountStatus",
    "email",
    "enabledAt",
    "enabledBy",
    "fullName",
    "institutionalStatus",
    "revokedAt",
    "revokedBy",
    "role",
  ]);

  const asProEnabled = t.withIdentity(identityFor("ti2-137-pro-6", "pro6@uct.cl"));
  const session = await asProEnabled.query(api.presentation.session.getSessionWithRole, {});
  expect(session.role).toMatchObject({ status: "authenticated", role: "professional" });
});

test("revoca a otro administrador y el revocado deja de operar", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti2-137-adm-13",
    email: "adm13@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const second = await seedUser(t, {
    subject: "ti2-137-adm-14",
    email: "adm14@uct.cl",
    fullName: "Segundo Administrador",
    role: "admin",
  });

  const asAdmin = t.withIdentity(identityFor("ti2-137-adm-13", "adm13@uct.cl"));
  await asAdmin.mutation(api.presentation.accounts.revokeAccount, { userId: second.id });
  const stored = await t.run(async (ctx) => {
    return await ctx.db.get(second.id);
  });
  expect(stored?.institutionalStatus).toBe("disabled");

  const asSecond = t.withIdentity(identityFor("ti2-137-adm-14", "adm14@uct.cl"));
  await expectPublicError(
    asSecond.query(api.presentation.accounts.listAccounts, listArgs("professional", 10)),
    UNAUTHORIZED.code,
    UNAUTHORIZED.message,
  );
});

test("no permite auto-revocarse ni revocar una cuenta pendiente, sin escribir", async () => {
  const t = convexTest(schema, modules);
  const admin = await seedUser(t, {
    subject: "ti2-137-adm-15",
    email: "adm15@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const pending = await seedUser(t, {
    subject: "ti2-137-pro-7",
    email: "pro7@uct.cl",
    fullName: "Profesional Pendiente",
    role: "professional",
    institutionalStatus: "pending",
  });

  const asAdmin = t.withIdentity(identityFor("ti2-137-adm-15", "adm15@uct.cl"));
  await expectPublicError(
    asAdmin.mutation(api.presentation.accounts.revokeAccount, { userId: admin.id }),
    "conflict",
    "No puedes revocar tu propia cuenta.",
  );
  await expectPublicError(
    asAdmin.mutation(api.presentation.accounts.revokeAccount, { userId: pending.id }),
    "conflict",
    "La cuenta no está habilitada.",
  );
  const storedAdmin = await t.run(async (ctx) => {
    return await ctx.db.get(admin.id);
  });
  expect(storedAdmin?.institutionalStatus).toBe("enabled");
  expect(storedAdmin).not.toHaveProperty("revokedBy");
  const storedPending = await t.run(async (ctx) => {
    return await ctx.db.get(pending.id);
  });
  expect(storedPending?.institutionalStatus).toBe("pending");
  expect(storedPending).not.toHaveProperty("revokedBy");
});

test("el límite fuera de rango se rechaza y el tope es 100", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti2-137-adm-16",
    email: "adm16@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });

  const asAdmin = t.withIdentity(identityFor("ti2-137-adm-16", "adm16@uct.cl"));
  await expect(
    asAdmin.query(api.presentation.accounts.listAccounts, listArgs("professional", 0)),
  ).rejects.toThrow("El límite del listado debe ser un entero entre 1 y 100.");
  await expect(
    asAdmin.query(api.presentation.accounts.listAccounts, listArgs("professional", 101)),
  ).rejects.toThrow("El límite del listado debe ser un entero entre 1 y 100.");

  for (let i = 0; i < 101; i++) {
    await seedUser(t, {
      subject: `ti2-137-cap-${i}`,
      email: `cap${i}@uct.cl`,
      fullName: `Profesional Tope ${i}`,
      role: "professional",
    });
  }
  const page = await asAdmin.query(
    api.presentation.accounts.listAccounts,
    listArgs("professional", 100),
  );
  expect(page.page.length).toBe(100);
  expect(page.isDone).toBe(false);
});
