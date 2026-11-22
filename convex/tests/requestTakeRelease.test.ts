/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

/**
 * Liberación de la toma de una solicitud (revisión TI4-84, hallazgo 1).
 *
 * Reproduce el bloqueo del informe: un Profesional toma una solicitud y deja
 * de operar. Con la liberación propia o con la revocación de su cuenta, la
 * solicitud vuelve a la bandeja y otro Profesional la continúa, sin ver su
 * contenido antes de tomarla. Opera con datos ficticios.
 */

const modules = import.meta.glob("../**/*.ts");
const ISSUER = "https://accounts.google.com";
const PAGE = { numItems: 10, cursor: null };
const UNAUTHORIZED = { code: "unauthorized", message: "No autorizado" };

type T = ReturnType<typeof convexTest>;

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
  t: T,
  subject: string,
  role: "student" | "professional" | "admin",
): Promise<Id<"users">> {
  const domain = role === "student" ? "alu.uct.cl" : "uct.cl";
  return await t.run(async (ctx) =>
    ctx.db.insert("users", {
      email: `${subject}@${domain}`,
      fullName: `Persona ficticia ${subject}`,
      role,
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|${subject}`,
    }),
  );
}

function as(t: T, subject: string, role: "student" | "professional" | "admin") {
  const domain = role === "student" ? "alu.uct.cl" : "uct.cl";
  return t.withIdentity(identityFor(subject, `${subject}@${domain}`));
}

async function publicErrorData(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(
    () => {
      throw new Error("Se esperaba un error público");
    },
    (error: unknown) => {
      if (error instanceof ConvexError) return error.data;
      throw error;
    },
  );
}

/** Estudiante, dos Profesionales y un Administrador, con una solicitud tomada por el primero. */
async function seedTakenRequest(t: T) {
  await seedUser(t, "rel-est", "student");
  const firstId = await seedUser(t, "rel-pro-1", "professional");
  await seedUser(t, "rel-pro-2", "professional");
  const adminId = await seedUser(t, "rel-adm", "admin");
  const created = await as(t, "rel-est", "student").mutation(
    api.presentation.requests.createRequest,
    { accessNeeds: "Necesidad de acceso ficticia" },
  );
  const requestId = created._id;
  await as(t, "rel-pro-1", "professional").mutation(api.presentation.requests.takeRequest, {
    requestId,
  });
  return { requestId, firstId, adminId };
}

async function inboxIds(t: T, subject: string): Promise<Id<"requests">[]> {
  const page = await as(t, subject, "professional").query(
    api.presentation.requests.listOpenRequests,
    { paginationOpts: PAGE },
  );
  return page.page.map((row) => row._id);
}

describe("bloqueo del informe", () => {
  test("sin liberar, otro Profesional no puede tomar, leer ni ver la solicitud tomada", async () => {
    const t = convexTest(schema, modules);
    const { requestId } = await seedTakenRequest(t);
    const second = as(t, "rel-pro-2", "professional");

    expect(
      await publicErrorData(second.mutation(api.presentation.requests.takeRequest, { requestId })),
    ).toMatchObject({ code: "conflict" });
    expect(
      await publicErrorData(second.query(api.presentation.requests.getRequest, { requestId })),
    ).toEqual(UNAUTHORIZED);
    expect(await inboxIds(t, "rel-pro-2")).toEqual([]);
  });
});

describe("el Profesional libera su toma", () => {
  test("la solicitud vuelve a la bandeja y otro Profesional la continúa", async () => {
    const t = convexTest(schema, modules);
    const { requestId, firstId } = await seedTakenRequest(t);
    const first = as(t, "rel-pro-1", "professional");
    const second = as(t, "rel-pro-2", "professional");

    const released = await first.mutation(api.presentation.requests.releaseRequest, {
      requestId,
    });
    expect(released.status).toBe("received");
    expect(await inboxIds(t, "rel-pro-2")).toEqual([requestId]);

    // Antes de tomarla, el segundo Profesional sigue sin leer el contenido.
    expect(
      await publicErrorData(second.query(api.presentation.requests.getRequest, { requestId })),
    ).toEqual(UNAUTHORIZED);

    await second.mutation(api.presentation.requests.takeRequest, { requestId });
    const detail = await second.query(api.presentation.requests.getRequest, { requestId });
    expect(detail.status).toBe("under_review");

    // Quien liberó ya no la lee ni la opera.
    expect(
      await publicErrorData(first.query(api.presentation.requests.getRequest, { requestId })),
    ).toEqual(UNAUTHORIZED);

    const trace = await t.run(async (ctx) => {
      const takes = await ctx.db
        .query("requestAssignments")
        .withIndex("by_request_and_user_and_status", (q) =>
          q.eq("requestId", requestId).eq("userId", firstId),
        )
        .collect();
      const transitions = await ctx.db
        .query("requestTransitions")
        .withIndex("by_request", (q) => q.eq("requestId", requestId))
        .collect();
      return { takes, transitions };
    });
    expect(trace.takes).toHaveLength(1);
    expect(trace.takes[0]).toMatchObject({ status: "revoked", revokedBy: firstId });
    expect(typeof trace.takes[0]?.revokedAt).toBe("number");
    const release = trace.transitions.find((row) => row.to === "received");
    expect(release).toMatchObject({ from: "under_review", to: "received", actorId: firstId });
    expect(release?.reason).toBeUndefined();
  });

  test("libera también desde la espera de información", async () => {
    const t = convexTest(schema, modules);
    const { requestId } = await seedTakenRequest(t);
    const first = as(t, "rel-pro-1", "professional");
    await first.mutation(api.presentation.requests.requestAdditionalInformation, {
      requestId,
      reason: "Indica el horario que te acomoda",
    });

    const released = await first.mutation(api.presentation.requests.releaseRequest, {
      requestId,
    });
    expect(released.status).toBe("received");
    expect(await inboxIds(t, "rel-pro-2")).toEqual([requestId]);
  });

  test("sin toma, sin identidad o con otro rol responde unauthorized sin escribir", async () => {
    const t = convexTest(schema, modules);
    const { requestId } = await seedTakenRequest(t);

    const release = (caller: Pick<T, "mutation">) =>
      publicErrorData(caller.mutation(api.presentation.requests.releaseRequest, { requestId }));
    expect(await release(as(t, "rel-pro-2", "professional"))).toEqual(UNAUTHORIZED);
    expect(await release(as(t, "rel-est", "student"))).toEqual(UNAUTHORIZED);
    expect(await release(as(t, "rel-adm", "admin"))).toEqual(UNAUTHORIZED);
    expect(await release(t)).toEqual(UNAUTHORIZED);
    const status = await t.run(async (ctx) => (await ctx.db.get(requestId))?.status);
    expect(status).toBe("under_review");
  });

  test("una solicitud aceptada no se libera y queda igual", async () => {
    const t = convexTest(schema, modules);
    const { requestId } = await seedTakenRequest(t);
    const first = as(t, "rel-pro-1", "professional");
    await first.mutation(api.presentation.requests.acceptRequest, {
      requestId,
      objective: "Objetivo ficticio",
    });

    expect(
      await publicErrorData(
        first.mutation(api.presentation.requests.releaseRequest, { requestId }),
      ),
    ).toEqual({
      code: "conflict",
      message: "La solicitud no admite liberar la toma en su estado actual.",
    });
    const status = await t.run(async (ctx) => (await ctx.db.get(requestId))?.status);
    expect(status).toBe("accepted");
  });
});

describe("revocar la cuenta del Profesional libera sus tomas", () => {
  test("la solicitud tomada vuelve a la bandeja con el Administrador como actor", async () => {
    const t = convexTest(schema, modules);
    const { requestId, firstId, adminId } = await seedTakenRequest(t);

    await as(t, "rel-adm", "admin").mutation(api.presentation.accounts.revokeAccount, {
      userId: firstId,
      reason: "Termina su contrato ficticio",
    });

    expect(await inboxIds(t, "rel-pro-2")).toEqual([requestId]);
    const second = as(t, "rel-pro-2", "professional");
    await second.mutation(api.presentation.requests.takeRequest, { requestId });
    expect((await second.query(api.presentation.requests.getRequest, { requestId })).status).toBe(
      "under_review",
    );

    const trace = await t.run(async (ctx) => {
      const take = await ctx.db
        .query("requestAssignments")
        .withIndex("by_request_and_user_and_status", (q) =>
          q.eq("requestId", requestId).eq("userId", firstId),
        )
        .first();
      const transitions = await ctx.db
        .query("requestTransitions")
        .withIndex("by_request", (q) => q.eq("requestId", requestId))
        .collect();
      return { take, transitions };
    });
    expect(trace.take).toMatchObject({ status: "revoked", revokedBy: adminId });
    expect(trace.transitions.find((row) => row.to === "received")).toMatchObject({
      from: "under_review",
      actorId: adminId,
    });
  });

  test("las tomas de solicitudes terminadas quedan como rastro", async () => {
    const t = convexTest(schema, modules);
    const { requestId, firstId } = await seedTakenRequest(t);
    await as(t, "rel-pro-1", "professional").mutation(api.presentation.requests.acceptRequest, {
      requestId,
      objective: "Objetivo ficticio",
    });

    await as(t, "rel-adm", "admin").mutation(api.presentation.accounts.revokeAccount, {
      userId: firstId,
    });

    const after = await t.run(async (ctx) => {
      const request = await ctx.db.get(requestId);
      const take = await ctx.db
        .query("requestAssignments")
        .withIndex("by_request_and_user_and_status", (q) =>
          q.eq("requestId", requestId).eq("userId", firstId),
        )
        .first();
      return { status: request?.status, takeStatus: take?.status };
    });
    expect(after).toEqual({ status: "accepted", takeStatus: "active" });
  });
});
