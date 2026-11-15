import { describe, expect, test } from "vitest";
import type { PersistableRequestState } from "../../domain/requests/state";
import { acceptRequest, requestAdditionalInformation, type AcceptRequestDeps } from "./commands";
import type { StoredRequestRow } from "./ports";

/*
 * TI2-181: pedir información y aceptar con dobles en memoria, sin Convex.
 * Cada doble anota lo que se escribió, así cada rechazo comprueba también que
 * no quedó ninguna escritura.
 */

const NOW = 1_700_000_000_000;
const PROFESSIONAL = "pro-ficticio";

type Row = StoredRequestRow<string, string>;

function memoryDeps(
  status: PersistableRequestState,
  options: { readonly taken?: boolean; readonly accepted?: boolean } = {},
) {
  const row: Row = {
    _id: "sol-1",
    studentId: "est-1",
    status,
    accessNeeds: "Necesidad ficticia",
    createdAt: 1,
  };
  const writes: string[] = [];
  const deps: AcceptRequestDeps<string, string, string> = {
    professionals: {
      findActiveProfessional: async (tokenIdentifier) =>
        tokenIdentifier === PROFESSIONAL ? { _id: PROFESSIONAL } : null,
    },
    requests: {
      getRequest: async (requestId) => (requestId === row._id ? row : null),
      hasActiveTake: async (requestId, userId) =>
        (options.taken ?? true) && requestId === row._id && userId === PROFESSIONAL,
      setRequestStatus: async (requestId, change) => {
        writes.push(`status ${requestId} ${change.status}`);
      },
      logRequestTransition: async (entry) => {
        writes.push(`log ${entry.from}->${entry.to} ${entry.reason ?? "-"} ${entry.occurredAt}`);
      },
    },
    accompaniments: {
      hasAccompanimentForRequest: async () => options.accepted ?? false,
      openAccompaniment: async (input) => {
        writes.push(`open ${input.requestId} ${input.objective} ${input.professionalId}`);
        return {
          _id: "aco-1",
          studentId: input.studentId,
          status: "active",
          objective: input.objective,
          accessNeeds: input.accessNeeds,
        };
      },
    },
    now: () => NOW,
  };
  return { deps, writes };
}

const UNAUTHORIZED = {
  status: "error",
  error: { code: "unauthorized", message: "No autorizado" },
};

function rejectedWith(code: string, message: string) {
  return { status: "error", error: { code, message } };
}

function askFor(deps: AcceptRequestDeps<string, string, string>, reason: string) {
  return requestAdditionalInformation(deps, {
    tokenIdentifier: PROFESSIONAL,
    requestId: "sol-1",
    reason,
  });
}

function accept(
  deps: AcceptRequestDeps<string, string, string>,
  objective: string,
  tokenIdentifier: string | null = PROFESSIONAL,
  requestId = "sol-1",
) {
  return acceptRequest(deps, { tokenIdentifier, requestId, objective });
}

describe("requestAdditionalInformation con puertos (TI2-181)", () => {
  test("con toma, pasa a espera y registra el motivo recortado", async () => {
    const { deps, writes } = memoryDeps("under_review");
    const result = await askFor(deps, "  Falta el horario  ");
    expect(result).toMatchObject({
      status: "ok",
      data: { status: "awaiting_information_or_acceptance" },
    });
    expect(writes).toEqual([
      "status sol-1 awaiting_information_or_acceptance",
      `log under_review->awaiting_information_or_acceptance Falta el horario ${NOW}`,
    ]);
  });

  test("sin toma responde unauthorized sin escribir", async () => {
    const { deps, writes } = memoryDeps("under_review", { taken: false });
    expect(await askFor(deps, "Motivo")).toEqual(UNAUTHORIZED);
    expect(writes).toEqual([]);
  });

  test("sin motivo responde request_fields_invalid sin escribir", async () => {
    const { deps, writes } = memoryDeps("under_review");
    expect(await askFor(deps, "  ")).toEqual(
      rejectedWith(
        "request_fields_invalid",
        "Se requiere el motivo para pedir información adicional",
      ),
    );
    expect(writes).toEqual([]);
  });

  test("fuera de revisión responde conflict sin escribir", async () => {
    const { deps, writes } = memoryDeps("accepted");
    expect(await askFor(deps, "Motivo")).toEqual(
      rejectedWith(
        "conflict",
        "La solicitud no admite pedir información adicional en su estado actual",
      ),
    );
    expect(writes).toEqual([]);
  });
});

describe("acceptRequest con puertos (TI2-181)", () => {
  test("con toma, acepta, registra y abre el acompañamiento con su asignación", async () => {
    const { deps, writes } = memoryDeps("under_review");
    expect(await accept(deps, "  Objetivo ficticio  ")).toEqual({
      status: "ok",
      data: {
        _id: "aco-1",
        studentId: "est-1",
        status: "active",
        objective: "Objetivo ficticio",
        accessNeeds: "Necesidad ficticia",
        view: "full",
      },
    });
    expect(writes).toEqual([
      "status sol-1 accepted",
      `log under_review->accepted - ${NOW}`,
      `open sol-1 Objetivo ficticio ${PROFESSIONAL}`,
    ]);
  });

  test.each([
    ["sin sesión", null, "sol-1", true],
    ["sin rol Profesional vigente", "est-1", "sol-1", true],
    ["una solicitud inexistente", PROFESSIONAL, "sol-2", true],
    ["sin toma", PROFESSIONAL, "sol-1", false],
  ])("%s responde unauthorized sin escribir", async (_, tokenIdentifier, requestId, taken) => {
    const { deps, writes } = memoryDeps("under_review", { taken });
    expect(await accept(deps, "Objetivo", tokenIdentifier, requestId)).toEqual(UNAUTHORIZED);
    expect(writes).toEqual([]);
  });

  test("una solicitud ya aceptada responde conflict sin escribir", async () => {
    const { deps, writes } = memoryDeps("accepted", { accepted: true });
    expect(await accept(deps, "Objetivo")).toEqual(
      rejectedWith("conflict", "La solicitud ya fue aceptada"),
    );
    expect(writes).toEqual([]);
  });

  test("un estado que no admite aceptar responde conflict sin escribir", async () => {
    const { deps, writes } = memoryDeps("closed_without_accompaniment");
    expect(await accept(deps, "Objetivo")).toEqual(
      rejectedWith("conflict", "La solicitud no admite la aceptación en su estado actual"),
    );
    expect(writes).toEqual([]);
  });

  test("sin objetivo responde request_fields_invalid sin escribir", async () => {
    const { deps, writes } = memoryDeps("under_review");
    expect(await accept(deps, "  ")).toEqual(
      rejectedWith(
        "request_fields_invalid",
        "Se requiere el objetivo para abrir el acompañamiento",
      ),
    );
    expect(writes).toEqual([]);
  });
});
