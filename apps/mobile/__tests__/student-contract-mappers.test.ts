import { ConvexError } from "convex/values";
import { BaseConvexClient } from "convex/browser";
import {
  PROVISIONAL_STUDENT_REQUEST_OPERATIONS,
  StudentOperationError,
  type StudentPublicOperation,
  type StudentQueries,
} from "../src/application/student-area-port";
import { ACCESS_NEEDS_MAX_LENGTH } from "../../../convex/domain/requests/request";
import type { SubmitStudentRequestCommand } from "../src/domain/student-area-models";
import {
  demoStudentAreaResponses,
  demoStudentContractExamples,
} from "../src/infrastructure/demo-student-area-data";
import {
  mapCreatedRequestToReceipt,
  mapStudentSubmissionToCreateRequest,
  mapStudentRequestsPage,
  mapStudentRequestDetail,
  mapStudentAccompanimentsPage,
  mapStudentAccompanimentDetail,
  toStudentOperationError,
  type StudentContractResponse,
} from "../src/infrastructure/student-contract-mappers";
import {
  isMobileAccessDenied,
  toMobileOperationError,
} from "../src/presentation/to-mobile-operation-error";

const command: SubmitStudentRequestCommand = {
  needSummary: "Participar en clases",
  expectedOutcome: "Acordar apoyos",
  accessNeeds: [{ id: "written", label: "  Comunicación escrita  " }],
  otherAccessNeed: "  Material digital  ",
  generalAvailability: { preferredWeekdays: [1, 3] },
  modalityPreference: "online",
  preferredAccessibleInformationChannel: "Correo accesible",
};

const operations: readonly StudentPublicOperation[] = [
  "createRequest",
  "listOwnRequests",
  "getRequest",
  "listOwnedAccompaniments",
  "getAccompaniment",
];

describe("contratos locales del módulo estudiantil TI4-76", () => {
  it("convierte los estados públicos y no atribuye campos locales al servidor", () => {
    const states = {
      received: "received",
      under_review: "underReview",
      awaiting_information_or_acceptance: "awaitingInformationOrAcceptance",
      accepted: "accepted",
      referred: "referred",
      closed_without_accompaniment: "closedWithoutAccompaniment",
      cancelled: "cancelled",
    } as const;
    const response = structuredClone(demoStudentContractExamples.listOwnRequests.response);
    const original = structuredClone(response);
    const result = mapStudentRequestsPage(response);

    expect(result.page).toHaveLength(response.page.length);
    response.page.forEach((item, index) => {
      expect(result.page[index]).toEqual({
        id: item._id,
        status: states[item.status],
        accessNeeds: item.accessNeeds,
        createdAt: new Date(item.createdAt).toISOString(),
      });
    });
    // Los ejemplos locales cubren los cuatro estados abiertos o aceptados.
    expect(new Set(result.page.map((item) => item.status))).toEqual(
      new Set(["received", "underReview", "awaitingInformationOrAcceptance", "accepted"]),
    );
    expect(response).toEqual(original);
  });

  it("conserva la continuación y la división de una página vacía todavía incompleta", () => {
    const response = {
      page: [],
      isDone: false,
      continueCursor: "opaque-next",
      splitCursor: "opaque-split",
      pageStatus: "SplitRequired",
    } satisfies StudentContractResponse<"listOwnRequests">;
    expect(mapStudentRequestsPage(response)).toEqual(response);
    expect(mapStudentAccompanimentsPage(response)).toEqual(response);
  });

  it("distingue el fin sin datos de una página pendiente", () => {
    const response = {
      page: [],
      isDone: true,
      continueCursor: "",
      splitCursor: null,
      pageStatus: null,
    };
    expect(mapStudentRequestsPage(response)).toEqual(response);
    expect(mapStudentAccompanimentsPage(response)).toEqual(response);
  });

  it("usa la misma proyección para el detalle y el listado de solicitudes", () => {
    const detail = demoStudentContractExamples.getRequest.response;
    expect(mapStudentRequestDetail(detail)).toEqual(
      mapStudentRequestsPage(demoStudentContractExamples.listOwnRequests.response).page[0],
    );
    expect(mapStudentRequestDetail(detail)).not.toHaveProperty("studentId");
  });

  it("conserva los estados y solo los campos públicos de los acompañamientos", () => {
    const response = demoStudentContractExamples.getAccompaniment.response;
    if (response.view !== "full") throw new Error("El ejemplo debe ser completo");

    for (const status of ["active", "paused", "closed"] as const) {
      expect(mapStudentAccompanimentDetail({ ...response, status })).toEqual({
        id: response._id,
        status,
        objective: response.objective,
        accessNeeds: response.accessNeeds,
        view: "full",
      });
    }
    expect(
      mapStudentAccompanimentsPage(demoStudentContractExamples.listOwnedAccompaniments.response)
        .page[0],
    ).toEqual(mapStudentAccompanimentDetail(response));
  });

  it("rechaza vistas minimizadas sin entregar una página de éxito parcial", () => {
    const full = demoStudentAreaResponses.accompaniments[0];
    const minimized: StudentContractResponse<"getAccompaniment"> = {
      _id: full._id,
      status: full.status,
      objective: "Objetivo que no debe mostrarse",
      view: "minimized",
    };
    expect(() => mapStudentAccompanimentDetail(minimized)).toThrow(
      new StudentOperationError("getAccompaniment", "unauthorized", "No autorizado"),
    );
    expect(() =>
      mapStudentAccompanimentsPage({
        page: [full, minimized],
        isDone: true,
        continueCursor: "",
      }),
    ).toThrow(
      new StudentOperationError("listOwnedAccompaniments", "unauthorized", "No autorizado"),
    );
  });

  it("envía solo lo publicado y hace explícito el contenido aún local sin alterar el formulario", () => {
    const original = structuredClone(command);
    const mapped = mapStudentSubmissionToCreateRequest(command);
    expect(mapped).toEqual({
      args: { accessNeeds: "Comunicación escrita\nMaterial digital" },
      omittedFields: [
        "needSummary",
        "expectedOutcome",
        "generalAvailability",
        "modalityPreference",
        "preferredAccessibleInformationChannel",
      ],
    });
    expect(command).toEqual(original);
    const created = demoStudentContractExamples.createRequest.response;
    expect(mapCreatedRequestToReceipt(created)).toEqual({
      requestId: created._id,
      receivedAt: new Date(created.createdAt).toISOString(),
    });
  });

  it("acepta el límite exacto y rechaza vacío y exceso sin truncar lo declarado", () => {
    const input = {
      ...command,
      accessNeeds: [],
      otherAccessNeed: "a".repeat(ACCESS_NEEDS_MAX_LENGTH),
    };
    expect(mapStudentSubmissionToCreateRequest(input).args.accessNeeds).toHaveLength(
      ACCESS_NEEDS_MAX_LENGTH,
    );
    expect(() =>
      mapStudentSubmissionToCreateRequest({ ...input, otherAccessNeed: " \n " }),
    ).toThrow("Se requiere describir la necesidad de acceso");
    expect(() =>
      mapStudentSubmissionToCreateRequest({
        ...input,
        otherAccessNeed: `${input.otherAccessNeed}a`,
      }),
    ).toThrow(
      `La necesidad de acceso supera el máximo permitido (${ACCESS_NEEDS_MAX_LENGTH} caracteres)`,
    );
  });

  it.each(operations)(
    "distingue denegación de vacío en %s y conserva la compatibilidad de presentación",
    (operation) => {
      const error = toStudentOperationError(new ConvexError("No autorizado"), operation);
      expect(error).toBeInstanceOf(StudentOperationError);
      expect(error.code).toBe("unauthorized");
      expect(error.operation).toBe(operation);
      expect(error.message).toBe("No autorizado");
      expect(isMobileAccessDenied(error)).toBe(true);
      expect(toMobileOperationError(error, "Mensaje de respaldo")).toBe(error);
      expect(toStudentOperationError(error, operation)).toBe(error);
    },
  );

  it.each([
    ["Se requiere describir la necesidad de acceso", "access_needs_empty"],
    [
      `La necesidad de acceso supera el máximo permitido (${ACCESS_NEEDS_MAX_LENGTH} caracteres)`,
      "access_needs_too_long",
    ],
  ])("clasifica el rechazo de createRequest: %s", (message, code) => {
    const error = toStudentOperationError(new Error(message), "createRequest");
    expect(error.code).toBe(code);
    expect(toStudentOperationError(new Error(message), "getRequest").code).toBe("unavailable");
  });

  it.each([
    ["Se requiere describir la necesidad de acceso", "access_needs_empty"],
    [
      `La necesidad de acceso supera el máximo permitido (${ACCESS_NEEDS_MAX_LENGTH} caracteres)`,
      "access_needs_too_long",
    ],
  ])("clasifica el rechazo envuelto por el cliente Convex: %s", async (message, code) => {
    // Ejecuta el envoltorio real del cliente con una respuesta fallida, sin abrir una conexión.
    const error = await BaseConvexClient.prototype.mutation
      .call(
        {
          mutationInternal: async () => ({
            success: false,
            errorMessage: `[Request ID: demo] Server Error\nUncaught Error: ${message}\n    at registerRequest (convex/application/requests/commands.ts:62:10)\n`,
            logLines: [],
          }),
        },
        "presentation/requests:createRequest",
      )
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(Error);
    const mapped = toStudentOperationError(error, "createRequest");
    expect(mapped.code).toBe(code);
    expect(mapped.message).not.toMatch(/CONVEX|Request ID|registerRequest|commands\.ts/);
    expect(toStudentOperationError(error, "getRequest").code).toBe("unavailable");
  });

  it("no clasifica coincidencias parciales ni errores de otra operación como rechazos conocidos", () => {
    const message = "Se requiere describir la necesidad de acceso";
    for (const input of [
      new Error(`Fallo interno: ${message}`),
      new Error(
        `[CONVEX M(presentation/requests:createRequest)] Uncaught Error: ${message} secreto`,
      ),
      new Error(`[CONVEX M(presentation/requests:takeRequest)] Uncaught Error: ${message}`),
      new Error(`[CONVEX M(presentation/requests:createRequest)] Server Error`),
    ]) {
      const error = toStudentOperationError(input, "createRequest");
      expect(error.code).toBe("unavailable");
      expect(error.message).toBe("No pudimos enviar tu solicitud. Intenta nuevamente.");
    }
  });

  it.each(operations)("oculta errores internos y datos sensibles en %s", (operation) => {
    for (const input of [
      new Error("Error interno con necesidades y token secreto"),
      new ConvexError({ code: "INTERNAL", message: "Token secreto", studentId: "otra-cuenta" }),
      {
        data: {
          code: "unauthorized",
          message: "Solicitud ajena existente",
          studentId: "otra-cuenta",
        },
      },
      null,
    ]) {
      const error = toStudentOperationError(input, operation);
      expect(error.message).not.toMatch(/secreto|ajena|otra-cuenta/);
      expect(error).not.toHaveProperty("data");
      expect(error).not.toHaveProperty("cause");
    }
  });

  it("entrega un puerto implementable con ejemplos locales sin cliente Convex", async () => {
    const queries: StudentQueries = {
      listOwnRequests: async () =>
        mapStudentRequestsPage(demoStudentContractExamples.listOwnRequests.response),
      getRequest: async () =>
        mapStudentRequestDetail(demoStudentContractExamples.getRequest.response),
      listOwnedAccompaniments: async () =>
        mapStudentAccompanimentsPage(demoStudentContractExamples.listOwnedAccompaniments.response),
      getAccompaniment: async () =>
        mapStudentAccompanimentDetail(demoStudentContractExamples.getAccompaniment.response),
    };
    const page = await queries.listOwnRequests({ numItems: 5, cursor: null });
    expect(await queries.getRequest(page.page[0].id)).toEqual(page.page[0]);
    const accompaniments = await queries.listOwnedAccompaniments({ numItems: 5, cursor: null });
    expect(await queries.getAccompaniment(accompaniments.page[0].id)).toEqual(
      accompaniments.page[0],
    );
    expect(PROVISIONAL_STUDENT_REQUEST_OPERATIONS.cancelRequest.status).toBe("provisional");
    expect(PROVISIONAL_STUDENT_REQUEST_OPERATIONS.cancelRequest.reference).toContain(
      "commands.ts#cancelRequest",
    );
    expect(PROVISIONAL_STUDENT_REQUEST_OPERATIONS.respondToInformationRequest.reference).toContain(
      "TI2-141",
    );
    expect(queries).not.toHaveProperty("cancelRequest");
    expect(queries).not.toHaveProperty("respondToInformationRequest");
  });
});
