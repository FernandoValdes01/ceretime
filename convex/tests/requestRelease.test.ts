/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

/*
 * TI4-84: la toma de una solicitud se libera. Antes, si un Administrador
 * revocaba la cuenta del Profesional que la tomó, la solicitud quedaba
 * bloqueada: otro Profesional recibía `conflict` al tomarla, la bandeja no la
 * mostraba y solo salía si el Estudiante la cancelaba. Datos ficticios.
 */

const modules = import.meta.glob("../**/*.ts");

const ISSUER = "https://accounts.google.com";
const PAGE = { numItems: 10, cursor: null };
const DENIED = { code: "unauthorized", message: "No autorizado" };

type Role = "student" | "professional" | "admin";

function identityOf(subject: string) {
  return {
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    email: `${subject}@uct.cl`,
    name: "Ficticio",
  };
}

async function seedUser(t: TestConvex<typeof schema>, subject: string, role: Role) {
  return await t.run(async (ctx) =>
    ctx.db.insert("users", {
      email: role === "student" ? `${subject}@alu.uct.cl` : `${subject}@uct.cl`,
      fullName: "Persona Ficticia",
      role,
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|${subject}`,
    }),
  );
}

/** `data` del `ConvexError` con que se rechaza la operación. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConvexError) return error.data as unknown;
    throw error;
  }
  throw new Error("Se esperaba un rechazo y la operación fue permitida");
}

/** Un Estudiante registra una solicitud y el Profesional `pro-a` la toma. */
async function takenRequest(t: TestConvex<typeof schema>, prefix: string) {
  const studentId = await seedUser(t, `${prefix}-est`, "student");
  const proA = await seedUser(t, `${prefix}-pro-a`, "professional");
  const proB = await seedUser(t, `${prefix}-pro-b`, "professional");
  const adminId = await seedUser(t, `${prefix}-adm`, "admin");
  const asStudent = t.withIdentity(identityOf(`${prefix}-est`));
  const asProA = t.withIdentity(identityOf(`${prefix}-pro-a`));
  const asProB = t.withIdentity(identityOf(`${prefix}-pro-b`));
  const asAdmin = t.withIdentity(identityOf(`${prefix}-adm`));
  const created = await asStudent.mutation(api.presentation.requests.createRequest, {
    accessNeeds: "Necesidad de acceso ficticia",
  });
  await asProA.mutation(api.presentation.requests.takeRequest, { requestId: created._id });
  return {
    requestId: created._id,
    studentId,
    proA,
    proB,
    adminId,
    asStudent,
    asProA,
    asProB,
    asAdmin,
  };
}

async function takesOf(t: TestConvex<typeof schema>, requestId: Id<"requests">) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("requestAssignments")
      .withIndex("by_request_and_user_and_status", (q) => q.eq("requestId", requestId))
      .collect(),
  );
}

async function transitionsOf(t: TestConvex<typeof schema>, requestId: Id<"requests">) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("requestTransitions")
      .withIndex("by_request", (q) => q.eq("requestId", requestId))
      .collect(),
  );
}

test("TI4-84: revocar la cuenta del Profesional libera su toma y otro Profesional la toma y acepta", async () => {
  const t = convexTest(schema, modules);
  const s = await takenRequest(t, "rel-1");

  // Antes de revocar, otro Profesional no puede tomarla ni leerla.
  expect(
    await rejectionOf(
      s.asProB.mutation(api.presentation.requests.takeRequest, { requestId: s.requestId }),
    ),
  ).toMatchObject({ code: "conflict" });
  expect(
    await rejectionOf(
      s.asProB.query(api.presentation.requests.getRequest, { requestId: s.requestId }),
    ),
  ).toStrictEqual(DENIED);

  await s.asAdmin.mutation(api.presentation.accounts.revokeAccount, { userId: s.proA });

  const open = await s.asProB.query(api.presentation.requests.listOpenRequests, {
    paginationOpts: PAGE,
  });
  expect(open.page.map((item) => item._id)).toEqual([s.requestId]);
  const [take] = await takesOf(t, s.requestId);
  expect(take).toMatchObject({ userId: s.proA, status: "revoked", revokedBy: s.adminId });
  expect(take.revokedAt).toEqual(expect.any(Number));
  const row = await t.run(async (ctx) => ctx.db.get(s.requestId));
  expect(row).not.toHaveProperty("takenBy");
  expect(
    (await transitionsOf(t, s.requestId)).map((row) => [row.from, row.to, row.actorId]),
  ).toEqual([
    ["received", "under_review", s.proA],
    ["under_review", "received", s.adminId],
  ]);

  await s.asProB.mutation(api.presentation.requests.takeRequest, { requestId: s.requestId });
  const accompaniment = await s.asProB.mutation(api.presentation.requests.acceptRequest, {
    requestId: s.requestId,
    objective: "Objetivo ficticio del acompañamiento",
  });
  expect(accompaniment.studentId).toBe(s.studentId);
});

test("TI4-84: el Profesional libera su propia toma y la solicitud vuelve a la bandeja", async () => {
  const t = convexTest(schema, modules);
  const s = await takenRequest(t, "rel-2");

  const released = await s.asProA.mutation(api.presentation.requests.releaseRequest, {
    requestId: s.requestId,
  });
  expect(released).toMatchObject({ _id: s.requestId, status: "received" });

  const [take] = await takesOf(t, s.requestId);
  expect(take).toMatchObject({ status: "revoked", revokedBy: s.proA });
  const open = await s.asProB.query(api.presentation.requests.listOpenRequests, {
    paginationOpts: PAGE,
  });
  expect(open.page.map((item) => item._id)).toEqual([s.requestId]);

  // Quien la liberó deja de leerla y de verla en sus tomadas.
  expect(
    await rejectionOf(
      s.asProA.query(api.presentation.requests.getRequest, { requestId: s.requestId }),
    ),
  ).toStrictEqual(DENIED);
  const mine = await s.asProA.query(api.presentation.requests.listAuthorizedRequests, {
    paginationOpts: PAGE,
  });
  expect(mine.page).toEqual([]);
});

test("TI4-84: liberar desde la espera deja de esperar la respuesta del Estudiante", async () => {
  const t = convexTest(schema, modules);
  const s = await takenRequest(t, "rel-3");
  await s.asProA.mutation(api.presentation.requests.requestAdditionalInformation, {
    requestId: s.requestId,
    reason: "Falta el horario ficticio",
  });

  await s.asProA.mutation(api.presentation.requests.releaseRequest, { requestId: s.requestId });

  expect(
    await rejectionOf(
      s.asStudent.mutation(api.presentation.requests.respondToInformationRequest, {
        requestId: s.requestId,
        response: "Respuesta ficticia",
      }),
    ),
  ).toMatchObject({ code: "conflict" });
  const own = await s.asStudent.query(api.presentation.requests.getRequest, {
    requestId: s.requestId,
  });
  expect(own.status).toBe("received");
  expect(own).not.toHaveProperty("informationRequest");
});

test("TI4-84: liberar desde un estado que no lo admite responde conflict sin escribir", async () => {
  const t = convexTest(schema, modules);
  const s = await takenRequest(t, "rel-4");
  await s.asProA.mutation(api.presentation.requests.acceptRequest, {
    requestId: s.requestId,
    objective: "Objetivo ficticio del acompañamiento",
  });
  const before = await transitionsOf(t, s.requestId);

  expect(
    await rejectionOf(
      s.asProA.mutation(api.presentation.requests.releaseRequest, { requestId: s.requestId }),
    ),
  ).toMatchObject({ code: "conflict" });
  expect(await transitionsOf(t, s.requestId)).toEqual(before);
  expect((await takesOf(t, s.requestId)).map((take) => take.status)).toEqual(["finished"]);
});

test("TI4-84: liberar una toma ajena, sin identidad o una solicitud inexistente responde unauthorized", async () => {
  const t = convexTest(schema, modules);
  const s = await takenRequest(t, "rel-5");
  const missing = await t.run(async (ctx) => {
    const id = await ctx.db.insert("requests", {
      studentId: s.studentId,
      status: "received",
      accessNeeds: "Temporal ficticia",
      createdAt: 1,
    });
    await ctx.db.delete(id);
    return id;
  });

  for (const attempt of [
    s.asProB.mutation(api.presentation.requests.releaseRequest, { requestId: s.requestId }),
    s.asStudent.mutation(api.presentation.requests.releaseRequest, { requestId: s.requestId }),
    s.asAdmin.mutation(api.presentation.requests.releaseRequest, { requestId: s.requestId }),
    t.mutation(api.presentation.requests.releaseRequest, { requestId: s.requestId }),
    s.asProA.mutation(api.presentation.requests.releaseRequest, { requestId: missing }),
  ]) {
    expect(await rejectionOf(attempt)).toStrictEqual(DENIED);
  }
  expect((await takesOf(t, s.requestId)).map((take) => take.status)).toEqual(["active"]);
});

test("TI4-84: las tomas de una solicitud terminada quedan finished y su Profesional la sigue leyendo", async () => {
  const t = convexTest(schema, modules);
  const s = await takenRequest(t, "rel-6");
  await s.asProA.mutation(api.presentation.requests.referRequest, {
    requestId: s.requestId,
    destinationUnit: "Unidad ficticia",
    reason: "Razón ficticia de la derivación",
  });

  const [take] = await takesOf(t, s.requestId);
  expect(take).toMatchObject({ status: "finished", finishedAt: expect.any(Number) });
  expect(
    await s.asProA.query(api.presentation.requests.getRequest, { requestId: s.requestId }),
  ).toMatchObject({ status: "referred" });
  const mine = await s.asProA.query(api.presentation.requests.listAuthorizedRequests, {
    paginationOpts: PAGE,
  });
  expect(mine.page.map((item) => [item._id, item.status])).toEqual([[s.requestId, "referred"]]);

  // Revocar después la cuenta no toca la toma terminada ni la solicitud.
  await s.asAdmin.mutation(api.presentation.accounts.revokeAccount, { userId: s.proA });
  expect((await takesOf(t, s.requestId)).map((row) => row.status)).toEqual(["finished"]);
});
