/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

/**
 * Vínculo entre la solicitud aceptada y el acompañamiento que abrió (TI2-183),
 * comprobado solo por la API pública con datos ficticios: el detalle de la
 * solicitud entrega `accompanimentId` y la vista completa del acompañamiento
 * entrega `requestId` y el `referenceCode` que `searchSlots` entrega sin horario
 * compatible (TI2-144). La vista minimizada del practicante no gana claves y
 * una cuenta ajena sigue sin acceso.
 */

const modules = import.meta.glob("../**/*.ts");

const ISSUER = "https://accounts.google.com";

type TestConvex = ReturnType<typeof convexTest>;
type Role = "student" | "professional" | "intern";

function identityFor(subject: string) {
  return {
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    email: `${subject}@uct.cl`,
    name: "Ficticio",
  };
}

async function seedUser(t: TestConvex, subject: string, role: Role) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: `${subject}@uct.cl`,
      fullName: "Persona Ficticia",
      role,
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|${subject}`,
    });
  });
}

/** Denegación exacta del contrato común de solicitudes (TI2-181). */
function isExactRequestDenial(error: unknown): boolean {
  if (!(error instanceof ConvexError)) return false;
  const data: unknown = error.data;
  return (
    typeof data === "object" &&
    data !== null &&
    Object.keys(data).length === 2 &&
    "code" in data &&
    data.code === "unauthorized" &&
    "message" in data &&
    data.message === "No autorizado"
  );
}

/** El estudiante registra, el profesional toma y acepta: devuelve los ids y las identidades. */
async function acceptOwnRequest(t: TestConvex) {
  const studentId = await seedUser(t, "ti183-est", "student");
  const professionalId = await seedUser(t, "ti183-pro", "professional");
  const asStudent = t.withIdentity(identityFor("ti183-est"));
  const asProfessional = t.withIdentity(identityFor("ti183-pro"));
  const created = await asStudent.mutation(api.presentation.requests.createRequest, {
    accessNeeds: "Necesidad de acceso ficticia",
  });
  const requestId = created._id as Id<"requests">;
  await asProfessional.mutation(api.presentation.requests.takeRequest, { requestId });
  const opened = await asProfessional.mutation(api.presentation.requests.acceptRequest, {
    requestId,
    objective: "Objetivo ficticio",
  });
  return { studentId, professionalId, requestId, opened, asStudent, asProfessional };
}

test("TI2-183: el estudiante dueño y el profesional autorizado reciben el vínculo en ambos sentidos", async () => {
  const t = convexTest(schema, modules);
  const { studentId, requestId, opened, asStudent, asProfessional } = await acceptOwnRequest(t);

  // La aceptación ya devuelve la vista completa con su solicitud de origen.
  expect(opened.requestId).toEqual(requestId);

  for (const caller of [asStudent, asProfessional]) {
    const detail = await caller.query(api.presentation.requests.getRequest, { requestId });
    expect(detail.status).toBe("accepted");
    expect(detail.accompanimentId).toEqual(opened._id);

    const accompaniment = await caller.query(api.presentation.accompaniments.getAccompaniment, {
      accompanimentId: opened._id,
    });
    expect(accompaniment).toEqual({
      _id: opened._id,
      studentId,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "Necesidad de acceso ficticia",
      referenceCode: opened.referenceCode,
      requestId,
      view: "full",
    });
  }
});

test("TI2-183: una solicitud sin aceptar no entrega accompanimentId", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti183-est-pending", "student");
  const asStudent = t.withIdentity(identityFor("ti183-est-pending"));
  const created = await asStudent.mutation(api.presentation.requests.createRequest, {
    accessNeeds: "Necesidad de acceso ficticia",
  });

  const detail = await asStudent.query(api.presentation.requests.getRequest, {
    requestId: created._id as Id<"requests">,
  });
  expect(detail.status).toBe("received");
  expect("accompanimentId" in detail).toBe(false);
});

test("TI2-183: un acompañamiento sin solicitud de origen no entrega requestId", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, "ti183-est-direct", "student");
  const accompanimentId = await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "Necesidad de acceso ficticia",
    });
  });

  const view = await t
    .withIdentity(identityFor("ti183-est-direct"))
    .query(api.presentation.accompaniments.getAccompaniment, { accompanimentId });
  expect(view.view).toBe("full");
  expect("requestId" in view).toBe(false);
});

test("TI2-183: una cuenta ajena sigue sin acceso a la solicitud ni al acompañamiento", async () => {
  const t = convexTest(schema, modules);
  const { requestId, opened } = await acceptOwnRequest(t);
  await seedUser(t, "ti183-est-other", "student");
  await seedUser(t, "ti183-pro-other", "professional");

  for (const subject of ["ti183-est-other", "ti183-pro-other"]) {
    const caller = t.withIdentity(identityFor(subject));
    const requestError = await caller
      .query(api.presentation.requests.getRequest, { requestId })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(isExactRequestDenial(requestError)).toBe(true);

    // `getAccompaniment` conserva el error genérico de Sprint 1: el dato es el mensaje.
    const accompanimentError = await caller
      .query(api.presentation.accompaniments.getAccompaniment, { accompanimentId: opened._id })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(accompanimentError).toBeInstanceOf(ConvexError);
    expect((accompanimentError as ConvexError<string>).data).toBe("No autorizado");
  }
});

test("TI2-183: la vista minimizada del practicante no gana claves nuevas", async () => {
  const t = convexTest(schema, modules);
  const { opened, asProfessional } = await acceptOwnRequest(t);
  const internId = await seedUser(t, "ti183-int", "intern");
  await asProfessional.mutation(api.presentation.accompaniments.assignAccompanimentAccess, {
    accompanimentId: opened._id,
    userId: internId,
    assignedRole: "intern",
  });

  const view = await t
    .withIdentity(identityFor("ti183-int"))
    .query(api.presentation.accompaniments.getAccompaniment, { accompanimentId: opened._id });
  expect(Object.keys(view).sort()).toEqual(["_id", "objective", "status", "view"]);
});

test("TI2-183: el referenceCode del acompañamiento coincide con el de searchSlots sin horario compatible", async () => {
  const t = convexTest(schema, modules);
  const { professionalId, opened, asStudent, asProfessional } = await acceptOwnRequest(t);

  // El profesional no publicó horarios: la búsqueda responde con la coordinación.
  const search = await asStudent.query(api.presentation.availability.searchSlots, {
    accompanimentId: opened._id,
    professionalId,
    from: "2026-11-02",
    to: "2026-11-02",
    limit: 10,
    version: "v1",
  });
  if (search.status !== "no_compatible_slot") throw new Error("Se esperaba no_compatible_slot");

  const viewed = await asProfessional.query(api.presentation.accompaniments.getAccompaniment, {
    accompanimentId: opened._id,
  });
  if (viewed.view !== "full") throw new Error("Se esperaba la vista completa");
  expect(viewed.referenceCode).toBe(search.coordination.referenceCode);
  expect(opened.referenceCode).toBe(search.coordination.referenceCode);
});
