/// <reference types="vite/client" />
import { ConvexError } from "convex/values";
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

test("el catálogo se recorre por páginas sin truncar en silencio", async () => {
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

/** Datos públicos del error de gestión, sin asumir la envoltura concreta. */
async function manageErrorData(
  promise: Promise<unknown>,
): Promise<{ code: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConvexError) return error.data as { code: string; message: string };
    if (typeof error === "object" && error !== null && "data" in error) {
      return (error as { readonly data: { code: string; message: string } }).data;
    }
    throw error;
  }
  throw new Error("Se esperaba un error de gestión y la operación fue permitida");
}

const SPACE_INPUT = {
  campus: "Campus Ficticio",
  building: "Edificio Ficticio",
  floor: "Piso 2",
  room: "Sala Ficticia Nueva",
  accessConditions: "Condición ficticia nueva",
  arrivalInstructions: "Instrucción ficticia nueva",
  version: "v1" as const,
};

test("TI2-148 éxito: administración crea, consulta, edita y deshabilita con nombre legible", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti148-adm", "admin");
  const admin = asReader(t, "ti148-adm");

  const created = await admin.mutation(api.presentation.spaces.createSpace, SPACE_INPUT);
  expect(created.isActive).toBe(true);
  expect(created.space.version).toBe("v1");
  expect(created.space.room).toBe("Sala Ficticia Nueva");
  expect(created.label).toBe("Campus Ficticio · Edificio Ficticio · Piso 2 · Sala Ficticia Nueva");

  const fetched = await admin.query(api.presentation.spaces.getSpace, {
    spaceId: created.space.id,
    version: "v1",
  });
  expect(fetched.space.room).toBe("Sala Ficticia Nueva");
  expect(fetched.label).toBe(created.label);
  expect(fetched.isActive).toBe(true);

  const updated = await admin.mutation(api.presentation.spaces.updateSpace, {
    spaceId: created.space.id,
    ...SPACE_INPUT,
    room: "Sala Ficticia Editada",
  });
  expect(updated.space.room).toBe("Sala Ficticia Editada");
  expect(updated.label).toContain("Sala Ficticia Editada");
  expect(updated.isActive).toBe(true);

  const disabled = await admin.mutation(api.presentation.spaces.setSpaceActive, {
    spaceId: created.space.id,
    isActive: false,
    version: "v1",
  });
  expect(disabled.isActive).toBe(false);
  expect(disabled.label).toContain("Sala Ficticia Editada");

  const retired = await admin.query(api.presentation.spaces.getSpace, {
    spaceId: created.space.id,
    version: "v1",
  });
  expect(retired.isActive).toBe(false);

  const page = await admin.query(api.presentation.spaces.listSpaces, {
    limit: 10,
    version: "v1",
  });
  expect(page.items.map((item) => item.id)).not.toContain(created.space.id);
});

test("TI2-148 denegación: sin administración no se gestiona el catálogo", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti148-adm", "admin");
  await seedUser(t, "ti148-est", "student");
  await seedUser(t, "ti148-pro", "professional");
  await seedUser(t, "ti148-int", "intern");
  await seedUser(t, "ti148-inhabilitado", "admin", false);
  const admin = asReader(t, "ti148-adm");
  const created = await admin.mutation(api.presentation.spaces.createSpace, SPACE_INPUT);

  for (const subject of ["ti148-est", "ti148-pro", "ti148-int", "ti148-inhabilitado"]) {
    const reader = asReader(t, subject);
    expect(
      (await manageErrorData(reader.mutation(api.presentation.spaces.createSpace, SPACE_INPUT)))
        .code,
    ).toBe("unauthorized");
    expect(
      (
        await manageErrorData(
          reader.mutation(api.presentation.spaces.updateSpace, {
            spaceId: created.space.id,
            ...SPACE_INPUT,
          }),
        )
      ).code,
    ).toBe("unauthorized");
    expect(
      (
        await manageErrorData(
          reader.mutation(api.presentation.spaces.setSpaceActive, {
            spaceId: created.space.id,
            isActive: false,
            version: "v1",
          }),
        )
      ).code,
    ).toBe("unauthorized");
    expect(
      (
        await manageErrorData(
          reader.query(api.presentation.spaces.getSpace, {
            spaceId: created.space.id,
            version: "v1",
          }),
        )
      ).code,
    ).toBe("unauthorized");
  }
  expect(
    (await manageErrorData(t.mutation(api.presentation.spaces.createSpace, SPACE_INPUT))).code,
  ).toBe("unauthorized");
  expect(
    (
      await manageErrorData(
        t.mutation(api.presentation.spaces.updateSpace, {
          spaceId: created.space.id,
          ...SPACE_INPUT,
        }),
      )
    ).code,
  ).toBe("unauthorized");
  expect(
    (
      await manageErrorData(
        t.mutation(api.presentation.spaces.setSpaceActive, {
          spaceId: created.space.id,
          isActive: false,
          version: "v1",
        }),
      )
    ).code,
  ).toBe("unauthorized");
  expect(
    (
      await manageErrorData(
        t.query(api.presentation.spaces.getSpace, { spaceId: created.space.id, version: "v1" }),
      )
    ).code,
  ).toBe("unauthorized");
});

test("TI2-148 inexistente: un id ajeno o de otra tabla se deniega sin filtrar", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti148-adm", "admin");
  await seedUser(t, "ti148-otro", "professional");
  const admin = asReader(t, "ti148-adm");
  const created = await admin.mutation(api.presentation.spaces.createSpace, SPACE_INPUT);
  const foreignId = await t.run(async (ctx) => {
    const row = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "ti148-otro@uct.cl"))
      .first();
    return row!._id;
  });

  for (const spaceId of ["sala-ficticia-inexistente", foreignId]) {
    expect(
      (
        await manageErrorData(
          admin.query(api.presentation.spaces.getSpace, { spaceId, version: "v1" }),
        )
      ).code,
    ).toBe("unauthorized");
    expect(
      (
        await manageErrorData(
          admin.mutation(api.presentation.spaces.updateSpace, { spaceId, ...SPACE_INPUT }),
        )
      ).code,
    ).toBe("unauthorized");
    expect(
      (
        await manageErrorData(
          admin.mutation(api.presentation.spaces.setSpaceActive, {
            spaceId,
            isActive: false,
            version: "v1",
          }),
        )
      ).code,
    ).toBe("unauthorized");
  }
  expect(created.isActive).toBe(true);
});

test("TI2-148 duplicado: la misma ubicación vigente o retirada responde conflicto", async () => {
  const t = convexTest(schema, modules);
  await seedCatalog(t);
  await seedUser(t, "ti148-adm", "admin");
  const admin = asReader(t, "ti148-adm");

  expect(
    (
      await manageErrorData(
        admin.mutation(api.presentation.spaces.createSpace, {
          campus: "Campus Ficticio",
          building: "Edificio Ficticio",
          floor: "Piso 1",
          room: "Sala Ficticia 1",
          accessConditions: "Otra condición",
          arrivalInstructions: "Otra instrucción",
          version: "v1",
        }),
      )
    ).code,
  ).toBe("conflict");
  expect(
    (
      await manageErrorData(
        admin.mutation(api.presentation.spaces.createSpace, {
          campus: "Campus Ficticio",
          building: "Edificio Ficticio",
          floor: "Piso 1",
          room: "Sala Ficticia Retirada",
          accessConditions: "Otra condición",
          arrivalInstructions: "Otra instrucción",
          version: "v1",
        }),
      )
    ).code,
  ).toBe("conflict");

  const page = await admin.query(api.presentation.spaces.listSpaces, {
    limit: 10,
    version: "v1",
  });
  const first = page.items[0]!;
  const second = page.items[1]!;
  expect(
    (
      await manageErrorData(
        admin.mutation(api.presentation.spaces.updateSpace, {
          spaceId: first.id,
          campus: second.campus,
          building: second.building,
          floor: second.floor,
          room: second.room,
          accessConditions: second.accessConditions,
          arrivalInstructions: second.arrivalInstructions,
          version: "v1",
        }),
      )
    ).code,
  ).toBe("conflict");

  const emptyCampus = await manageErrorData(
    admin.mutation(api.presentation.spaces.createSpace, { ...SPACE_INPUT, campus: "   " }),
  );
  expect(emptyCampus.code).toBe("space_fields_invalid");
  expect(emptyCampus.message).toBe("Indica el campus del espacio.");
});

test("TI2-148 vigencia y recorte: reactivar vuelve a ofrecer y el duplicado se recorta", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti148-adm", "admin");
  const admin = asReader(t, "ti148-adm");
  const created = await admin.mutation(api.presentation.spaces.createSpace, SPACE_INPUT);

  const sameLocation = await admin.mutation(api.presentation.spaces.updateSpace, {
    spaceId: created.space.id,
    ...SPACE_INPUT,
    accessConditions: "Condición ficticia editada",
  });
  expect(sameLocation.isActive).toBe(true);
  expect(sameLocation.space.accessConditions).toBe("Condición ficticia editada");

  await admin.mutation(api.presentation.spaces.setSpaceActive, {
    spaceId: created.space.id,
    isActive: false,
    version: "v1",
  });
  const reactivated = await admin.mutation(api.presentation.spaces.setSpaceActive, {
    spaceId: created.space.id,
    isActive: true,
    version: "v1",
  });
  expect(reactivated.isActive).toBe(true);
  const page = await admin.query(api.presentation.spaces.listSpaces, {
    limit: 10,
    version: "v1",
  });
  expect(page.items.map((item) => item.id)).toContain(created.space.id);

  const padded = await manageErrorData(
    admin.mutation(api.presentation.spaces.createSpace, {
      ...SPACE_INPUT,
      room: " Sala Ficticia Nueva ",
    }),
  );
  expect(padded.code).toBe("conflict");

  const trimmed = await admin.mutation(api.presentation.spaces.createSpace, {
    ...SPACE_INPUT,
    room: "  Sala Ficticia Recortada  ",
  });
  expect(trimmed.space.room).toBe("Sala Ficticia Recortada");
});
