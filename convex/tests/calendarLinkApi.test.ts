/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
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
    readonly subject: string;
    readonly role: Doc<"users">["role"];
    readonly institutionalStatus?: Doc<"users">["institutionalStatus"];
  },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: `${input.subject}@uct.cl`,
      fullName: "Ficticio",
      role: input.role,
      institutionalStatus: input.institutionalStatus ?? "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|${input.subject}`,
    });
  });
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

test("TI2-161 API: el estado del vínculo exige sesión con perfil vigente", async () => {
  expect.hasAssertions();
  const t = convexTest(schema, modules);
  const subject = "ti161-link-anon";
  await seedUser(t, { subject, role: "student" });

  expect(
    await publicErrorData(t.query(api.presentation.calendar.getCalendarLinkStatus, {})),
  ).toEqual({
    code: "unauthorized",
    message: "No autorizado",
  });
  expect(
    await publicErrorData(
      t
        .withIdentity(identityFor("ti161-link-missing", "ti161-link-missing@uct.cl"))
        .query(api.presentation.calendar.getCalendarLinkStatus, {}),
    ),
  ).toEqual({ code: "unauthorized", message: "No autorizado" });

  const disabled = "ti161-link-disabled";
  await seedUser(t, { subject: disabled, role: "student", institutionalStatus: "disabled" });
  expect(
    await publicErrorData(
      t
        .withIdentity(identityFor(disabled, `${disabled}@uct.cl`))
        .query(api.presentation.calendar.getCalendarLinkStatus, {}),
    ),
  ).toEqual({ code: "unauthorized", message: "No autorizado" });
});

test("TI2-161 API: sin cuenta Google responde desconectado sin credenciales", async () => {
  const t = convexTest(schema, modules);
  const subject = "ti161-link-off";
  await seedUser(t, { subject, role: "student" });
  const status = await t
    .withIdentity(identityFor(subject, `${subject}@uct.cl`))
    .query(api.presentation.calendar.getCalendarLinkStatus, {});
  expect(status).toEqual({ connected: false, staleEventsMayRemain: false });
  expect(JSON.stringify(status).toLowerCase()).not.toMatch(
    /token|secret|refresh|scope|account|correo/,
  );
});

test("TI2-161 API: rechazar la autorización responde desconectado y no impide reservar", async () => {
  const t = convexTest(schema, modules);
  const subject = "ti161-link-reject";
  await seedUser(t, { subject, role: "student" });
  const asStudent = t.withIdentity(identityFor(subject, `${subject}@uct.cl`));

  const confirmed = await asStudent.mutation(api.presentation.calendar.confirmCalendarLink, {});
  expect(confirmed).toEqual({ connected: false, status: "not_connected" });

  const status = await asStudent.query(api.presentation.calendar.getCalendarLinkStatus, {});
  expect(status.connected).toBe(false);
});

test("TI2-161 API: desconectar es propio, idempotente y avisa eventos previos", async () => {
  const t = convexTest(schema, modules);
  const own = "ti161-link-own";
  const other = "ti161-link-other";
  const ownId = await seedUser(t, { subject: own, role: "student" });
  await seedUser(t, { subject: other, role: "professional" });
  const asOwn = t.withIdentity(identityFor(own, `${own}@uct.cl`));
  const asOther = t.withIdentity(identityFor(other, `${other}@uct.cl`));

  const linkedAt = 1_700_000_000_000;
  await t.run(async (ctx) => {
    await ctx.db.insert("calendarConnections", {
      userId: ownId,
      accountReference: "referencia-opaca-ficticia",
      linkedAt,
      updatedAt: linkedAt,
    });
  });

  const statusBefore = await asOwn.query(api.presentation.calendar.getCalendarLinkStatus, {});
  expect(statusBefore).toEqual({ connected: false, linkedAt, staleEventsMayRemain: false });

  const unlinked = await asOwn.mutation(api.presentation.calendar.disconnectCalendarLink, {});
  expect(unlinked.status).toBe("unlinked");
  if (unlinked.status !== "unlinked") return;
  expect(unlinked.disconnected).toBe(true);
  expect(unlinked.staleEventsMayRemain).toBe(true);
  expect(typeof unlinked.revokedAt).toBe("number");

  const statusAfter = await asOwn.query(api.presentation.calendar.getCalendarLinkStatus, {});
  expect(statusAfter).toEqual({
    connected: false,
    linkedAt,
    revokedAt: unlinked.revokedAt,
    staleEventsMayRemain: true,
  });

  const retry = await asOwn.mutation(api.presentation.calendar.disconnectCalendarLink, {});
  expect(retry.status).toBe("already_unlinked");

  const otherOut = await asOther.mutation(api.presentation.calendar.disconnectCalendarLink, {});
  expect(otherOut.status).toBe("not_found");

  const rows = await t.run(async (ctx) => await ctx.db.query("calendarConnections").take(10));
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toMatch(/token|secret|refresh/i);
  expect(JSON.stringify(unlinked).toLowerCase()).not.toMatch(/token|secret|refresh|account/);
});

test("TI2-161 API: confirmar y desconectar exigen sesión", async () => {
  expect.hasAssertions();
  const t = convexTest(schema, modules);
  expect(
    await publicErrorData(t.mutation(api.presentation.calendar.confirmCalendarLink, {})),
  ).toEqual({
    code: "unauthorized",
    message: "No autorizado",
  });
  expect(
    await publicErrorData(t.mutation(api.presentation.calendar.disconnectCalendarLink, {})),
  ).toEqual({
    code: "unauthorized",
    message: "No autorizado",
  });
});
