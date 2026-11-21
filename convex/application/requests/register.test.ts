import { describe, expect, test } from "vitest";
import { registerRequest, type RegisterRequestDeps } from "./commands";
import type { StoredRequestRow } from "./ports";

/*
 * TI2-181: el registro de la solicitud con dobles en memoria, sin Convex.
 * El doble guarda las filas registradas, así cada rechazo comprueba también
 * que no se escribió ninguna.
 */

const NOW = 1_700_000_000_000;
const STUDENT = "est-ficticio";

function memoryDeps() {
  const rows: StoredRequestRow<string, string>[] = [];
  const writes: string[] = [];
  const insert = (studentId: string, accessNeeds: string) => {
    const _id = `sol-${rows.length + 1}`;
    rows.push({ _id, studentId, status: "received", accessNeeds, createdAt: 1 });
    return _id;
  };
  const deps: RegisterRequestDeps<string, string> = {
    students: {
      findActiveStudent: async (tokenIdentifier) =>
        tokenIdentifier === STUDENT ? { _id: STUDENT } : null,
    },
    requests: {
      getRequest: async (requestId) => rows.find((row) => row._id === requestId) ?? null,
      registerLegacy: async (studentId, accessNeeds) => {
        writes.push(`legacy ${studentId}`);
        return insert(studentId, accessNeeds);
      },
      registerComplete: async (studentId, submission, receivedAt) => {
        writes.push(`complete ${studentId} ${receivedAt}`);
        return insert(studentId, submission.accessNeeds.map((need) => need.label).join("\n"));
      },
    },
    now: () => NOW,
  };
  return { deps, writes };
}

function register(
  deps: RegisterRequestDeps<string, string>,
  submission: Record<string, unknown>,
  tokenIdentifier: string | null = STUDENT,
) {
  return registerRequest(deps, { tokenIdentifier, submission });
}

const UNAUTHORIZED = {
  status: "error",
  error: { code: "unauthorized", message: "No autorizado" },
};

describe("registerRequest con puertos (TI2-181)", () => {
  test("la forma anterior guarda el texto recortado y lo devuelve leído de vuelta", async () => {
    const { deps, writes } = memoryDeps();
    expect(await register(deps, { accessNeeds: "  Texto ficticio  " })).toEqual({
      status: "ok",
      data: {
        _id: "sol-1",
        studentId: STUDENT,
        status: "received",
        accessNeeds: "Texto ficticio",
        createdAt: 1,
      },
    });
    expect(writes).toEqual([`legacy ${STUDENT}`]);
  });

  test.each([
    ["sin sesión", null],
    ["sin rol Estudiante vigente", "pro-1"],
  ])("%s responde unauthorized aunque el texto falle, sin escribir", async (_, token) => {
    const { deps, writes } = memoryDeps();
    expect(await register(deps, { accessNeeds: " " }, token)).toEqual(UNAUTHORIZED);
    expect(await register(deps, { needSummary: "" }, token)).toEqual(UNAUTHORIZED);
    expect(writes).toEqual([]);
  });

  test("la forma anterior rechaza el texto con los códigos access_needs_*", async () => {
    const { deps, writes } = memoryDeps();
    expect(await register(deps, { accessNeeds: " " })).toEqual({
      status: "error",
      error: {
        code: "access_needs_empty",
        message: "Se requiere describir la necesidad de acceso",
      },
    });
    expect(await register(deps, { accessNeeds: "a".repeat(2001) })).toEqual({
      status: "error",
      error: {
        code: "access_needs_too_long",
        message: "La necesidad de acceso supera el máximo permitido (2000 caracteres)",
      },
    });
    expect(writes).toEqual([]);
  });

  test("la forma completa con campos faltantes responde request_fields_invalid sin escribir", async () => {
    const { deps, writes } = memoryDeps();
    const result = await register(deps, { needSummary: "" });
    expect(result).toMatchObject({ status: "error", error: { code: "request_fields_invalid" } });
    expect(writes).toEqual([]);
  });
});
