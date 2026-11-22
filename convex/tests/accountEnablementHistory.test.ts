/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

/**
 * Historial de habilitaciones y revocaciones de cuentas (revisión TI4-84,
 * hallazgo 2; HABILITACIONES_CUENTA del MER).
 *
 * Reproduce el caso del informe: un Administrador habilita y revoca una
 * cuenta profesional, otro la habilita y la revoca de nuevo. Antes, `users`
 * solo guardaba el último actor y el primer ciclo se perdía. Opera con datos
 * ficticios.
 */

const modules = import.meta.glob("../**/*.ts");
const ISSUER = "https://accounts.google.com";
const PAGE = { numItems: 10, cursor: null };
const UNAUTHORIZED = { code: "unauthorized", message: "No autorizado" };
const ALLOWED_EVENT_KEYS = [
  "_id",
  "enabledRole",
  "enabledBy",
  "enabledAt",
  "revokedBy",
  "revokedAt",
  "revocationReason",
];

type T = ReturnType<typeof convexTest>;

function as(t: T, subject: string, email: string) {
  return t.withIdentity({
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    email,
    name: "Ficticio",
  });
}

async function seedUser(
  t: T,
  input: {
    readonly subject: string;
    readonly email: string;
    readonly role: "student" | "professional" | "intern" | "admin";
    readonly institutionalStatus?: "enabled" | "disabled" | "pending";
    readonly enabledBy?: Id<"users">;
    readonly enabledAt?: number;
  },
): Promise<Id<"users">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("users", {
      email: input.email,
      fullName: `Persona ficticia ${input.subject}`,
      role: input.role,
      institutionalStatus: input.institutionalStatus ?? "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|${input.subject}`,
      ...(input.enabledBy === undefined ? {} : { enabledBy: input.enabledBy }),
      ...(input.enabledAt === undefined ? {} : { enabledAt: input.enabledAt }),
    }),
  );
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

async function seedTwoAdminsAndProfessional(t: T) {
  const firstAdmin = await seedUser(t, {
    subject: "hab-adm-1",
    email: "hab-adm-1@uct.cl",
    role: "admin",
  });
  const secondAdmin = await seedUser(t, {
    subject: "hab-adm-2",
    email: "hab-adm-2@uct.cl",
    role: "admin",
  });
  const professional = await seedUser(t, {
    subject: "hab-pro",
    email: "hab-pro@uct.cl",
    role: "professional",
    institutionalStatus: "pending",
  });
  return {
    firstAdmin,
    secondAdmin,
    professional,
    asFirst: as(t, "hab-adm-1", "hab-adm-1@uct.cl"),
    asSecond: as(t, "hab-adm-2", "hab-adm-2@uct.cl"),
  };
}

test("dos ciclos de habilitación y revocación conservan actor, fecha y motivo de cada uno", async () => {
  const t = convexTest(schema, modules);
  const { firstAdmin, secondAdmin, professional, asFirst, asSecond } =
    await seedTwoAdminsAndProfessional(t);

  await asFirst.mutation(api.presentation.accounts.enableAccount, { userId: professional });
  await asFirst.mutation(api.presentation.accounts.revokeAccount, {
    userId: professional,
    reason: "  Licencia ficticia  ",
  });
  await asSecond.mutation(api.presentation.accounts.enableAccount, { userId: professional });
  await asSecond.mutation(api.presentation.accounts.revokeAccount, { userId: professional });

  const history = await asFirst.query(api.presentation.accounts.listAccountEnablements, {
    userId: professional,
    paginationOpts: PAGE,
  });
  expect(history.isDone).toBe(true);
  // Del más reciente al más antiguo; el primer ciclo sigue consultable.
  expect(history.page).toHaveLength(2);
  const [latest, earliest] = history.page;
  expect(latest).toMatchObject({
    enabledRole: "professional",
    enabledBy: secondAdmin,
    revokedBy: secondAdmin,
  });
  expect(latest?.revocationReason).toBeUndefined();
  expect(earliest).toMatchObject({
    enabledRole: "professional",
    enabledBy: firstAdmin,
    revokedBy: firstAdmin,
    revocationReason: "Licencia ficticia",
  });
  for (const event of history.page) {
    expect(event.revokedAt).toBeGreaterThanOrEqual(event.enabledAt);
    // Sin `userId` ni otros campos: solo el evento.
    expect(Object.keys(event).filter((key) => !ALLOWED_EVENT_KEYS.includes(key))).toEqual([]);
  }

  // `users` sigue entregando el último evento, como antes.
  const account = await asFirst.query(api.presentation.accounts.getAccount, {
    userId: professional,
  });
  expect(account).toMatchObject({
    institutionalStatus: "disabled",
    enabledBy: secondAdmin,
    revokedBy: secondAdmin,
  });
});

test("la habilitación abierta aparece sin revocación hasta que se revoca", async () => {
  const t = convexTest(schema, modules);
  const { firstAdmin, professional, asFirst } = await seedTwoAdminsAndProfessional(t);

  await asFirst.mutation(api.presentation.accounts.enableAccount, { userId: professional });
  const history = await asFirst.query(api.presentation.accounts.listAccountEnablements, {
    userId: professional,
    paginationOpts: PAGE,
  });
  expect(history.page).toHaveLength(1);
  expect(history.page[0]).toMatchObject({ enabledBy: firstAdmin, enabledRole: "professional" });
  expect(history.page[0]?.revokedAt).toBeUndefined();
});

test("una cuenta habilitada antes del historial conserva su habilitación al revocarse", async () => {
  const t = convexTest(schema, modules);
  const { firstAdmin, asSecond, secondAdmin } = await seedTwoAdminsAndProfessional(t);
  const legacy = await seedUser(t, {
    subject: "hab-pro-anterior",
    email: "hab-pro-anterior@uct.cl",
    role: "professional",
    enabledBy: firstAdmin,
    enabledAt: 1_700_000_000_000,
  });

  await asSecond.mutation(api.presentation.accounts.revokeAccount, { userId: legacy });

  const history = await asSecond.query(api.presentation.accounts.listAccountEnablements, {
    userId: legacy,
    paginationOpts: PAGE,
  });
  expect(history.page).toHaveLength(1);
  expect(history.page[0]).toMatchObject({
    enabledBy: firstAdmin,
    enabledAt: 1_700_000_000_000,
    revokedBy: secondAdmin,
  });
});

test("sin fecha de habilitación conocida no se inventa un evento, y la revocación queda en la cuenta", async () => {
  const t = convexTest(schema, modules);
  const { asSecond, secondAdmin } = await seedTwoAdminsAndProfessional(t);
  const withoutDate = await seedUser(t, {
    subject: "hab-pro-sin-fecha",
    email: "hab-pro-sin-fecha@uct.cl",
    role: "professional",
  });

  await asSecond.mutation(api.presentation.accounts.revokeAccount, { userId: withoutDate });

  const history = await asSecond.query(api.presentation.accounts.listAccountEnablements, {
    userId: withoutDate,
    paginationOpts: PAGE,
  });
  expect(history.page).toEqual([]);
  expect(
    await asSecond.query(api.presentation.accounts.getAccount, { userId: withoutDate }),
  ).toMatchObject({ institutionalStatus: "disabled", revokedBy: secondAdmin });
});

test("un motivo de más de 500 caracteres se rechaza sin revocar", async () => {
  const t = convexTest(schema, modules);
  const { professional, asFirst } = await seedTwoAdminsAndProfessional(t);
  await asFirst.mutation(api.presentation.accounts.enableAccount, { userId: professional });

  expect(
    await publicErrorData(
      asFirst.mutation(api.presentation.accounts.revokeAccount, {
        userId: professional,
        reason: "x".repeat(501),
      }),
    ),
  ).toEqual({
    code: "account_fields_invalid",
    message: "El motivo de la revocación supera los 500 caracteres.",
  });
  const status = await t.run(async (ctx) => (await ctx.db.get(professional))?.institutionalStatus);
  expect(status).toBe("enabled");
});

test("solo el Administrador vigente lee el historial, y solo de cuentas de personal", async () => {
  const t = convexTest(schema, modules);
  const { professional, asFirst } = await seedTwoAdminsAndProfessional(t);
  const student = await seedUser(t, {
    subject: "hab-est",
    email: "hab-est@alu.uct.cl",
    role: "student",
  });
  await seedUser(t, { subject: "hab-pro-2", email: "hab-pro-2@uct.cl", role: "professional" });

  const read = (caller: Pick<T, "query">) =>
    publicErrorData(
      caller.query(api.presentation.accounts.listAccountEnablements, {
        userId: professional,
        paginationOpts: PAGE,
      }),
    );
  expect(await read(as(t, "hab-pro-2", "hab-pro-2@uct.cl"))).toEqual(UNAUTHORIZED);
  expect(await read(as(t, "hab-est", "hab-est@alu.uct.cl"))).toEqual(UNAUTHORIZED);
  expect(await read(t)).toEqual(UNAUTHORIZED);
  expect(
    await publicErrorData(
      asFirst.query(api.presentation.accounts.listAccountEnablements, {
        userId: student,
        paginationOpts: PAGE,
      }),
    ),
  ).toEqual(UNAUTHORIZED);
});

test("el practicante, el arranque y el primer ingreso del Estudiante también dejan su habilitación", async () => {
  const t = convexTest(schema, modules);
  const { firstAdmin, asFirst } = await seedTwoAdminsAndProfessional(t);
  const intern = await seedUser(t, {
    subject: "hab-pra",
    email: "hab-pra@alu.uct.cl",
    role: "intern",
    institutionalStatus: "pending",
  });
  await asFirst.mutation(internal.operations.accounts.enableIntern, { userId: intern });

  const bootstrapT = convexTest(schema, modules);
  const bootstrap = await bootstrapT.mutation(internal.operations.accounts.ensureBootstrapAdmin, {
    email: "hab-arranque@uct.cl",
    fullName: "Administración ficticia",
    tokenIdentifier: `${ISSUER}|hab-arranque`,
  });

  await as(t, "hab-est-nuevo", "hab-est-nuevo@alu.uct.cl").mutation(
    api.presentation.session.ensureMyProfile,
    {},
  );

  const rows = await t.run(async (ctx) => ctx.db.query("accountEnablements").collect());
  expect(rows.find((row) => row.userId === intern)).toMatchObject({
    enabledRole: "intern",
    enabledBy: firstAdmin,
  });
  const student = rows.find((row) => row.enabledRole === "student");
  expect(student).toBeDefined();
  expect(student?.enabledBy).toBeUndefined();

  const bootstrapRows = await bootstrapT.run(async (ctx) =>
    ctx.db.query("accountEnablements").collect(),
  );
  expect(bootstrapRows).toHaveLength(1);
  expect(bootstrapRows[0]).toMatchObject({ userId: bootstrap, enabledRole: "admin" });
  expect(bootstrapRows[0]?.enabledBy).toBeUndefined();
});
