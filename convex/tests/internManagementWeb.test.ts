/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
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
    role: "student" | "professional" | "intern" | "admin";
    institutionalStatus?: "enabled" | "disabled" | "pending";
    accountStatus?: "active" | "inactive";
  },
) {
  const tokenIdentifier = `${ISSUER}|${input.subject}`;
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: input.email,
      fullName: "Ficticio",
      role: input.role,
      institutionalStatus: input.institutionalStatus ?? "enabled",
      accountStatus: input.accountStatus ?? "active",
      tokenIdentifier,
    });
  });
  return { id, tokenIdentifier };
}

async function seedAccompaniment(t: ReturnType<typeof convexTest>, studentId: Id<"users">) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "Necesidad de acceso ficticia",
    });
  });
}

/**
 * Gestión de practicantes desde la Web del Profesional (TI2-170).
 *
 * Cubre las lecturas nuevas (`listInternAccounts`, `listAccompanimentInterns`)
 * y el ciclo completo habilitación → asignación → modificación → retiro, con
 * la revocación cortando la lectura del practicante aunque conserve el enlace.
 * Las reglas de escritura las cubre `internManagement.test.ts`; acá se fija
 * que la Web dispone de los listados para operarlas.
 */

test("profesional lista practicantes y habilita pendientes; otros roles denegados", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedUser(t, {
    subject: "ti170-pro-1",
    email: "ti170-pro-1@uct.cl",
    role: "professional",
  });
  const adm = await seedUser(t, {
    subject: "ti170-adm-1",
    email: "ti170-adm-1@uct.cl",
    role: "admin",
  });
  const pending = await seedUser(t, {
    subject: "ti170-int-1",
    email: "ti170-int-1@alu.uct.cl",
    role: "intern",
    institutionalStatus: "pending",
  });
  await seedUser(t, {
    subject: "ti170-int-2",
    email: "ti170-int-2@alu.uct.cl",
    role: "intern",
  });
  await seedUser(t, {
    subject: "ti170-est-1",
    email: "ti170-est-1@alu.uct.cl",
    role: "student",
  });

  const asPro = t.withIdentity(identityFor("ti170-pro-1", "ti170-pro-1@uct.cl"));
  const asAdm = t.withIdentity(identityFor("ti170-adm-1", "ti170-adm-1@uct.cl"));
  const asStudent = t.withIdentity(identityFor("ti170-est-1", "ti170-est-1@alu.uct.cl"));

  const listed = await asPro.query(api.presentation.accounts.listInternAccounts, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(listed.page.map((item) => item.email).sort()).toEqual([
    "ti170-int-1@alu.uct.cl",
    "ti170-int-2@alu.uct.cl",
  ]);
  for (const item of listed.page) {
    expect(item).not.toHaveProperty("tokenIdentifier");
  }

  const listedAdm = await asAdm.query(api.presentation.accounts.listInternAccounts, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(listedAdm.page).toHaveLength(2);

  await expect(
    asStudent.query(api.presentation.accounts.listInternAccounts, {
      paginationOpts: { numItems: 10, cursor: null },
    }),
  ).rejects.toThrow("No autorizado");

  await asPro.mutation(api.presentation.accounts.enableIntern, { userId: pending.id });
  const relisted = await asPro.query(api.presentation.accounts.listInternAccounts, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(relisted.page.find((item) => item._id === pending.id)?.institutionalStatus).toBe(
    "enabled",
  );

  expect(pro.id).toBeDefined();
  expect(adm.id).toBeDefined();
});

test("acompañamiento expone asignados y asignables; retiro corta la lectura con enlace conservado", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedUser(t, {
    subject: "ti170-pro-2",
    email: "ti170-pro-2@uct.cl",
    role: "professional",
  });
  const otherPro = await seedUser(t, {
    subject: "ti170-pro-3",
    email: "ti170-pro-3@uct.cl",
    role: "professional",
  });
  expect(otherPro.id).toBeDefined();
  const intern = await seedUser(t, {
    subject: "ti170-int-3",
    email: "ti170-int-3@alu.uct.cl",
    role: "intern",
  });
  const otherIntern = await seedUser(t, {
    subject: "ti170-int-4",
    email: "ti170-int-4@alu.uct.cl",
    role: "intern",
  });
  const student = await seedUser(t, {
    subject: "ti170-est-2",
    email: "ti170-est-2@alu.uct.cl",
    role: "student",
  });
  await seedUser(t, {
    subject: "ti170-bootstrap",
    email: "ti170-bootstrap@uct.cl",
    role: "professional",
  });
  const accompanimentId = await seedAccompaniment(t, student.id);

  // Asignación inicial del profesional por la vía interna (arranque).
  await t
    .withIdentity(identityFor("ti170-bootstrap", "bootstrap@uct.cl"))
    .mutation(internal.operations.assignments.assign, {
      accompanimentId,
      userId: pro.id,
      assignedRole: "professional",
    });

  const asPro = t.withIdentity(identityFor("ti170-pro-2", "ti170-pro-2@uct.cl"));
  const asOtherPro = t.withIdentity(identityFor("ti170-pro-3", "ti170-pro-3@uct.cl"));
  const asIntern = t.withIdentity(identityFor("ti170-int-3", "ti170-int-3@alu.uct.cl"));

  // Sin asignación aún: el acompañamiento no trae practicantes.
  const empty = await asPro.query(api.presentation.accompaniments.listAccompanimentInterns, {
    accompanimentId,
  });
  expect(empty.assigned).toEqual([]);
  expect(empty.assignable.map((item) => item.userId).sort()).toEqual(
    [intern.id, otherIntern.id].sort(),
  );
  expect(empty.assignableComplete).toBe(true);

  // Profesional sin alcance no lista.
  await expect(
    asOtherPro.query(api.presentation.accompaniments.listAccompanimentInterns, {
      accompanimentId,
    }),
  ).rejects.toThrow("No autorizado");

  // Asigna con vigencia acordada.
  const validFrom = Date.UTC(2026, 10, 1);
  const validUntil = Date.UTC(2026, 11, 31);
  await asPro.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
    accompanimentId,
    userId: intern.id,
    assignedRole: "intern",
    validFrom,
    validUntil,
  });

  const assigned = await asPro.query(api.presentation.accompaniments.listAccompanimentInterns, {
    accompanimentId,
  });
  expect(assigned.assigned).toHaveLength(1);
  expect(assigned.assigned[0]?.userId).toEqual(intern.id);
  expect(assigned.assigned[0]?.validFrom).toBe(validFrom);
  expect(assigned.assigned[0]?.validUntil).toBe(validUntil);
  expect(assigned.assignable.map((item) => item.userId)).toEqual([otherIntern.id]);

  // El practicante lee su acompañamiento minimizado con el enlace.
  const detail = await asIntern.query(api.presentation.accompaniments.getAccompaniment, {
    accompanimentId,
  });
  expect(detail.view).toBe("minimized");

  // Modifica la vigencia: quita el fin con null.
  await asPro.mutation(api.presentation.accompaniments.updateAccompanimentAccess, {
    accompanimentId,
    userId: intern.id,
    assignedRole: "intern",
    validUntil: null,
  });
  const updated = await asPro.query(api.presentation.accompaniments.listAccompanimentInterns, {
    accompanimentId,
  });
  expect(updated.assigned[0]?.validUntil).toBeUndefined();

  // Retira: el listado del practicante queda vacío y el detalle conservado deniega.
  await asPro.mutation(api.presentation.accompaniments.revokeAccompanimentAccess, {
    accompanimentId,
    userId: intern.id,
    assignedRole: "intern",
  });
  const listAfter = await asIntern.query(
    api.presentation.accompaniments.listAssignedAccompaniments,
    { limit: 10 },
  );
  expect(listAfter.items).toEqual([]);
  await expect(
    asIntern.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
  ).rejects.toThrow("No autorizado");
});
