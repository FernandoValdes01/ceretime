/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

/*
 * TI4-84: `listOwnedAccompaniments` filtra por estado antes de paginar. Sin
 * el filtro, Horarios leía solo los primeros 50 acompañamientos del
 * Estudiante y podía concluir que no tenía ninguno activo. Datos ficticios.
 */

const modules = import.meta.glob("../**/*.ts");

const ISSUER = "https://accounts.google.com";
const SUBJECT = "own-status-est";

test("TI4-84: con más de 50 cerrados y uno activo, el filtro entrega el activo en la primera página", async () => {
  const t = convexTest(schema, modules);
  const activeId = await t.run(async (ctx) => {
    const studentId = await ctx.db.insert("users", {
      email: `${SUBJECT}@alu.uct.cl`,
      fullName: "Estudiante Ficticio",
      role: "student",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|${SUBJECT}`,
    });
    for (let index = 0; index < 55; index++) {
      await ctx.db.insert("accompaniments", {
        studentId,
        status: "closed",
        objective: `Objetivo ficticio cerrado ${index}`,
        accessNeeds: "Necesidad ficticia",
      });
    }
    return await ctx.db.insert("accompaniments", {
      studentId,
      status: "active",
      objective: "Objetivo ficticio activo",
      accessNeeds: "Necesidad ficticia",
    });
  });
  const asStudent = t.withIdentity({
    subject: SUBJECT,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${SUBJECT}`,
    email: `${SUBJECT}@alu.uct.cl`,
    name: "Ficticio",
  });

  const active = await asStudent.query(api.presentation.accompaniments.listOwnedAccompaniments, {
    paginationOpts: { numItems: 50, cursor: null },
    status: "active",
  });
  expect(active.page.map((item) => item._id)).toEqual([activeId]);
  expect(active.isDone).toBe(true);

  // Sin `status` no cambia: la primera página son 50 del total, sin filtrar.
  const all = await asStudent.query(api.presentation.accompaniments.listOwnedAccompaniments, {
    paginationOpts: { numItems: 50, cursor: null },
  });
  expect(all.page).toHaveLength(50);
  expect(all.isDone).toBe(false);
  expect(all.page.map((item) => item._id)).not.toContain(activeId);
});
