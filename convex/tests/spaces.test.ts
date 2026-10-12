/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const ISSUER = "https://accounts.google.com";

/** Identidad simulada con `tokenIdentifier` explícito. */
function identityFor(subject: string, email: string) {
  return {
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    email,
    name: "Ficticio",
  };
}

/** Usuario ficticio con rol y vigencia dados. */
async function seedUser(
  t: ReturnType<typeof convexTest>,
  subject: string,
  role: "student" | "professional" | "intern" | "admin",
  enabled = true,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      email: `${subject}@uct.cl`,
      fullName: "Ficticio",
      role,
      institutionalStatus: enabled ? "enabled" : "disabled",
      accountStatus: enabled ? "active" : "inactive",
      tokenIdentifier: `${ISSUER}|${subject}`,
    });
  });
}

/** Sala ficticia del catálogo, vigente salvo indicación. */
async function seedSpace(t: ReturnType<typeof convexTest>, room: string, isActive = true) {
  await t.run(async (ctx) => {
    await ctx.db.insert("spaces", {
      campus: "Campus Ficticio",
      building: "Edificio Ficticio",
      floor: "Piso 1",
      room,
      accessConditions: `Condición ficticia ${room}`,
      accessInstructions: `Instrucción ficticia ${room}`,
      isActive,
    });
  });
}

/** Catálogo ficticio común: tres salas vigentes y una retirada. */
async function seedCatalog(t: ReturnType<typeof convexTest>) {
  await seedSpace(t, "Sala Ficticia 1");
  await seedSpace(t, "Sala Ficticia 2");
  await seedSpace(t, "Sala Ficticia 3");
  await seedSpace(t, "Sala Ficticia Retirada", false);
}

function asReader(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity(identityFor(subject, `${subject}@uct.cl`));
}

/** Mensaje de la denegación, o falla si la operación fue permitida. */
async function denyMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Se esperaba denegación y la operación fue permitida");
}

test("cada rol vigente lista solo salas vigentes con forma exacta", async () => {
  const t = convexTest(schema, modules);
  await seedCatalog(t);
  for (const [subject, role] of [
    ["ti99-est", "student"],
    ["ti99-pro", "professional"],
    ["ti99-int", "intern"],
    ["ti99-adm", "admin"],
  ] as const) {
    await seedUser(t, subject, role);
    const page = await asReader(t, subject).query(api.presentation.spaces.listSpaces, {
      limit: 10,
      version: "v1",
    });
    expect(page.items).toHaveLength(3);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
    expect(page.version).toBe("v1");
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toEqual([
        "accessConditions",
        "arrivalInstructions",
        "building",
        "campus",
        "floor",
        "id",
        "room",
        "version",
      ]);
    }
    expect(page.items[0]).toMatchObject({
      campus: "Campus Ficticio",
      room: "Sala Ficticia 1",
      accessConditions: "Condición ficticia Sala Ficticia 1",
      arrivalInstructions: "Instrucción ficticia Sala Ficticia 1",
    });
  }
});

test("sin identidad, sin perfil o sin vigencia responde denegación sin filtrar", async () => {
  const t = convexTest(schema, modules);
  await seedCatalog(t);
  await seedUser(t, "ti99-inhabilitado", "professional", false);

  const denied = /^No autorizado$/;
  const anonymous = await denyMessage(
    t.query(api.presentation.spaces.listSpaces, { limit: 10, version: "v1" }),
  );
  expect(anonymous).toMatch(denied);
  const missing = await denyMessage(
    asReader(t, "ti99-fantasma").query(api.presentation.spaces.listSpaces, {
      limit: 10,
      version: "v1",
    }),
  );
  expect(missing).toMatch(denied);
  const disabled = await denyMessage(
    asReader(t, "ti99-inhabilitado").query(api.presentation.spaces.listSpaces, {
      limit: 10,
      version: "v1",
    }),
  );
  expect(disabled).toMatch(denied);
  for (const message of [anonymous, missing, disabled]) {
    expect(message).not.toContain("Sala Ficticia");
  }
});

test("la paginación recorre el catálogo sin truncar en silencio", async () => {
  const t = convexTest(schema, modules);
  await seedCatalog(t);
  await seedUser(t, "ti99-est", "student");
  const reader = asReader(t, "ti99-est");

  const first = await reader.query(api.presentation.spaces.listSpaces, {
    limit: 2,
    version: "v1",
  });
  expect(first.items).toHaveLength(2);
  expect(first.hasMore).toBe(true);
  expect(typeof first.nextCursor).toBe("string");

  const second = await reader.query(api.presentation.spaces.listSpaces, {
    limit: 2,
    cursor: first.nextCursor ?? undefined,
    version: "v1",
  });
  expect(second.items).toHaveLength(1);
  expect(second.hasMore).toBe(false);
  expect(second.nextCursor).toBeNull();
  expect([...first.items, ...second.items].map((item) => item.room).sort()).toEqual([
    "Sala Ficticia 1",
    "Sala Ficticia 2",
    "Sala Ficticia 3",
  ]);
});

test("el catálogo vacío responde página vacía", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti99-est", "student");

  const page = await asReader(t, "ti99-est").query(api.presentation.spaces.listSpaces, {
    limit: 10,
    version: "v1",
  });
  expect(page).toEqual({ items: [], hasMore: false, nextCursor: null, version: "v1" });
});

test("los filtros inválidos se rechazan sin consultar", async () => {
  const t = convexTest(schema, modules);
  await seedCatalog(t);
  await seedUser(t, "ti99-est", "student");
  const reader = asReader(t, "ti99-est");

  for (const limit of [0, -1, 1.5, 101]) {
    await expect(
      reader.query(api.presentation.spaces.listSpaces, { limit, version: "v1" }),
    ).rejects.toThrow("límite");
  }
  await expect(
    reader.query(api.presentation.spaces.listSpaces, { limit: 10, version: "v2" as "v1" }),
  ).rejects.toThrow("v1");
});
