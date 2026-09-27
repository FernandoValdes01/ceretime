/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Guardia de semillas de desarrollo (TI2-11).
 *
 * `internal.users.createTestUser` solo opera con el interruptor de entorno
 * `TEST_SEEDS_ENABLED === "true"` (variable de servidor, no controlable por
 * el cliente). La primera prueba fija la marca en vacío —reproduce
 * producción— y demuestra el rechazo; `users.test.ts` la activa para su
 * propio proceso.
 */

function seedArgs(overrides: Record<string, unknown> = {}) {
  return {
    email: "semilla.ficticia@alu.uct.cl",
    fullName: "Semilla Ficticia",
    role: "student" as const,
    institutionalStatus: "enabled" as const,
    accountStatus: "active" as const,
    tokenIdentifier: "https://accounts.google.com|semilla-guard-1",
    ...overrides,
  };
}

test("sin interruptor (producción) rechaza la semilla", async () => {
  vi.stubEnv("TEST_SEEDS_ENABLED", "");
  const t = convexTest(schema, modules);
  await expect(t.mutation(internal.users.createTestUser, seedArgs())).rejects.toThrow(
    "no están habilitadas en este entorno",
  );
});

test("con interruptor rechaza crear administradores fuera del arranque", async () => {
  vi.stubEnv("TEST_SEEDS_ENABLED", "true");
  const t = convexTest(schema, modules);
  await expect(
    t.mutation(
      internal.users.createTestUser,
      seedArgs({ role: "admin", tokenIdentifier: "https://accounts.google.com|semilla-guard-2" }),
    ),
  ).rejects.toThrow("no pueden crear administradores");
});
