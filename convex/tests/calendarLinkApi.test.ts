/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { v } from "convex/values";
import { expect, test } from "vitest";
import { defineSchema, defineTable, type FunctionReference } from "convex/server";
import { api, components } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import schema from "../schema";
import { CALENDAR_EVENTS_SCOPE } from "../domain/calendar/calendar_event";

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

/**
 * Doble en memoria del componente `betterAuth` (TI2-161).
 *
 * convex-test exige registrar los componentes que toca el código. El doble
 * implementa solo la cuenta OAuth con la misma forma de argumentos que el
 * adaptador real (`findOne({model, where})`, `deleteOne({input})`) y una
 * siembra de prueba. Vive en este archivo: no se despliega ni se genera.
 */

type StubAccount = {
  readonly accountId: string;
  readonly providerId: string;
  readonly userId: string;
  readonly scope?: string;
};

const betterAuthStubSchema = defineSchema({
  account: defineTable({
    accountId: v.string(),
    providerId: v.string(),
    userId: v.string(),
    scope: v.optional(v.string()),
  }),
});

function stubAccountModules(rows: Map<string, StubAccount>) {
  function matches(row: StubAccount, where: unknown): boolean {
    if (!Array.isArray(where)) return true;
    return where.every((clause: unknown) => {
      if (typeof clause !== "object" || clause === null) return false;
      const { field, value } = clause as { readonly field: string; readonly value: unknown };
      return (row as unknown as Record<string, unknown>)[field] === value;
    });
  }
  return {
    "./stubs/betterAuth/_generated/placeholder.ts": () => Promise.resolve({}),
    "./stubs/betterAuth/adapter.ts": () =>
      Promise.resolve({
        findOne: query({
          args: { model: v.string(), where: v.optional(v.any()), select: v.optional(v.any()) },
          returns: v.any(),
          handler: async (_ctx, args) => {
            if (args.model !== "account") return null;
            for (const row of rows.values()) {
              if (matches(row, args.where)) return { ...row };
            }
            return null;
          },
        }),
        deleteOne: mutation({
          args: {
            input: v.object({ model: v.string(), where: v.optional(v.any()) }),
            onDeleteHandle: v.optional(v.string()),
          },
          returns: v.any(),
          handler: async (_ctx, args) => {
            if (args.input.model !== "account") return undefined;
            for (const [key, row] of rows) {
              if (matches(row, args.input.where)) {
                rows.delete(key);
                return { ...row };
              }
            }
            return undefined;
          },
        }),
        seedAccount: mutation({
          args: {
            accountId: v.string(),
            providerId: v.string(),
            userId: v.string(),
            scope: v.optional(v.string()),
          },
          returns: v.null(),
          handler: async (_ctx, args) => {
            rows.set(`${args.providerId}|${args.userId}`, { ...args });
            return null;
          },
        }),
      }),
  };
}

function registerBetterAuthStub(t: ReturnType<typeof convexTest>) {
  t.registerComponent(
    "betterAuth",
    betterAuthStubSchema,
    stubAccountModules(new Map<string, StubAccount>()),
  );
}

async function seedGoogleAccount(
  t: ReturnType<typeof convexTest>,
  input: {
    readonly subject: string;
    readonly scopes: readonly string[];
    readonly providerId?: string;
  },
) {
  // Referencia al `seedAccount` del doble en memoria (TI2-161): el tipo
  // generado no incluye componentes, así que se declara la forma mínima.
  const seedAccount = (
    components as unknown as {
      readonly betterAuth: {
        readonly adapter: {
          readonly seedAccount: FunctionReference<
            "mutation",
            "internal",
            {
              readonly accountId: string;
              readonly providerId: string;
              readonly userId: string;
              readonly scope?: string;
            },
            null
          >;
        };
      };
    }
  ).betterAuth.adapter.seedAccount;
  await t.mutation(seedAccount, {
    accountId: `google-${input.subject}`,
    providerId: input.providerId ?? "google",
    userId: input.subject,
    scope: input.scopes.join(","),
  });
}

test("TI2-161 API: el estado del vínculo exige sesión con perfil vigente", async () => {
  expect.hasAssertions();
  const t = convexTest(schema, modules);
  registerBetterAuthStub(t);
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
  registerBetterAuthStub(t);
  const subject = "ti161-link-off";
  await seedUser(t, { subject, role: "student" });
  const status = await t
    .withIdentity(identityFor(subject, `${subject}@uct.cl`))
    .query(api.presentation.calendar.getCalendarLinkStatus, {});
  expect(status).toEqual({ connected: false, staleEventsMayRemain: false });
  expect(JSON.stringify(status).toLowerCase()).not.toMatch(/token|secret|refresh|account|correo/);
});

test("TI2-161 API: el alcance mínimo conecta a través del adaptador real", async () => {
  const t = convexTest(schema, modules);
  registerBetterAuthStub(t);
  const subject = "ti161-link-scopes";
  await seedUser(t, { subject, role: "student" });
  await seedGoogleAccount(t, { subject, scopes: ["openid", CALENDAR_EVENTS_SCOPE] });
  const status = await t
    .withIdentity(identityFor(subject, `${subject}@uct.cl`))
    .query(api.presentation.calendar.getCalendarLinkStatus, {});
  expect(status).toEqual({ connected: true, staleEventsMayRemain: false });
  expect(JSON.stringify(status).toLowerCase()).not.toMatch(
    /token|secret|refresh|scope|account|correo/,
  );
});

test("TI2-161 API: rechazar la autorización responde desconectado y no impide reservar", async () => {
  const t = convexTest(schema, modules);
  registerBetterAuthStub(t);
  const subject = "ti161-link-reject";
  await seedUser(t, { subject, role: "student" });
  const asStudent = t.withIdentity(identityFor(subject, `${subject}@uct.cl`));

  const confirmed = await asStudent.mutation(api.presentation.calendar.confirmCalendarLink, {});
  expect(confirmed).toEqual({ connected: false, status: "not_connected" });

  const status = await asStudent.query(api.presentation.calendar.getCalendarLinkStatus, {});
  expect(status.connected).toBe(false);
});

test("TI2-161 API: desconectar revoca el acceso y avisa eventos previos", async () => {
  const t = convexTest(schema, modules);
  registerBetterAuthStub(t);
  const subject = "ti161-link-cycle";
  await seedUser(t, { subject, role: "student" });
  await seedGoogleAccount(t, { subject, scopes: ["openid", CALENDAR_EVENTS_SCOPE] });
  const asStudent = t.withIdentity(identityFor(subject, `${subject}@uct.cl`));

  const confirmed = await asStudent.mutation(api.presentation.calendar.confirmCalendarLink, {});
  expect(confirmed.status).toBe("linked");

  const unlinked = await asStudent.mutation(api.presentation.calendar.disconnectCalendarLink, {});
  expect(unlinked.status).toBe("unlinked");
  if (unlinked.status !== "unlinked") return;
  expect(unlinked.disconnected).toBe(true);
  expect(unlinked.staleEventsMayRemain).toBe(true);
  expect(typeof unlinked.revokedAt).toBe("number");

  const status = await asStudent.query(api.presentation.calendar.getCalendarLinkStatus, {});
  expect(status.connected).toBe(false);
  expect(status.staleEventsMayRemain).toBe(true);

  const retry = await asStudent.mutation(api.presentation.calendar.disconnectCalendarLink, {});
  expect(retry.status).toBe("already_unlinked");
  expect(JSON.stringify(unlinked).toLowerCase()).not.toMatch(/token|secret|refresh|account/);
});

test("TI2-161 API: desconectar no toca la cuenta institucional ni la de otra persona", async () => {
  const t = convexTest(schema, modules);
  registerBetterAuthStub(t);
  const own = "ti161-link-own";
  const other = "ti161-link-other";
  await seedUser(t, { subject: own, role: "student" });
  await seedUser(t, { subject: other, role: "professional" });
  await seedGoogleAccount(t, { subject: own, scopes: [CALENDAR_EVENTS_SCOPE] });
  await seedGoogleAccount(t, { subject: other, scopes: [CALENDAR_EVENTS_SCOPE] });
  await seedGoogleAccount(t, { subject: own, scopes: [], providerId: "google-alu" });

  const result = await t
    .withIdentity(identityFor(own, `${own}@uct.cl`))
    .mutation(api.presentation.calendar.disconnectCalendarLink, {});
  expect(result.status).toBe("unlinked");

  const otherStatus = await t
    .withIdentity(identityFor(other, `${other}@uct.cl`))
    .query(api.presentation.calendar.getCalendarLinkStatus, {});
  expect(otherStatus.connected).toBe(true);
});

test("TI2-161 API: confirmar y desconectar exigen sesión", async () => {
  expect.hasAssertions();
  const t = convexTest(schema, modules);
  registerBetterAuthStub(t);
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
