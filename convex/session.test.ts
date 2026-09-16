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
