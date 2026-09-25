/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Role } from "./domain/identity/roles";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ISSUER = "https://accounts.google.com";

/** Identidad simulada con `tokenIdentifier` explícito. */
function identityFor(subject: string, email: string) {
  return {
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    email,
    name: "Ficticio",
  };
}

/** Perfil ficticio persistido con el rol y la vigencia indicados. */
async function seedUser(
  t: ReturnType<typeof convexTest>,
  subject: string,
  role: Role,
  vigencia: {
    email?: string;
    institutionalStatus?: "enabled" | "disabled";
    accountStatus?: "active" | "inactive";
  } = {},
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: vigencia.email ?? `${subject}@uct.cl`,
      fullName: "Personal Ficticio",
      role,
      institutionalStatus: vigencia.institutionalStatus ?? "enabled",
      accountStatus: vigencia.accountStatus ?? "active",
      tokenIdentifier: `${ISSUER}|${subject}`,
    });
  });
}

/**
 * Sesión y rol propios para navegación Web con identidad simulada (TI2-20).
 *
 * Verifica que ambas mitades salgan de la misma identidad en una única
 * respuesta: al cambiar de cuenta la Web nunca observa la sesión de una
 * con el rol de otra. No prueba autorización: esa vive en cada función
 * guardada del Backend.
 */
test("cada rol recibe sesión y rol vinculados a la misma identidad", async () => {
  const t = convexTest(schema, modules);
  for (const role of ["professional", "intern", "admin"] as const) {
    await seedUser(t, `ti20-${role}`, role);
    const caller = t.withIdentity(identityFor(`ti20-${role}`, `ti20-${role}@uct.cl`));
    const state = await caller.query(api.presentation.session.getSessionWithRole, {});
    expect(state).toEqual({
      session: {
        status: "authenticated",
        email: `ti20-${role}@uct.cl`,
        name: "Ficticio",
        population: "personal",
      },
      role: { status: "authenticated", role, email: `ti20-${role}@uct.cl` },
    });
  }
});

test("el Estudiante recibe población estudiante y su rol", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti20-est", "student");
  const caller = t.withIdentity(identityFor("ti20-est", "ti20-est@alu.uct.cl"));
  const state = await caller.query(api.presentation.session.getSessionWithRole, {});
  expect(state.session).toMatchObject({ status: "authenticated", population: "estudiante" });
  expect(state.role).toEqual({
    status: "authenticated",
    role: "student",
    email: "ti20-est@uct.cl",
  });
});

test("el correo del perfil puede diferir del de la identidad sin bloquear", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti20-boot", "admin", { email: "otro@uct.cl" });
  const caller = t.withIdentity(identityFor("ti20-boot", "ti20-boot@uct.cl"));
  const state = await caller.query(api.presentation.session.getSessionWithRole, {});
  expect(state.session).toMatchObject({ status: "authenticated", email: "ti20-boot@uct.cl" });
  expect(state.role).toEqual({ status: "authenticated", role: "admin", email: "otro@uct.cl" });
});

test("identidad sin perfil mantiene sesión pero sin rol", async () => {
  const t = convexTest(schema, modules);
  const stranger = t.withIdentity(identityFor("ti20-fantasma", "fantasma@uct.cl"));
  const state = await stranger.query(api.presentation.session.getSessionWithRole, {});
  expect(state).toEqual({
    session: {
      status: "authenticated",
      email: "fantasma@uct.cl",
      name: "Ficticio",
      population: "personal",
    },
    role: { status: "unauthenticated" },
  });
});

test("sin identidad responde no autenticado en ambas mitades", async () => {
  const t = convexTest(schema, modules);
  const state = await t.query(api.presentation.session.getSessionWithRole, {});
  expect(state).toEqual({
    session: { status: "unauthenticated" },
    role: { status: "unauthenticated" },
  });
});

test("perfil inhabilitado mantiene sesión pero sin rol", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti20-deshabilitado", "professional", { institutionalStatus: "disabled" });
  const deshabilitado = t.withIdentity(
    identityFor("ti20-deshabilitado", "ti20-deshabilitado@uct.cl"),
  );
  const deshabilitadoState = await deshabilitado.query(
    api.presentation.session.getSessionWithRole,
    {},
  );
  expect(deshabilitadoState.session.status).toBe("authenticated");
  expect(deshabilitadoState.role).toEqual({ status: "unauthenticated" });

  await seedUser(t, "ti20-inactivo", "admin", { accountStatus: "inactive" });
  const inactivo = t.withIdentity(identityFor("ti20-inactivo", "ti20-inactivo@uct.cl"));
  const inactivoState = await inactivo.query(api.presentation.session.getSessionWithRole, {});
  expect(inactivoState.session.status).toBe("authenticated");
  expect(inactivoState.role).toEqual({ status: "unauthenticated" });
});
