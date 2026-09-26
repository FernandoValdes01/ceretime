/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Pruebas de borde de sesión con identidad simulada (TI2-3).
 *
 * Verifican que `getSessionState` niega en el backend (sin llegar a Google):
 * cubren JWT anónimo, dominio externo y dominio institucional. El flujo
 * OAuth real contra Google queda como evidencia manual (TI2-15).
 */

test("identidad institucional recibe identidad mínima", async () => {
  const t = convexTest(schema, modules);
  const authed = t.withIdentity({
    subject: "alu-123",
    issuer: "https://accounts.google.com",
    email: "a@alu.uct.cl",
    name: " Ana ",
  });
  const state = await authed.query(api.presentation.session.getSessionState, {});
  expect(state).toEqual({
    status: "authenticated",
    email: "a@alu.uct.cl",
    name: "Ana",
    population: "estudiante",
  });
});

test("identidad personal recibe población personal", async () => {
  const t = convexTest(schema, modules);
  const authed = t.withIdentity({
    subject: "uct-789",
    issuer: "https://accounts.google.com",
    email: "p@uct.cl",
    name: "Pao",
  });
  const state = await authed.query(api.presentation.session.getSessionState, {});
  expect(state).toEqual({
    status: "authenticated",
    email: "p@uct.cl",
    name: "Pao",
    population: "personal",
  });
});

test("dominio externo responde no autenticado sin motivo", async () => {
  const t = convexTest(schema, modules);
  const authed = t.withIdentity({
    subject: "ext-456",
    issuer: "https://accounts.google.com",
    email: "a@gmail.com",
    name: "Externa",
  });
  const state = await authed.query(api.presentation.session.getSessionState, {});
  expect(state).toEqual({ status: "unauthenticated" });
});

test("sin identidad responde no autenticado", async () => {
  const t = convexTest(schema, modules);
  const state = await t.query(api.presentation.session.getSessionState, {});
  expect(state).toEqual({ status: "unauthenticated" });
});

test("cuenta no autorizada y sesión ausente responden idéntico sin filtrar motivo (TI2-14)", async () => {
  const t = convexTest(schema, modules);
  const externa = t.withIdentity({
    subject: "ext-999",
    issuer: "https://accounts.google.com",
    email: "intruso@gmail.com",
    name: "Intruso",
  });
  const externaState = await externa.query(api.presentation.session.getSessionState, {});
  const anonymousState = await t.query(api.presentation.session.getSessionState, {});
  expect(externaState).toEqual(anonymousState);
  expect(externaState).toEqual({ status: "unauthenticated" });
  expect(externaState).not.toHaveProperty("email");
});

test("expiración (identidad ausente) responde no autenticado sin filtrar motivo (TI2-15)", async () => {
  // Convex expone la expiración como identidad nula: no hay transición que
  // invalidar dentro de convex-test, por lo que se fija el contrato del
  // estado anónimo que una sesión expirada debe observar.
  const t = convexTest(schema, modules);
  const expired = await t.query(api.presentation.session.getSessionState, {});
  const neverAuthed = await t.query(api.presentation.session.getSessionState, {});
  expect(expired).toEqual({ status: "unauthenticated" });
  expect(expired).toEqual(neverAuthed);
  expect(expired).not.toHaveProperty("email");
});

test("cierre (identidad ausente) responde no autenticado sin datos mínimos (TI2-15)", async () => {
  // Igual que la expiración: tras `signOut`, Better Auth invalida la sesión
  // fuera de este código y el backend solo vuelve a ver identidad nula.
  const t = convexTest(schema, modules);
  const signedOut = await t.query(api.presentation.session.getSessionState, {});
  expect(signedOut).toEqual({ status: "unauthenticated" });
  expect(signedOut).not.toHaveProperty("email");
  expect(signedOut).not.toHaveProperty("name");
  expect(signedOut).not.toHaveProperty("population");
});
