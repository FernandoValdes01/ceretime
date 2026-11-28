import { studentRequestSubmissionMessages } from "../src/presentation/estudiante/student-request-submission-messages";
import { ConvexError } from "convex/values";
import { getFunctionName, type FunctionReference } from "convex/server";

import {
  StudentOperationError,
  StudentRequestActionError,
} from "../src/application/student-area-port";
import type { SubmitStudentRequestCommand } from "../src/domain/student-area-models";
import {
  createConvexStudentAreaReader,
  notifyStudentAreaChanged,
} from "../src/infrastructure/convex-student-area-reader";
import { createConvexStudentRequestSubmitter } from "../src/infrastructure/convex-student-request-submitter";

const student = { id: "users:student-1", displayName: "Ana Pérez", email: "ana@alu.uct.cl" };

function requestRow(id: string, status = "received", extra: Record<string, unknown> = {}) {
  return {
    _id: id,
    studentId: "users:student-1",
    status,
    accessNeeds: "Comunicación escrita",
    createdAt: Date.parse("2026-11-20T15:00:00.000Z"),
    ...extra,
  };
}

type Handler = (args: Record<string, unknown>) => unknown;

/** Cliente doble: responde por nombre de función y registra cada llamada. */
function fakeClient(handlers: Record<string, Handler>) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const run = async (
    reference: FunctionReference<"query" | "mutation", "public">,
    args: unknown,
  ) => {
    const name = getFunctionName(reference);
    const handler = handlers[name];
    if (!handler) throw new Error(`Sin respuesta para ${name}`);
    calls.push({ name, args: args as Record<string, unknown> });
    return handler(args as Record<string, unknown>);
  };
  return { calls, client: { query: run, mutation: run } as never };
}

const command: SubmitStudentRequestCommand = {
  needSummary: "Participar en clases",
  expectedOutcome: "Acordar apoyos",
  accessNeeds: [{ id: "written-communication", label: "Comunicación escrita" }],
  otherAccessNeed: "Material digital",
  generalAvailability: { preferredWeekdays: [1, 3] },
  modalityPreference: "online",
  preferredAccessibleInformationChannel: "Correo accesible",
};

describe("lector estudiantil sobre Convex", () => {
  it("recorre todas las páginas aunque una venga vacía y trae el intercambio de cada solicitud", async () => {
    const { client, calls } = fakeClient({
      "presentation/requests:listOwnRequests": ({ paginationOpts }) =>
        (paginationOpts as { cursor: string | null }).cursor === null
          ? { page: [], isDone: false, continueCursor: "c1" }
          : {
              page: [requestRow("requests:1", "awaiting_information_or_acceptance")],
              isDone: true,
              continueCursor: "c2",
            },
      "presentation/requests:getRequest": () =>
        requestRow("requests:1", "awaiting_information_or_acceptance", {
          informationRequest: "¿Qué horario te sirve?",
        }),
      "presentation/accompaniments:listOwnedAccompaniments": () => ({
        page: [],
        isDone: true,
        continueCursor: "",
      }),
    });

    const snapshot = await createConvexStudentAreaReader({ client, student }).readStudentArea();

    expect(snapshot.student).toEqual(student);
    expect(snapshot.requests).toHaveLength(1);
    expect(snapshot.requests[0]).toMatchObject({
      id: "requests:1",
      status: "awaitingInformationOrAcceptance",
      informationRequest: "¿Qué horario te sirve?",
    });
    expect(calls.filter(({ name }) => name.endsWith("listOwnRequests"))).toHaveLength(2);
  });

  it("pide los detalles de a cinco como máximo y conserva el orden del listado", async () => {
    const ids = Array.from({ length: 12 }, (_, index) => `requests:${index}`);
    let inFlight = 0;
    let maxInFlight = 0;
    const { client } = fakeClient({
      "presentation/requests:listOwnRequests": () => ({
        page: ids.map((id) => requestRow(id)),
        isDone: true,
        continueCursor: "",
      }),
      "presentation/requests:getRequest": async ({ requestId }) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return requestRow(requestId as string);
      },
      "presentation/accompaniments:listOwnedAccompaniments": () => ({
        page: [],
        isDone: true,
        continueCursor: "",
      }),
    });

    const snapshot = await createConvexStudentAreaReader({ client, student }).readStudentArea();

    expect(maxInFlight).toBe(5);
    expect(snapshot.requests.map(({ id }) => id)).toEqual(ids);
  });

  it("falla sin éxito parcial cuando el servidor deniega el acceso", async () => {
    const { client } = fakeClient({
      "presentation/requests:listOwnRequests": () => {
        throw new ConvexError({ code: "unauthorized", message: "No autorizado" });
      },
      "presentation/accompaniments:listOwnedAccompaniments": () => ({
        page: [],
        isDone: true,
        continueCursor: "",
      }),
    });

    await expect(
      createConvexStudentAreaReader({ client, student }).readStudentArea(),
    ).rejects.toMatchObject({ operation: "listOwnRequests", code: "unauthorized" });
  });

  it("informa acceso denegado, no un fallo genérico, si un acompañamiento llega minimizado", async () => {
    const { client } = fakeClient({
      "presentation/requests:listOwnRequests": () => ({
        page: [],
        isDone: true,
        continueCursor: "",
      }),
      "presentation/accompaniments:listOwnedAccompaniments": () => ({
        page: [{ _id: "accompaniments:1", status: "active", view: "minimized" }],
        isDone: true,
        continueCursor: "",
      }),
    });

    await expect(
      createConvexStudentAreaReader({ client, student }).readStudentArea(),
    ).rejects.toMatchObject({ operation: "listOwnedAccompaniments", code: "unauthorized" });
  });

  it("no muestra el mensaje interno del SDK ante un fallo inesperado", async () => {
    const { client } = fakeClient({
      "presentation/requests:listOwnRequests": () => {
        throw new Error(
          "[CONVEX Q(presentation/requests:listOwnRequests)] Server Error stack interno",
        );
      },
      "presentation/accompaniments:listOwnedAccompaniments": () => ({
        page: [],
        isDone: true,
        continueCursor: "",
      }),
    });

    const error = await createConvexStudentAreaReader({ client, student })
      .readStudentArea()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(StudentOperationError);
    expect((error as Error).message).not.toContain("stack interno");
  });

  it("avisa a los suscriptores cuando otro adaptador cambia el área", async () => {
    const { client } = fakeClient({});
    const reader = createConvexStudentAreaReader({ client, student });
    const onChange = jest.fn();
    const unsubscribe = reader.subscribe?.(onChange);

    notifyStudentAreaChanged();
    unsubscribe?.();
    notifyStudentAreaChanged();

    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("envío y acciones estudiantiles sobre Convex", () => {
  it("envía la forma completa sin clave de idempotencia, que el servidor ya no acepta", async () => {
    const { client, calls } = fakeClient({
      "presentation/requests:createRequest": () => requestRow("requests:7"),
    });
    const submitter = createConvexStudentRequestSubmitter({ client });

    const receipt = await submitter.submitStudentRequest(command);

    expect(receipt).toEqual({ requestId: "requests:7", receivedAt: "2026-11-20T15:00:00.000Z" });
    expect(calls[0]?.args).toMatchObject({
      needSummary: "Participar en clases",
      accessNeeds: [{ id: "written-communication", label: "Comunicación escrita" }],
      modalityPreference: "online",
    });
    // TI2-165 retiró `idempotencyKey` de createRequest: el validador rechaza cualquier campo extra.
    expect(calls[0]?.args).not.toHaveProperty("idempotencyKey");
  });

  it("un fallo de red al enviar no se presenta como éxito", async () => {
    const { client } = fakeClient({
      "presentation/requests:createRequest": () => {
        throw Object.assign(new Error("Network request failed"), { code: "network_error" });
      },
    });

    await expect(
      createConvexStudentRequestSubmitter({ client }).submitStudentRequest(command),
    ).rejects.toMatchObject({ operation: "createRequest", code: "unavailable" });
  });

  it("traduce el rechazo del servidor sin confirmar un éxito", async () => {
    const { client } = fakeClient({
      "presentation/requests:createRequest": () => {
        throw new ConvexError({ code: "unauthorized", message: "No autorizado" });
      },
    });
    const submitter = createConvexStudentRequestSubmitter({ client });

    await expect(submitter.submitStudentRequest(command)).rejects.toMatchObject({
      operation: "createRequest",
      code: "unauthorized",
    });
  });

  it("cancela y responde con el estado que devuelve el servidor", async () => {
    const { client, calls } = fakeClient({
      "presentation/requests:cancelRequest": () => requestRow("requests:1", "cancelled"),
      "presentation/requests:respondToInformationRequest": () =>
        requestRow("requests:2", "under_review"),
    });
    const actions = createConvexStudentRequestSubmitter({ client }).requestActions;

    const cancelled = await actions.execute({
      kind: "cancelRequest",
      requestId: "requests:1",
      reason: "Ya no la necesito",
    });
    const responded = await actions.execute({
      kind: "respondToInformationRequest",
      requestId: "requests:2",
      response: "Martes por la tarde",
    });

    // Solo se informa lo que el servidor devolvió; el texto enviado no se presenta como persistido.
    expect(cancelled).toMatchObject({ status: "cancelled" });
    expect(cancelled.closureReason).toBeUndefined();
    expect(responded).toMatchObject({ status: "underReview" });
    expect(responded.informationResponse).toBeUndefined();
    expect(calls[0]?.args).toEqual({ requestId: "requests:1", reason: "Ya no la necesito" });
  });

  it("responder una información que ya no se espera llega como conflicto", async () => {
    const { client } = fakeClient({
      "presentation/requests:respondToInformationRequest": () => {
        throw new ConvexError({ code: "conflict", message: "conflicto" });
      },
    });
    const actions = createConvexStudentRequestSubmitter({ client }).requestActions;

    await expect(
      actions.execute({
        kind: "respondToInformationRequest",
        requestId: "requests:2",
        response: "Martes",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it.each([
    ["conflict", "conflict"],
    ["unauthorized", "unauthorized"],
    ["request_fields_invalid", "invalid"],
  ] as const)("el código %s del servidor llega como %s", async (serverCode, expected) => {
    const { client } = fakeClient({
      "presentation/requests:cancelRequest": () => {
        throw new ConvexError({ code: serverCode, message: "detalle público" });
      },
    });
    const actions = createConvexStudentRequestSubmitter({ client }).requestActions;

    const error = await actions
      .execute({ kind: "cancelRequest", requestId: "requests:1", reason: "x" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(StudentRequestActionError);
    expect(error).toMatchObject({ code: expected });
  });

  it("no expone el mensaje del SDK ante una acción con fallo desconocido", async () => {
    const { client } = fakeClient({
      "presentation/requests:cancelRequest": () => {
        throw new Error("[CONVEX M(presentation/requests:cancelRequest)] Server Error interno");
      },
    });
    const actions = createConvexStudentRequestSubmitter({ client }).requestActions;

    const error = await actions
      .execute({ kind: "cancelRequest", requestId: "requests:1", reason: "x" })
      .catch((caught: unknown) => caught);

    expect((error as Error).message).not.toContain("interno");
  });
});

describe("textos del envío según el adaptador", () => {
  it("el envío real no se presenta como simulación y el demo sí", () => {
    const { client } = fakeClient({});
    expect(createConvexStudentRequestSubmitter({ client }).persistsToServer).toBe(true);
    expect(studentRequestSubmissionMessages(false).success).toBe("Solicitud enviada.");
    expect(studentRequestSubmissionMessages(true).success).toBe("Solicitud ficticia enviada.");
  });
});
