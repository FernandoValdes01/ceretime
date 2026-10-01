/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Contratos públicos de agenda versionados (TI2-87).
 *
 * Las entradas son adaptadores delgados: validan la forma, resuelven la
 * identidad en el servidor y no tocan `ctx.db` ni deciden reglas de negocio.
 * Toda denegación responde el genérico sin motivo y los topes se rechazan
 * con mensaje estable en español. Cada prueba usa identidad simulada y datos
 * ficticios, sin editar `schema.ts` ni los casos de uso de otros módulos.
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

async function seedStudent(t: ReturnType<typeof convexTest>, subject: string, email: string) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email,
      fullName: "Ficticio",
      role: "student",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|${subject}`,
    });
  });
}

test("Anónimo se deniega con error genérico y autenticado recibe v1", async () => {
  const t = convexTest(schema, modules);
  await expect(t.query(api.presentation.agenda.getAgendaContractVersion, {})).rejects.toThrow(
    "No autorizado",
  );

  await seedStudent(t, "ti87-est-1", "ti87-est-1@alu.uct.cl");
  const asStudent = t.withIdentity(identityFor("ti87-est-1", "ti87-est-1@alu.uct.cl"));
  const contract = await asStudent.query(api.presentation.agenda.getAgendaContractVersion, {});
  expect(contract).toEqual({
    version: "v1",
    availabilityVersion: "v1",
    spaceVersion: "v1",
    reservationVersion: "v1",
    errorVersion: "v1",
  });
});

test("Catálogo propio exige identidad, respeta el tope y devuelve ficticios tipados", async () => {
  const t = convexTest(schema, modules);
  await expect(t.query(api.presentation.agenda.listSpaceCatalog, { limit: 2 })).rejects.toThrow(
    "No autorizado",
  );

  await seedStudent(t, "ti87-est-2", "ti87-est-2@alu.uct.cl");
  const asStudent = t.withIdentity(identityFor("ti87-est-2", "ti87-est-2@alu.uct.cl"));
  const page = await asStudent.query(api.presentation.agenda.listSpaceCatalog, { limit: 2 });
  expect(page.version).toBe("v1");
  expect(page.items).toHaveLength(2);
  expect(page.items[0]?.room).toBe("Sala C-204");
  expect(page.hasMore).toBe(true);

  const full = await asStudent.query(api.presentation.agenda.listSpaceCatalog, { limit: 50 });
  expect(full.items.length).toBeLessThanOrEqual(50);
  expect(full.items.every((space) => space.version === "v1")).toBe(true);
});

test("Límites y cursor inválidos se rechazan sin revelar datos", async () => {
  const t = convexTest(schema, modules);
  await seedStudent(t, "ti87-est-3", "ti87-est-3@alu.uct.cl");
  const asStudent = t.withIdentity(identityFor("ti87-est-3", "ti87-est-3@alu.uct.cl"));

  await expect(
    asStudent.query(api.presentation.agenda.listSpaceCatalog, { limit: 0 }),
  ).rejects.toThrow("entre 1 y 50");
  await expect(
    asStudent.query(api.presentation.agenda.listSpaceCatalog, { limit: 51 }),
  ).rejects.toThrow("entre 1 y 50");
  await expect(
    asStudent.query(api.presentation.agenda.listSpaceCatalog, { limit: 2, cursor: "   " }),
  ).rejects.toThrow("cursor");
});

test("Sprint 1 sigue compatible: el rechazo operativo no cambia", async () => {
  const t = convexTest(schema, modules);
  await seedStudent(t, "ti87-est-4", "ti87-est-4@alu.uct.cl");
  const asStudent = t.withIdentity(identityFor("ti87-est-4", "ti87-est-4@alu.uct.cl"));
  const message = await asStudent
    .mutation(api.presentation.requests.createRequest, { accessNeeds: "   " })
    .then(
      () => {
        throw new Error("Se esperaba rechazo operativo");
      },
      (error: Error) => error.message,
    );
  expect(message).toContain("necesidad");
  expect(message).not.toContain("No autorizado");
});
