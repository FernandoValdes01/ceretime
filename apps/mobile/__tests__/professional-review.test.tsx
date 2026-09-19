import { createMockProfessionalReviewAdapter } from "../src/infrastructure/mock-professional-review-adapter";

describe("adaptador de revisión profesional", () => {
  it("expone solo las acciones permitidas y actualiza el estado", async () => {
    const adapter = createMockProfessionalReviewAdapter();

    const requests = await adapter.readProfessionalRequests();
    expect(requests[0]?.availableActions).toEqual(["startReview"]);
    expect(requests[1]?.availableActions).toEqual(["requestInformation"]);
    expect(requests[2]?.availableActions).toEqual([]);

    const reviewReceipt = await adapter.performProfessionalRequestAction(
      "SOL-PRO-001",
      "startReview",
    );
    expect(reviewReceipt.request.status).toBe("underReview");
    expect(reviewReceipt.message).toBe("La solicitud quedó en revisión.");

    const informationReceipt = await adapter.performProfessionalRequestAction(
      "SOL-PRO-002",
      "requestInformation",
    );
    expect(informationReceipt.request.status).toBe("awaitingInformationOrAcceptance");
  });

  it("rechaza una acción que no corresponde al estado actual", async () => {
    const adapter = createMockProfessionalReviewAdapter();

    await expect(
      adapter.performProfessionalRequestAction("SOL-PRO-003", "startReview"),
    ).rejects.toThrow("Esta acción no está disponible");
  });

  it("permite simular errores de carga y de acción", async () => {
    const readErrorAdapter = createMockProfessionalReviewAdapter({ readMode: "error" });
    const actionErrorAdapter = createMockProfessionalReviewAdapter({ actionMode: "error" });

    await expect(readErrorAdapter.readProfessionalRequests()).rejects.toThrow(
      "No pudimos cargar las solicitudes",
    );
    await expect(
      actionErrorAdapter.performProfessionalRequestAction("SOL-PRO-001", "startReview"),
    ).rejects.toThrow("No pudimos actualizar la solicitud");
  });
});
