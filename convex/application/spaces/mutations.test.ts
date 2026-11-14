import { describe, expect, test } from "vitest";
import { SPACE_CATALOG_CONTRACT_VERSION, type Space } from "../../domain/spaces/space";
import { conflictError, errResult, okResult } from "../../domain/errors/api_error";
import type { AuthorizableProfile, AuthorizationReader } from "../authorization/authorize";
import type { StoredSpace } from "./ports";
import {
  createSpaceCatalogEntry,
  getSpaceCatalogEntry,
  setSpaceCatalogActive,
  updateSpaceCatalogEntry,
} from "./mutations";

/**
 * Casos de uso de gestión del catálogo con dobles en memoria (TI2-148).
 *
 * Verifica el orden (autorización antes de validar), el `conflict` del
 * duplicado lógico, la denegación sin filtrar existencia y que la
 * validación responde `space_fields_invalid` con mensaje, apto para
 * producción. La persistencia real se prueba en `convex/tests/spaces.test.ts`.
 */

type FakeProfile = AuthorizableProfile & { readonly tokenIdentifier: string };

const admin: FakeProfile = {
  _id: "user-admin",
  role: "admin",
  institutionalStatus: "enabled",
  accountStatus: "active",
  tokenIdentifier: "token-admin",
};

const student: FakeProfile = {
  _id: "user-student",
  role: "student",
  institutionalStatus: "enabled",
  accountStatus: "active",
  tokenIdentifier: "token-student",
};

function fakeAuth(profiles: ReadonlyArray<FakeProfile>): AuthorizationReader {
  return {
    findProfileByTokenIdentifier: async (tokenIdentifier) =>
      profiles.find((row) => row.tokenIdentifier === tokenIdentifier) ?? null,
    getProfileById: async (userId) => profiles.find((row) => row._id === userId) ?? null,
    getAccompaniment: async () => null,
    findActiveAssignments: async () => [],
  };
}

const FIELDS = {
  campus: "Campus Ficticio",
  building: "Edificio Ficticio",
  floor: "Piso 1",
  room: "Sala Ficticia 1",
  accessConditions: "Condición ficticia",
  arrivalInstructions: "Instrucción ficticia",
};

function stored(id: string, isActive = true): StoredSpace {
  return {
    id,
    ...FIELDS,
    version: SPACE_CATALOG_CONTRACT_VERSION,
    isActive,
  };
}

/** Doble en memoria con la misma regla de unicidad que Infraestructura. */
function memoryStore(initial: ReadonlyArray<StoredSpace> = []) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));
  let next = rows.size + 1;
  const keyOf = (row: Pick<Space, "campus" | "building" | "floor" | "room">) =>
    [row.campus, row.building, row.floor, row.room].join(" · ");
  return {
    getSpace: async (spaceId: string) => rows.get(spaceId) ?? null,
    findSpaceByLocation: async (
      location: Pick<Space, "campus" | "building" | "floor" | "room">,
    ) => {
      for (const row of rows.values()) {
        if (keyOf(row) === keyOf(location)) return row;
      }
      return null;
    },
    insertSpace: async (space: Omit<Space, "id" | "version">) => {
      for (const row of rows.values()) {
        if (keyOf(row) === keyOf(space)) {
          return errResult<{ readonly spaceId: string }>(conflictError());
        }
      }
      const spaceId = `sala-ficticia-${next++}`;
      rows.set(spaceId, {
        id: spaceId,
        ...space,
        version: SPACE_CATALOG_CONTRACT_VERSION,
        isActive: true,
      });
      return okResult({ spaceId });
    },
    updateSpace: async (spaceId: string, space: Omit<Space, "id" | "version">) => {
      const row = rows.get(spaceId);
      if (row === undefined) return errResult<null>(conflictError());
      for (const other of rows.values()) {
        if (other.id !== spaceId && keyOf(other) === keyOf(space)) {
          return errResult<null>(conflictError());
        }
      }
      rows.set(spaceId, { ...row, ...space });
      return okResult(null);
    },
    setSpaceActive: async (spaceId: string, isActive: boolean) => {
      const row = rows.get(spaceId);
      if (row === undefined) return errResult<null>(conflictError());
      rows.set(spaceId, { ...row, isActive });
      return okResult(null);
    },
  };
}

const auth = fakeAuth([admin, student]);

describe("createSpaceCatalogEntry", () => {
  test("administración crea con nombre legible y vigencia", async () => {
    const result = await createSpaceCatalogEntry(auth, memoryStore(), {
      tokenIdentifier: "token-admin",
      version: "v1",
      ...FIELDS,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("Se esperaba éxito");
    expect(result.data.isActive).toBe(true);
    expect(result.data.label).toBe(
      "Campus Ficticio · Edificio Ficticio · Piso 1 · Sala Ficticia 1",
    );
  });

  test("sin permiso responde unauthorized aunque los campos sean inválidos", async () => {
    for (const tokenIdentifier of ["token-student", null]) {
      const result = await createSpaceCatalogEntry(auth, memoryStore(), {
        tokenIdentifier,
        version: "v1",
        ...FIELDS,
        campus: "   ",
      });
      expect(result).toEqual({
        status: "error",
        error: { code: "unauthorized", message: "No autorizado" },
      });
    }
  });

  test("duplicado responde conflicto y campos vacíos responden validación", async () => {
    const store = memoryStore([stored("sala-ficticia-1")]);
    const duplicated = await createSpaceCatalogEntry(auth, store, {
      tokenIdentifier: "token-admin",
      version: "v1",
      ...FIELDS,
    });
    expect(duplicated.status).toBe("error");
    if (duplicated.status !== "error") throw new Error("Se esperaba conflicto");
    expect(duplicated.error.code).toBe("conflict");

    const invalid = await createSpaceCatalogEntry(auth, memoryStore(), {
      tokenIdentifier: "token-admin",
      version: "v1",
      ...FIELDS,
      room: "  ",
    });
    expect(invalid).toEqual({
      status: "error",
      error: { code: "space_fields_invalid", message: "Indica la sala del espacio." },
    });
  });

  test("versión ajena se rechaza sin escribir", async () => {
    await expect(
      createSpaceCatalogEntry(auth, memoryStore(), {
        tokenIdentifier: "token-admin",
        version: "v0",
        ...FIELDS,
      }),
    ).rejects.toThrow("vigente");
  });
});

describe("updateSpaceCatalogEntry", () => {
  test("editar sin cambiar la ubicación conserva la vigencia", async () => {
    const result = await updateSpaceCatalogEntry(auth, memoryStore([stored("sala-ficticia-1")]), {
      tokenIdentifier: "token-admin",
      version: "v1",
      spaceId: "sala-ficticia-1",
      ...FIELDS,
      accessConditions: "Otra condición",
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("Se esperaba éxito");
    expect(result.data.isActive).toBe(true);
    expect(result.data.space.accessConditions).toBe("Otra condición");
  });

  test("ubicación de otra sala responde conflicto e inexistente se deniega", async () => {
    const other = { ...FIELDS, room: "Sala Ficticia 2" };
    const store = memoryStore([
      stored("sala-ficticia-1"),
      { ...stored("sala-ficticia-2"), ...other },
    ]);
    const clash = await updateSpaceCatalogEntry(auth, store, {
      tokenIdentifier: "token-admin",
      version: "v1",
      spaceId: "sala-ficticia-1",
      ...other,
    });
    expect(clash.status).toBe("error");
    if (clash.status !== "error") throw new Error("Se esperaba conflicto");
    expect(clash.error.code).toBe("conflict");

    const missing = await updateSpaceCatalogEntry(auth, store, {
      tokenIdentifier: "token-admin",
      version: "v1",
      spaceId: "sala-ficticia-inexistente",
      ...FIELDS,
    });
    expect(missing.status).toBe("error");
    if (missing.status !== "error") throw new Error("Se esperaba denegación");
    expect(missing.error.code).toBe("unauthorized");
  });
});

describe("setSpaceCatalogActive y getSpaceCatalogEntry", () => {
  test("retirar y reactivar conservan el resumen legible", async () => {
    const store = memoryStore([stored("sala-ficticia-1")]);
    const retired = await setSpaceCatalogActive(auth, store, {
      tokenIdentifier: "token-admin",
      version: "v1",
      spaceId: "sala-ficticia-1",
      isActive: false,
    });
    expect(retired.status).toBe("ok");
    if (retired.status !== "ok") throw new Error("Se esperaba éxito");
    expect(retired.data.isActive).toBe(false);

    const fetched = await getSpaceCatalogEntry(auth, store, {
      tokenIdentifier: "token-admin",
      version: "v1",
      spaceId: "sala-ficticia-1",
    });
    expect(fetched.status).toBe("ok");
    if (fetched.status !== "ok") throw new Error("Se esperaba éxito");
    expect(fetched.data.isActive).toBe(false);
    expect(fetched.data.label).toContain("Sala Ficticia 1");

    const reactivated = await setSpaceCatalogActive(auth, store, {
      tokenIdentifier: "token-admin",
      version: "v1",
      spaceId: "sala-ficticia-1",
      isActive: true,
    });
    expect(reactivated.status).toBe("ok");
    if (reactivated.status !== "ok") throw new Error("Se esperaba éxito");
    expect(reactivated.data.isActive).toBe(true);
  });

  test("inexistente y sin permiso se deniegan sin filtrar", async () => {
    const store = memoryStore([stored("sala-ficticia-1")]);
    for (const tokenIdentifier of ["token-student", null]) {
      const denied = await getSpaceCatalogEntry(auth, store, {
        tokenIdentifier,
        version: "v1",
        spaceId: "sala-ficticia-1",
      });
      expect(denied.status).toBe("error");
      if (denied.status !== "error") throw new Error("Se esperaba denegación");
      expect(denied.error.code).toBe("unauthorized");

      const retired = await setSpaceCatalogActive(auth, store, {
        tokenIdentifier,
        version: "v1",
        spaceId: "sala-ficticia-1",
        isActive: false,
      });
      expect(retired.status).toBe("error");
    }
    const missing = await getSpaceCatalogEntry(auth, store, {
      tokenIdentifier: "token-admin",
      version: "v1",
      spaceId: "sala-ficticia-inexistente",
    });
    expect(missing.status).toBe("error");
  });
});
