import { describe, expect, test } from "vitest";
import type { PersistableRequestState } from "../../domain/requests/state";
import { takeRequest, type TakeRequestDeps } from "./commands";
import type { StoredRequestRow } from "./ports";

/*
 * TI2-181: la toma del Profesional con dobles en memoria, sin Convex. Cada
 * doble anota lo que se escribió, así cada rechazo comprueba también que no
 * quedó ninguna escritura.
 */

const NOW = 1_700_000_000_000;
const PROFESSIONAL = "pro-ficticio";

type Row = StoredRequestRow<string, string>;

function memoryDeps(
  rows: readonly Row[],
  options: { readonly takes?: readonly string[]; readonly professionals?: readonly string[] } = {},
) {
  const takes = options.takes ?? [];
  const professionals = options.professionals ?? [PROFESSIONAL];
  const writes: string[] = [];
  const deps: TakeRequestDeps<string, string> = {
    professionals: {
      findActiveProfessional: async (tokenIdentifier) =>
        tokenIdentifier !== null && professionals.includes(tokenIdentifier)
          ? { _id: tokenIdentifier }
          : null,
    },
    requests: {
      getRequest: async (requestId) => rows.find((row) => row._id === requestId) ?? null,
      hasActiveTake: async (requestId, userId) => takes.includes(`${requestId}:${userId}`),
      recordTake: async (requestId, professionalId) => {
        writes.push(`take ${requestId} ${professionalId}`);
      },
      setRequestStatus: async (requestId, change) => {
        writes.push(`status ${requestId} ${change.status}`);
      },
      logRequestTransition: async (entry) => {
        writes.push(`log ${entry.from}->${entry.to} ${entry.actorId} ${entry.occurredAt}`);
      },
    },
    now: () => NOW,
  };
  return { deps, writes };
}

function rowIn(status: PersistableRequestState): Row {
  return {
    _id: "sol-1",
    studentId: "est-1",
    status,
    accessNeeds: "Necesidad ficticia",
    createdAt: 1,
  };
}

function take(
  deps: TakeRequestDeps<string, string>,
  tokenIdentifier: string | null = PROFESSIONAL,
) {
  return takeRequest(deps, { tokenIdentifier, requestId: "sol-1" });
}

const UNAUTHORIZED = {
  status: "error",
  error: { code: "unauthorized", message: "No autorizado" },
};

function conflict(message: string) {
  return { status: "error", error: { code: "conflict", message } };
}

describe("takeRequest con puertos (TI2-181)", () => {
  test("toma una recibida: crea la toma, inicia la revisión y la registra", async () => {
    const { deps, writes } = memoryDeps([rowIn("received")]);
    expect(await take(deps)).toEqual({
      status: "ok",
      data: {
        _id: "sol-1",
        studentId: "est-1",
        status: "under_review",
        accessNeeds: "Necesidad ficticia",
        createdAt: 1,
      },
    });
    expect(writes).toEqual([
      `take sol-1 ${PROFESSIONAL}`,
      "status sol-1 under_review",
      `log received->under_review ${PROFESSIONAL} ${NOW}`,
    ]);
  });

  test.each([
    ["sin sesión", null],
    ["sin rol Profesional vigente", "est-1"],
  ])("%s responde unauthorized sin escribir", async (_, tokenIdentifier) => {
    const { deps, writes } = memoryDeps([rowIn("received")]);
    expect(await take(deps, tokenIdentifier)).toEqual(UNAUTHORIZED);
    expect(writes).toEqual([]);
  });

  test("una solicitud inexistente responde unauthorized sin escribir", async () => {
    const { deps, writes } = memoryDeps([]);
    expect(await take(deps)).toEqual(UNAUTHORIZED);
    expect(writes).toEqual([]);
  });

  test.each<PersistableRequestState>([
    "under_review",
    "awaiting_information_or_acceptance",
    "accepted",
    "cancelled",
    "closed_without_accompaniment",
  ])("en %s responde conflict sin escribir", async (status) => {
    const { deps, writes } = memoryDeps([rowIn(status)]);
    expect(await take(deps)).toEqual(conflict("Solo se pueden tomar solicitudes recibidas"));
    expect(writes).toEqual([]);
  });

  test("una recibida que ya tomó responde conflict sin escribir", async () => {
    const { deps, writes } = memoryDeps([rowIn("received")], {
      takes: [`sol-1:${PROFESSIONAL}`],
    });
    expect(await take(deps)).toEqual(conflict("Ya tomaste esta solicitud"));
    expect(writes).toEqual([]);
  });
});
