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

/** Perfil ficticio persistido con el rol indicado. */
async function seedUser(t: ReturnType<typeof convexTest>, subject: string, role: Role) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: `${subject}@uct.cl`,
      fullName: "Personal Ficticio",
      role,
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|${subject}`,
    });
  });
}

/**
 * Rol propio para navegación Web con identidad simulada (TI2-20).
 *
 * Verifica que `getSessionRole` reporte el rol del perfil vinculado y que
 * los casos sin perfil o sin identidad respondan no autenticado, sin
 * exponer el motivo. No prueba autorización: esa vive en cada función
 * guardada del Backend.
 */
test("cada rol recibe su portal", async () => {
  const t = convexTest(schema, modules);
  for (const role of ["professional", "intern", "admin", "student"] as const) {
    await seedUser(t, `ti20-${role}`, role);
    const caller = t.withIdentity(identityFor(`ti20-${role}`, `ti20-${role}@uct.cl`));
    const state = await caller.query(api.presentation.session.getSessionRole, {});
    expect(state).toEqual({ status: "authenticated", role });
  }
});

test("identidad sin perfil responde no autenticado", async () => {
  const t = convexTest(schema, modules);
  const stranger = t.withIdentity(identityFor("ti20-fantasma", "fantasma@uct.cl"));
  const state = await stranger.query(api.presentation.session.getSessionRole, {});
  expect(state).toEqual({ status: "unauthenticated" });
});

test("sin identidad responde no autenticado", async () => {
  const t = convexTest(schema, modules);
  const state = await t.query(api.presentation.session.getSessionRole, {});
  expect(state).toEqual({ status: "unauthenticated" });
});
