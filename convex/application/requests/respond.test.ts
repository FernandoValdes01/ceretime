import { describe, expect, test } from "vitest";
import type { RequestState } from "../../domain/requests/state";
import type { NotificationEvent } from "../../domain/notifications/notification";
import type { RequestStatusChange } from "../../domain/requests/transitions";
import type { StoredRequestRow } from "./ports";
import { respondToInformationRequest, type RespondToInformationRequestDeps } from "./respond";

/*
 * TI2-141: la respuesta del Estudiante con dobles en memoria, sin Convex.
 * Cada doble guarda lo que se escribió, así cada rechazo comprueba también
 * que no quedó ninguna escritura.
 */

const NOW = 1_700_000_000_000;
const OWNER = "est-ficticio";

type Row = StoredRequestRow<string, string>;

function memoryDeps(rows: readonly Row[], activeStudents: readonly string[] = [OWNER]) {
  const statuses: { requestId: string; change: RequestStatusChange }[] = [];
  const transitions: unknown[] = [];
  const notices: NotificationEvent[] = [];
  const deps: RespondToInformationRequestDeps<string, string> = {
    students: {
      findActiveStudent: async (tokenIdentifier) =>
        tokenIdentifier !== null && activeStudents.includes(tokenIdentifier)
          ? { _id: tokenIdentifier }
          : null,
    },
    requests: {
      getRequest: async (requestId) => rows.find((row) => row._id === requestId) ?? null,
      setRequestStatus: async (requestId, change) => {
        statuses.push({ requestId, change });
      },
      logRequestTransition: async (entry) => {
        transitions.push(entry);
      },
    },
    notifications: {
      record: async (events) => {
        notices.push(...events);
      },
    },
    now: () => NOW,
  };
  return { deps, statuses, transitions, notices };
}

function rowIn(status: RequestState, studentId = OWNER): Row {
  return { _id: "sol-1", studentId, status, accessNeeds: "Necesidad ficticia", createdAt: 1 };
}

function respond(deps: RespondToInformationRequestDeps<string, string>, response: string) {
  return respondToInformationRequest(deps, {
    tokenIdentifier: OWNER,
    requestId: "sol-1",
    response,
  });
}

const UNAUTHORIZED = {
  status: "error",
  error: { code: "unauthorized", message: "No autorizado" },
};

describe("respondToInformationRequest con puertos (TI2-141)", () => {
  test("el dueño responde: vuelve a revisión y registra la respuesta recortada", async () => {
    const { deps, statuses, transitions, notices } = memoryDeps([
      { ...rowIn("awaiting_information_or_acceptance"), takenBy: "pro-ficticio" },
    ]);

    expect(await respond(deps, "  Puedo los martes  ")).toEqual({
      status: "ok",
      data: {
        _id: "sol-1",
        studentId: OWNER,
        status: "under_review",
        accessNeeds: "Necesidad ficticia",
        createdAt: 1,
      },
    });
    expect(statuses).toEqual([{ requestId: "sol-1", change: { status: "under_review" } }]);
    expect(transitions).toEqual([
      {
        requestId: "sol-1",
        from: "awaiting_information_or_acceptance",
        to: "under_review",
        actorId: OWNER,
        reason: "Puedo los martes",
        occurredAt: NOW,
      },
    ]);
    // Quien la tomó recibe el aviso (TI2-150), que no lleva la respuesta.
    expect(notices).toEqual([
      {
        kind: "request_information_provided",
        requestId: "sol-1",
        recipientId: "pro-ficticio",
        occurredAt: NOW,
        version: "v1",
      },
    ]);
  });

  test("sin Estudiante vigente se deniega sin leer ni escribir", async () => {
    const { deps, statuses, transitions } = memoryDeps(
      [rowIn("awaiting_information_or_acceptance")],
      [],
    );
    expect(await respond(deps, "Respuesta")).toEqual(UNAUTHORIZED);
    expect(
      await respondToInformationRequest(deps, {
        tokenIdentifier: null,
        requestId: "sol-1",
        response: "Respuesta",
      }),
    ).toEqual(UNAUTHORIZED);
    expect([statuses, transitions]).toEqual([[], []]);
  });

  test("una solicitud ajena o inexistente se deniega igual, sin escribir", async () => {
    const foreign = memoryDeps([rowIn("awaiting_information_or_acceptance", "otro-est")]);
    const missing = memoryDeps([]);
    for (const { deps, statuses, transitions } of [foreign, missing]) {
      expect(await respond(deps, "Respuesta")).toEqual(UNAUTHORIZED);
      expect([statuses, transitions]).toEqual([[], []]);
    }
  });

  test.each([
    "received",
    "under_review",
    "accepted",
    "cancelled",
    "closed_without_accompaniment",
  ] as const)("desde %s responde conflict sin escribir", async (status) => {
    const { deps, statuses, transitions } = memoryDeps([rowIn(status)]);
    expect(await respond(deps, "Respuesta")).toEqual({
      status: "error",
      error: {
        code: "conflict",
        message: "La solicitud no admite una respuesta en su estado actual.",
      },
    });
    expect([statuses, transitions]).toEqual([[], []]);
  });

  test.each([
    ["   ", "Se requiere la respuesta a la información pedida."],
    ["a".repeat(2001), "La respuesta supera el máximo permitido (2000 caracteres)."],
  ])("una respuesta inválida (%#) se rechaza sin escribir", async (response, message) => {
    const { deps, statuses, transitions } = memoryDeps([
      rowIn("awaiting_information_or_acceptance"),
    ]);
    expect(await respond(deps, response)).toEqual({
      status: "error",
      error: { code: "request_fields_invalid", message },
    });
    expect([statuses, transitions]).toEqual([[], []]);
  });
});
