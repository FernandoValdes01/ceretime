/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const ISSUER = "https://accounts.google.com";

// Exacto y no por inclusión: un mensaje que agregue el motivo debe fallar.
const DENIED = /^No autorizado$/;
// Solicitudes usa el contrato común de errores (TI2-88).
const UNAUTHORIZED = /"code":"unauthorized"/;

function identityFor(subject: string, email: string, name = "Persona Ficticia") {
  return {
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    email,
    name,
  };
}

async function usersWithEmail(t: ReturnType<typeof convexTest>, email: string) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect(),
  );
}

/**
 * Perfil propio en el primer ingreso (TI2-182): sin esta fila cada consulta
 * guardada deniega aunque la sesión de Google sea válida.
 */
test("el Estudiante obtiene su perfil habilitado y ya puede leer lo propio", async () => {
  const t = convexTest(schema, modules);
  const caller = t.withIdentity(identityFor("ti182-est", "Ti182.Est@alu.uct.cl"));

  await expect(
    caller.query(api.presentation.requests.listOwnRequests, {
      paginationOpts: { numItems: 5, cursor: null },
    }),
  ).rejects.toThrow(UNAUTHORIZED);

  const profile = await caller.mutation(api.presentation.session.ensureMyProfile, {});
  expect(profile).toEqual({
    fullName: "Persona Ficticia",
    email: "ti182.est@alu.uct.cl",
    role: "student",
    institutionalStatus: "enabled",
    accountStatus: "active",
  });

  const state = await caller.query(api.presentation.session.getSessionWithRole, {});
  expect(state.role).toEqual({
    status: "authenticated",
    role: "student",
    email: "ti182.est@alu.uct.cl",
  });
  const requests = await caller.query(api.presentation.requests.listOwnRequests, {
    paginationOpts: { numItems: 5, cursor: null },
  });
  expect(requests.page).toEqual([]);

  const [row] = await usersWithEmail(t, "ti182.est@alu.uct.cl");
  expect(row?.enabledAt).toBeTypeOf("number");
  expect(row?.enabledBy).toBeUndefined();
});

test("el personal obtiene un perfil pendiente que no opera hasta su habilitación", async () => {
  const t = convexTest(schema, modules);
  const caller = t.withIdentity(identityFor("ti182-pro", "ti182-pro@uct.cl"));

  const profile = await caller.mutation(api.presentation.session.ensureMyProfile, {});
  expect(profile).toMatchObject({ role: "professional", institutionalStatus: "pending" });

  const state = await caller.query(api.presentation.session.getSessionWithRole, {});
  expect(state.role).toEqual({ status: "unauthenticated" });
  await expect(
    caller.query(api.presentation.requests.listOwnRequests, {
      paginationOpts: { numItems: 5, cursor: null },
    }),
  ).rejects.toThrow(UNAUTHORIZED);

  const [row] = await usersWithEmail(t, "ti182-pro@uct.cl");
  expect(row?.enabledAt).toBeUndefined();
});

test("repetir la llamada devuelve el perfil existente sin duplicarlo ni cambiarlo", async () => {
  const t = convexTest(schema, modules);
  const caller = t.withIdentity(identityFor("ti182-rep", "ti182-rep@uct.cl"));
  await caller.mutation(api.presentation.session.ensureMyProfile, {});

  // Una cuenta revocada no se rehabilita por volver a ingresar.
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "ti182-rep@uct.cl"))
      .unique();
    if (row !== null) await ctx.db.patch(row._id, { institutionalStatus: "disabled" });
  });

  const again = await caller.mutation(api.presentation.session.ensureMyProfile, {});
  expect(again).toMatchObject({ role: "professional", institutionalStatus: "disabled" });
  expect(await usersWithEmail(t, "ti182-rep@uct.cl")).toHaveLength(1);
});

test("un perfil ya vinculado conserva su rol aunque el dominio sugiera otro", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      email: "ti182-int@alu.uct.cl",
      fullName: "Practicante Ficticio",
      role: "intern",
      institutionalStatus: "pending",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|ti182-int`,
    });
  });
  const caller = t.withIdentity(identityFor("ti182-int", "ti182-int@alu.uct.cl"));
  const profile = await caller.mutation(api.presentation.session.ensureMyProfile, {});
  expect(profile).toMatchObject({ role: "intern", institutionalStatus: "pending" });
});

test("un correo registrado con otra identidad no se vincula ni se duplica", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      email: "ti182-dup@uct.cl",
      fullName: "Administrador Ficticio",
      role: "admin",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|otra-identidad`,
    });
  });
  const caller = t.withIdentity(identityFor("ti182-dup", "ti182-dup@uct.cl"));
  await expect(caller.mutation(api.presentation.session.ensureMyProfile, {})).rejects.toThrow(
    DENIED,
  );
  const rows = await usersWithEmail(t, "ti182-dup@uct.cl");
  expect(rows).toHaveLength(1);
  expect(rows[0]?.tokenIdentifier).toBe(`${ISSUER}|otra-identidad`);
});

test("sin identidad o con correo externo responde la denegación genérica", async () => {
  const t = convexTest(schema, modules);
  await expect(t.mutation(api.presentation.session.ensureMyProfile, {})).rejects.toThrow(DENIED);

  const external = t.withIdentity(identityFor("ti182-ext", "persona@gmail.com"));
  await expect(external.mutation(api.presentation.session.ensureMyProfile, {})).rejects.toThrow(
    DENIED,
  );
  expect(await usersWithEmail(t, "persona@gmail.com")).toEqual([]);
});
