/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import { SPRINT_1_REQUEST_STATES } from "../domain/requests/state";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

/**
 * Dataset ficticio del Sprint 1 (TI2-30). Cada prueba fija el interruptor de
 * semillas: vacío reproduce producción.
 */

async function snapshot(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ({
    users: await ctx.db.query("users").collect(),
    requests: await ctx.db.query("requests").collect(),
    transitions: await ctx.db.query("requestTransitions").collect(),
    accompaniments: await ctx.db.query("accompaniments").collect(),
    assignments: await ctx.db.query("accompanimentAssignments").collect(),
  }));
}

test("sin interruptor (producción) rechaza la carga del dataset", async () => {
  vi.stubEnv("TEST_SEEDS_ENABLED", "");
  const t = convexTest(schema, modules);
  await expect(t.mutation(internal.operations.fictitiousData.load, {})).rejects.toThrow(
    "no están habilitadas en este entorno",
  );
});

test("sin interruptor (producción) rechaza crear solicitudes de prueba", async () => {
  vi.stubEnv("TEST_SEEDS_ENABLED", "");
  const t = convexTest(schema, modules);
  const studentId = await t.run((ctx) =>
    ctx.db.insert("users", {
      email: "guardia.solicitud@alu.uct.cl",
      fullName: "Guardia Solicitud",
      role: "student",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: "https://accounts.google.com|guardia-solicitud",
    }),
  );
  await expect(
    t.mutation(internal.operations.requests.createTestRequest, {
      studentId,
      status: "received",
      accessNeeds: "Necesidad de acceso ficticia",
    }),
  ).rejects.toThrow("no están habilitadas en este entorno");
});

test("carga una solicitud por estado del Sprint 1 y un acompañamiento con Practicante", async () => {
  vi.stubEnv("TEST_SEEDS_ENABLED", "true");
  const t = convexTest(schema, modules);
  expect(await t.mutation(internal.operations.fictitiousData.load, {})).toEqual({ loaded: true });

  const data = await snapshot(t);
  expect(data.users.map((user) => user.role).sort()).toEqual([
    "intern",
    "professional",
    "student",
    "student",
    "student",
    "student",
  ]);
  expect(data.users.every((user) => user.tokenIdentifier.startsWith("dataset-ficticio|"))).toBe(
    true,
  );
  expect(data.requests.map((request) => request.status).sort()).toEqual(
    [...SPRINT_1_REQUEST_STATES].sort(),
  );
  // Tomar, pedir información y aceptar registran cada cambio de estado.
  expect(data.transitions).toHaveLength(5);

  const accepted = data.requests.find((request) => request.status === "accepted");
  expect(data.accompaniments).toHaveLength(1);
  expect(data.accompaniments[0]?.requestId).toBe(accepted?._id);
  expect(
    data.assignments
      .filter((assignment) => assignment.status === "active")
      .map((assignment) => assignment.assignedRole)
      .sort(),
  ).toEqual(["intern", "professional"]);
});

test("una segunda carga no escribe nada", async () => {
  vi.stubEnv("TEST_SEEDS_ENABLED", "true");
  const t = convexTest(schema, modules);
  await t.mutation(internal.operations.fictitiousData.load, {});
  const first = await snapshot(t);

  expect(await t.mutation(internal.operations.fictitiousData.load, {})).toEqual({ loaded: false });
  expect(await snapshot(t)).toEqual(first);
});
