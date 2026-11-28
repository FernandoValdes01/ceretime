/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

/*
 * TI4-84: historial de habilitaciones y revocaciones de cuentas. Antes la
 * fila de `users` guardaba solo los últimos `enabledBy` y `revokedBy`, así
 * que las acciones de un Administrador anterior dejaban de ser consultables.
 * Datos ficticios.
 */

const modules = import.meta.glob("../**/*.ts");

const ISSUER = "https://accounts.google.com";
const PAGE = { numItems: 10, cursor: null };

type Role = "student" | "professional" | "admin" | "intern";

function identityOf(subject: string) {
  return {
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    email: `${subject}@uct.cl`,
    name: "Ficticio",
  };
}

async function seedUser(
  t: TestConvex<typeof schema>,
  subject: string,
  role: Role,
  fields: {
    readonly fullName?: string;
    readonly institutionalStatus?: "enabled" | "pending" | "disabled";
    readonly enabledBy?: Id<"users">;
    readonly enabledAt?: number;
    readonly revokedBy?: Id<"users">;
    readonly revokedAt?: number;
  } = {},
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("users", {
      email: `${subject}@uct.cl`,
      fullName: fields.fullName ?? "Persona Ficticia",
      role,
      institutionalStatus: fields.institutionalStatus ?? "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|${subject}`,
      ...(fields.enabledBy === undefined ? {} : { enabledBy: fields.enabledBy }),
      ...(fields.enabledAt === undefined ? {} : { enabledAt: fields.enabledAt }),
      ...(fields.revokedBy === undefined ? {} : { revokedBy: fields.revokedBy }),
      ...(fields.revokedAt === undefined ? {} : { revokedAt: fields.revokedAt }),
    }),
  );
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConvexError) return error.data as unknown;
    throw error;
  }
  throw new Error("Se esperaba un rechazo y la operación fue permitida");
}

test("TI4-84: dos habilitaciones y dos revocaciones de dos Administradores siguen consultables", async () => {
  const t = convexTest(schema, modules);
  const adminA = await seedUser(t, "hist-adm-a", "admin", { fullName: "Administradora A" });
  const adminB = await seedUser(t, "hist-adm-b", "admin", { fullName: "Administrador B" });
  const pro = await seedUser(t, "hist-pro", "professional", { institutionalStatus: "pending" });
  const asA = t.withIdentity(identityOf("hist-adm-a"));
  const asB = t.withIdentity(identityOf("hist-adm-b"));

  await asA.mutation(api.presentation.accounts.enableAccount, { userId: pro });
  await asA.mutation(api.presentation.accounts.revokeAccount, {
    userId: pro,
    reason: "  Término del convenio ficticio  ",
  });
  await asB.mutation(api.presentation.accounts.enableAccount, { userId: pro });
  await asB.mutation(api.presentation.accounts.revokeAccount, { userId: pro });

  const history = await asA.query(api.presentation.accounts.listAccountEnablements, {
    userId: pro,
    paginationOpts: PAGE,
  });
  expect(history.isDone).toBe(true);
  // Del más reciente al más antiguo, con el nombre de cada actor.
  expect(
    history.page.map((event) => ({
      role: event.role,
      enabledBy: event.enabledBy,
      enabledByName: event.enabledByName,
      revokedBy: event.revokedBy,
      revokedByName: event.revokedByName,
      revocationReason: event.revocationReason,
    })),
  ).toEqual([
    {
      role: "professional",
      enabledBy: adminB,
      enabledByName: "Administrador B",
      revokedBy: adminB,
      revokedByName: "Administrador B",
      revocationReason: undefined,
    },
    {
      role: "professional",
      enabledBy: adminA,
      enabledByName: "Administradora A",
      revokedBy: adminA,
      revokedByName: "Administradora A",
      revocationReason: "Término del convenio ficticio",
    },
  ]);
  for (const event of history.page) {
    expect(event.revokedAt).toBeGreaterThanOrEqual(event.enabledAt);
  }

  // La fila de la cuenta sigue con el último estado, sin cambios de forma.
  expect(await asA.query(api.presentation.accounts.getAccount, { userId: pro })).toMatchObject({
    institutionalStatus: "disabled",
    enabledBy: adminB,
    revokedBy: adminB,
  });
});

test("TI4-84: un motivo de revocación demasiado largo responde account_fields_invalid sin escribir", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "hist-adm-2", "admin");
  const pro = await seedUser(t, "hist-pro-2", "professional", { institutionalStatus: "pending" });
  const asAdmin = t.withIdentity(identityOf("hist-adm-2"));
  await asAdmin.mutation(api.presentation.accounts.enableAccount, { userId: pro });

  const rejected = await rejectionOf(
    asAdmin.mutation(api.presentation.accounts.revokeAccount, {
      userId: pro,
      reason: "x".repeat(501),
    }),
  );
  expect(rejected).toMatchObject({ code: "account_fields_invalid" });
  expect(await asAdmin.query(api.presentation.accounts.getAccount, { userId: pro })).toMatchObject({
    institutionalStatus: "enabled",
  });

  // 500 caracteres es el máximo y se guarda.
  await asAdmin.mutation(api.presentation.accounts.revokeAccount, {
    userId: pro,
    reason: "x".repeat(500),
  });
  const history = await asAdmin.query(api.presentation.accounts.listAccountEnablements, {
    userId: pro,
    paginationOpts: PAGE,
  });
  expect(history.page[0]?.revocationReason).toHaveLength(500);
});

test("TI4-84: la migración siembra el evento de una cuenta anterior al historial sin inventar actor", async () => {
  const t = convexTest(schema, modules);
  const adminId = await seedUser(t, "hist-adm-3", "admin");
  const enabledAt = Date.UTC(2026, 3, 1);
  const revokedAt = Date.UTC(2026, 5, 1);
  const revokedPro = await seedUser(t, "hist-pro-3", "professional", {
    institutionalStatus: "disabled",
    enabledBy: adminId,
    enabledAt,
    revokedBy: adminId,
    revokedAt,
  });
  // Habilitada sin actor, como el arranque o la habilitación automática.
  const bootstrapLike = await seedUser(t, "hist-adm-4", "admin", { enabledAt });
  const pending = await seedUser(t, "hist-pro-4", "professional", {
    institutionalStatus: "pending",
  });
  const asAdmin = t.withIdentity(identityOf("hist-adm-3"));

  const first = await asAdmin.mutation(internal.operations.migrations.seedAccountEnablements, {
    paginationOpts: PAGE,
  });
  expect(first).toMatchObject({ seeded: 2, isDone: true });

  const revokedHistory = await asAdmin.query(api.presentation.accounts.listAccountEnablements, {
    userId: revokedPro,
    paginationOpts: PAGE,
  });
  expect(revokedHistory.page).toEqual([
    expect.objectContaining({ enabledAt, enabledBy: adminId, revokedAt, revokedBy: adminId }),
  ]);
  const bootstrapHistory = await asAdmin.query(api.presentation.accounts.listAccountEnablements, {
    userId: bootstrapLike,
    paginationOpts: PAGE,
  });
  expect(bootstrapHistory.page).toHaveLength(1);
  expect(bootstrapHistory.page[0]).not.toHaveProperty("enabledBy");
  expect(bootstrapHistory.page[0]).not.toHaveProperty("revokedAt");
  const pendingHistory = await asAdmin.query(api.presentation.accounts.listAccountEnablements, {
    userId: pending,
    paginationOpts: PAGE,
  });
  expect(pendingHistory.page).toEqual([]);

  // Idempotente.
  const again = await asAdmin.mutation(internal.operations.migrations.seedAccountEnablements, {
    paginationOpts: PAGE,
  });
  expect(again).toMatchObject({ seeded: 0 });
});

test("TI4-84: quien no es Administrador vigente no lee el historial", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "hist-adm-5", "admin");
  const pro = await seedUser(t, "hist-pro-5", "professional");
  await seedUser(t, "hist-pro-6", "professional");
  await seedUser(t, "hist-est-5", "student");
  await seedUser(t, "hist-adm-6", "admin", { institutionalStatus: "disabled" });
  const student = await seedUser(t, "hist-est-6", "student");

  for (const caller of [
    t.withIdentity(identityOf("hist-pro-6")),
    t.withIdentity(identityOf("hist-est-5")),
    t.withIdentity(identityOf("hist-adm-6")),
    t,
  ]) {
    expect(
      await rejectionOf(
        caller.query(api.presentation.accounts.listAccountEnablements, {
          userId: pro,
          paginationOpts: PAGE,
        }),
      ),
    ).toStrictEqual({ code: "unauthorized", message: "No autorizado" });
  }
  // Una cuenta fuera de esta vía se deniega igual que una inexistente.
  expect(
    await rejectionOf(
      t
        .withIdentity(identityOf("hist-adm-5"))
        .query(api.presentation.accounts.listAccountEnablements, {
          userId: student,
          paginationOpts: PAGE,
        }),
    ),
  ).toStrictEqual({ code: "unauthorized", message: "No autorizado" });
});
