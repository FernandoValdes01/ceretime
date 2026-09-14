/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Habilitación institucional y arranque administrativo (TI2-11).
 *
 * Cada prueba usa identidad simulada (`withIdentity` con `tokenIdentifier`
 * explícito) y datos ficticios. La habilitación la resuelve el servidor a
 * partir de `ctx.auth.getUserIdentity()`; ningún `userId` del cliente se usa
 * como prueba. Habilitar no concede acompañamientos: esa asignación la hace
 * un Profesional por la vía guardada y se verifica separada.
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

test("administrador habilita al practicante pendiente y registra actor y fecha", async () => {
  const t = convexTest(schema, modules);
  const admin = await seedUser(t, {
    subject: "ti2-11-adm-1",
    email: "adm1@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const intern = await seedUser(t, {
    subject: "ti2-11-int-1",
    email: "practicante1@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
    institutionalStatus: "pending",
  });

  const asAdmin = t.withIdentity(identityFor("ti2-11-adm-1", "adm1@uct.cl"));
  const enabledId = await asAdmin.mutation(internal.accounts.enableIntern, {
    userId: intern.id,
  });
  expect(enabledId).toEqual(intern.id);

  const enabled = await t.run(async (ctx) => {
    return await ctx.db.get(intern.id);
  });
  expect(enabled?.institutionalStatus).toBe("enabled");
  expect(enabled?.role).toBe("intern");
  expect(enabled?.enabledBy).toEqual(admin.id);
  expect(typeof enabled?.enabledAt).toBe("number");
});

test("cuenta habilitada sigue sin leer acompañamientos sin asignación", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti2-11-adm-2",
    email: "adm2@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const student = await seedUser(t, {
    subject: "ti2-11-est-1",
    email: "est1@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const intern = await seedUser(t, {
    subject: "ti2-11-int-2",
    email: "practicante2@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
    institutionalStatus: "pending",
  });
  const accompanimentId = await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId: student.id,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "Necesidad de acceso ficticia",
    });
  });

  const asAdmin = t.withIdentity(identityFor("ti2-11-adm-2", "adm2@uct.cl"));
  await asAdmin.mutation(internal.accounts.enableIntern, { userId: intern.id });

  const asIntern = t.withIdentity(identityFor("ti2-11-int-2", "practicante2@alu.uct.cl"));
  await expect(
    asIntern.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
  ).rejects.toThrow("No autorizado");
});

test("habilitar exige administrador vigente: otros roles y anónimo denegados", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti2-11-adm-3",
    email: "adm3@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const student = await seedUser(t, {
    subject: "ti2-11-est-2",
    email: "est2@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
  });
  const pro = await seedUser(t, {
    subject: "ti2-11-pro-1",
    email: "pro1@uct.cl",
    fullName: "Profesional Ficticio",
    role: "professional",
  });
  const internCaller = await seedUser(t, {
    subject: "ti2-11-int-3",
    email: "practicante3@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
  });
  await seedUser(t, {
    subject: "ti2-11-adm-4",
    email: "adm4@uct.cl",
    fullName: "Administrador Deshabilitado",
    role: "admin",
    institutionalStatus: "disabled",
  });
  const target = await seedUser(t, {
    subject: "ti2-11-int-4",
    email: "practicante4@alu.uct.cl",
    fullName: "Practicante Objetivo",
    role: "intern",
    institutionalStatus: "pending",
  });
  const input = { userId: target.id };

  await expect(t.mutation(internal.accounts.enableIntern, input)).rejects.toThrow("No autorizado");

  const asStudent = t.withIdentity(identityFor("ti2-11-est-2", "est2@alu.uct.cl"));
  await expect(asStudent.mutation(internal.accounts.enableIntern, input)).rejects.toThrow(
    "No autorizado",
  );
  expect(student.id).toBeDefined();

  const asPro = t.withIdentity(identityFor("ti2-11-pro-1", "pro1@uct.cl"));
  await expect(asPro.mutation(internal.accounts.enableIntern, input)).rejects.toThrow(
    "No autorizado",
  );
  expect(pro.id).toBeDefined();

  const asIntern = t.withIdentity(identityFor("ti2-11-int-3", "practicante3@alu.uct.cl"));
  await expect(asIntern.mutation(internal.accounts.enableIntern, input)).rejects.toThrow(
    "No autorizado",
  );
  expect(internCaller.id).toBeDefined();

  const asDisabled = t.withIdentity(identityFor("ti2-11-adm-4", "adm4@uct.cl"));
  await expect(asDisabled.mutation(internal.accounts.enableIntern, input)).rejects.toThrow(
    "No autorizado",
  );
});

test("validación del objetivo: correo, vigencia, rol y estado pendiente", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti2-11-adm-5",
    email: "adm5@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const asAdmin = t.withIdentity(identityFor("ti2-11-adm-5", "adm5@uct.cl"));

  const external = await seedUser(t, {
    subject: "ti2-11-int-5",
    email: "externo@gmail.com",
    fullName: "Practicante Externo",
    role: "intern",
    institutionalStatus: "pending",
  });
  await expect(
    asAdmin.mutation(internal.accounts.enableIntern, { userId: external.id }),
  ).rejects.toThrow("institucional");

  const inactive = await seedUser(t, {
    subject: "ti2-11-int-6",
    email: "practicante6@alu.uct.cl",
    fullName: "Practicante Inactivo",
    role: "intern",
    institutionalStatus: "pending",
    accountStatus: "inactive",
  });
  await expect(
    asAdmin.mutation(internal.accounts.enableIntern, { userId: inactive.id }),
  ).rejects.toThrow("vigente");

  const notIntern = await seedUser(t, {
    subject: "ti2-11-est-3",
    email: "est3@alu.uct.cl",
    fullName: "Estudiante Ficticio",
    role: "student",
    institutionalStatus: "pending",
  });
  await expect(
    asAdmin.mutation(internal.accounts.enableIntern, { userId: notIntern.id }),
  ).rejects.toThrow("Practicante");

  const disabled = await seedUser(t, {
    subject: "ti2-11-int-7",
    email: "practicante7@alu.uct.cl",
    fullName: "Practicante Deshabilitado",
    role: "intern",
    institutionalStatus: "disabled",
  });
  await expect(
    asAdmin.mutation(internal.accounts.enableIntern, { userId: disabled.id }),
  ).rejects.toThrow("pendientes");

  const already = await seedUser(t, {
    subject: "ti2-11-int-8",
    email: "practicante8@alu.uct.cl",
    fullName: "Practicante Habilitado",
    role: "intern",
    institutionalStatus: "enabled",
  });
  await expect(
    asAdmin.mutation(internal.accounts.enableIntern, { userId: already.id }),
  ).rejects.toThrow("ya está habilitada");
});

test("recurso inexistente responde igual que denegado", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti2-11-adm-6",
    email: "adm6@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const missingId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      email: "temporal.ficticio@alu.uct.cl",
      fullName: "Temporal Ficticio",
      role: "intern",
      institutionalStatus: "pending",
      accountStatus: "active",
      tokenIdentifier: "https://accounts.google.com|temporal-ti2-11",
    });
    await ctx.db.delete(id);
    return id;
  });

  const asAdmin = t.withIdentity(identityFor("ti2-11-adm-6", "adm6@uct.cl"));
  await expect(
    asAdmin.mutation(internal.accounts.enableIntern, {
      userId: missingId as Id<"users">,
    }),
  ).rejects.toThrow("No autorizado");
});

test("arranque crea al primer administrador y rechaza el segundo", async () => {
  const t = convexTest(schema, modules);
  const created = await t.mutation(internal.accounts.ensureBootstrapAdmin, {
    email: "inicial@uct.cl",
    fullName: "Administrador Inicial",
    tokenIdentifier: "https://accounts.google.com|bootstrap-1",
  });

  const stored = await t.run(async (ctx) => {
    return await ctx.db.get(created);
  });
  expect(stored?.role).toBe("admin");
  expect(stored?.institutionalStatus).toBe("enabled");
  expect(stored?.accountStatus).toBe("active");
  expect(stored?.email).toBe("inicial@uct.cl");
  expect(typeof stored?.enabledAt).toBe("number");

  await expect(
    t.mutation(internal.accounts.ensureBootstrapAdmin, {
      email: "otro@uct.cl",
      fullName: "Otro Administrador",
      tokenIdentifier: "https://accounts.google.com|bootstrap-2",
    }),
  ).rejects.toThrow("Ya existe una cuenta administrativa");
});

test("arranque rechaza correo no institucional e identidad duplicada", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.mutation(internal.accounts.ensureBootstrapAdmin, {
      email: "externo@gmail.com",
      fullName: "Administrador Externo",
      tokenIdentifier: "https://accounts.google.com|bootstrap-ext",
    }),
  ).rejects.toThrow("institucional");

  await expect(
    t.mutation(internal.accounts.ensureBootstrapAdmin, {
      email: "estudiante@alu.uct.cl",
      fullName: "Administrador Estudiantil",
      tokenIdentifier: "https://accounts.google.com|bootstrap-alu",
    }),
  ).rejects.toThrow("institucional");

  await seedUser(t, {
    subject: "bootstrap-dup",
    email: "previo@uct.cl",
    fullName: "Previo Ficticio",
    role: "professional",
  });
  await expect(
    t.mutation(internal.accounts.ensureBootstrapAdmin, {
      email: "nuevo@uct.cl",
      fullName: "Nuevo Administrador",
      tokenIdentifier: "https://accounts.google.com|bootstrap-dup",
    }),
  ).rejects.toThrow("Ya existe un perfil");
});

test("la habilitación jamás cambia el rol ni crea administradores", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti2-11-adm-7",
    email: "adm7@uct.cl",
    fullName: "Administrador Ficticio",
    role: "admin",
  });
  const intern = await seedUser(t, {
    subject: "ti2-11-int-9",
    email: "practicante9@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
    institutionalStatus: "pending",
  });
  const otherAdmin = await seedUser(t, {
    subject: "ti2-11-adm-8",
    email: "adm8@uct.cl",
    fullName: "Otro Administrador",
    role: "admin",
    institutionalStatus: "pending",
  });

  const asAdmin = t.withIdentity(identityFor("ti2-11-adm-7", "adm7@uct.cl"));
  await asAdmin.mutation(internal.accounts.enableIntern, { userId: intern.id });
  const stored = await t.run(async (ctx) => {
    return await ctx.db.get(intern.id);
  });
  expect(stored?.role).toBe("intern");

  // Ni siquiera un administrador pendiente se habilita por esta vía: no hay
  // promoción a administrador desde la habilitación de practicantes.
  await expect(
    asAdmin.mutation(internal.accounts.enableIntern, { userId: otherAdmin.id }),
  ).rejects.toThrow("Practicante");

  // La vía guardada exige permiso incluso sin identidad.
  await expect(t.mutation(internal.accounts.enableIntern, { userId: intern.id })).rejects.toThrow(
    "No autorizado",
  );
});
