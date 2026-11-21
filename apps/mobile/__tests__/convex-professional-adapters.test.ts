import { getFunctionName } from "convex/server";

import { api } from "../../../convex/_generated/api";
import { UserFacingError } from "../src/application/user-facing-error";
import { createConvexProfessionalAccompanimentReader } from "../src/infrastructure/convex-professional-accompaniment-reader";
import { createConvexProfessionalReviewAdapter } from "../src/infrastructure/convex-professional-review-adapter";

const createdAt = Date.UTC(2026, 10, 20, 12);

function request(id: string, status: string, extra: Record<string, unknown> = {}) {
  return { _id: id, _creationTime: createdAt, studentId: "users:1", status, createdAt, ...extra };
}

function page<Item>(items: Item[], isDone = true, continueCursor = "") {
  return { page: items, isDone, continueCursor };
}

const fullAccompaniment = {
  _id: "accompaniments:1",
  studentId: "users:1",
  status: "active",
  objective: "Apoyo en evaluaciones",
  accessNeeds: "Tiempo adicional",
  referenceCode: "CER-7KQ2-M9XD",
  requestId: "requests:2",
  view: "full",
};

function setup() {
  const query = jest.fn();
  const mutation = jest.fn();
  const client = { query, mutation } as never;
  return {
    query,
    mutation,
    review: createConvexProfessionalReviewAdapter(client),
    accompaniments: createConvexProfessionalAccompanimentReader(client),
  };
}

describe("bandeja del Profesional", () => {
  test("junta las solicitudes abiertas y las tomadas, recorriendo todas las páginas", async () => {
    const { query, review } = setup();
    query.mockImplementation(async (fn, args: { paginationOpts: { cursor: string | null } }) => {
      if (getFunctionName(fn) === getFunctionName(api.presentation.requests.listOpenRequests)) {
        return args.paginationOpts.cursor === null
          ? page([request("requests:1", "received")], false, "c1")
          : page([request("requests:3", "received")]);
      }
      return page([request("requests:2", "under_review", { accessNeeds: "Intérprete" })]);
    });

    const requests = await review.readProfessionalRequests();

    expect(
      requests.map(({ id, status, availableActions }) => ({ id, status, availableActions })),
    ).toEqual([
      { id: "requests:1", status: "received", availableActions: ["startReview"] },
      { id: "requests:3", status: "received", availableActions: ["startReview"] },
      {
        id: "requests:2",
        status: "underReview",
        availableActions: ["requestInformation", "accept"],
      },
    ]);
  });

  test("tomar una solicitud usa takeRequest y devuelve el estado del servidor", async () => {
    const { mutation, review } = setup();
    mutation.mockResolvedValue(request("requests:1", "under_review", { accessNeeds: "x" }));

    const receipt = await review.performProfessionalRequestAction("requests:1", "startReview");

    expect(mutation).toHaveBeenCalledWith(api.presentation.requests.takeRequest, {
      requestId: "requests:1",
    });
    expect(receipt.request.status).toBe("underReview");
  });

  test("pedir información envía el motivo recortado", async () => {
    const { mutation, review } = setup();
    mutation.mockResolvedValue(
      request("requests:2", "awaiting_information_or_acceptance", { accessNeeds: "x" }),
    );

    const receipt = await review.performProfessionalRequestAction(
      "requests:2",
      "requestInformation",
      {
        reason: "  ¿Qué horarios tienes?  ",
      },
    );

    expect(mutation).toHaveBeenCalledWith(api.presentation.requests.requestAdditionalInformation, {
      requestId: "requests:2",
      reason: "¿Qué horarios tienes?",
    });
    expect(receipt.request.availableActions).toEqual(["accept"]);
  });

  test("aceptar abre un acompañamiento y relee la solicitud aceptada", async () => {
    const { query, mutation, review } = setup();
    mutation.mockResolvedValue(fullAccompaniment);
    query.mockResolvedValue(request("requests:2", "accepted", { accessNeeds: "x" }));

    const receipt = await review.performProfessionalRequestAction("requests:2", "accept", {
      objective: "Apoyo en evaluaciones",
    });

    expect(mutation).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(api.presentation.requests.getRequest, {
      requestId: "requests:2",
    });
    expect(receipt.request).toMatchObject({
      status: "accepted",
      availableActions: [],
      accompaniment: { id: "accompaniments:1", requestId: "requests:2" },
    });
  });

  test("sin motivo u objetivo no llama al servidor", async () => {
    const { mutation, review } = setup();

    await expect(
      review.performProfessionalRequestAction("requests:2", "accept", { objective: " " }),
    ).rejects.toBeInstanceOf(UserFacingError);
    expect(mutation).not.toHaveBeenCalled();
  });

  test("un rechazo del servidor se propaga sin anunciar éxito", async () => {
    const { mutation, review } = setup();
    const conflict = Object.assign(new Error("conflict"), { data: { code: "conflict" } });
    mutation.mockRejectedValue(conflict);

    await expect(review.performProfessionalRequestAction("requests:1", "startReview")).rejects.toBe(
      conflict,
    );
  });
});

describe("acompañamientos del Profesional", () => {
  test("lista los asignados siguiendo el cursor del servidor", async () => {
    const { query, accompaniments } = setup();
    query
      .mockResolvedValueOnce({
        items: [fullAccompaniment],
        hasMore: true,
        lastId: "accompaniments:1",
      })
      .mockResolvedValueOnce({
        items: [
          {
            _id: "accompaniments:2",
            status: "paused",
            objective: "Seguimiento",
            view: "minimized",
          },
        ],
        hasMore: false,
        lastId: "accompaniments:2",
      });

    await expect(accompaniments.readAccompaniments()).resolves.toEqual([
      {
        id: "accompaniments:1",
        studentName: "Estudiante CER-7KQ2-M9XD",
        objective: "Apoyo en evaluaciones",
        status: "active",
      },
      {
        id: "accompaniments:2",
        studentName: "Estudiante",
        objective: "Seguimiento",
        status: "paused",
      },
    ]);
    expect(query).toHaveBeenLastCalledWith(
      api.presentation.accompaniments.listAssignedAccompaniments,
      { limit: 50, after: "accompaniments:1" },
    );
  });

  test("el detalle usa getAccompaniment y propaga la denegación del servidor", async () => {
    const { query, accompaniments } = setup();
    query.mockResolvedValueOnce(fullAccompaniment);
    await expect(accompaniments.readAccompaniment("accompaniments:1")).resolves.toMatchObject({
      id: "accompaniments:1",
    });

    const denied = Object.assign(new Error("No autorizado"), { data: { code: "unauthorized" } });
    query.mockRejectedValueOnce(denied);
    await expect(accompaniments.readAccompaniment("accompaniments:9")).rejects.toBe(denied);
  });
});
