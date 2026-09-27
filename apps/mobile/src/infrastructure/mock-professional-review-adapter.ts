import type {
  ProfessionalRequest,
  ProfessionalRequestAction,
  ProfessionalRequestActionReceipt,
} from "../application/professional-review-models";
import type { ProfessionalReviewPort } from "../application/professional-review-port";
import type { MockProfessionalAccompanimentStore } from "./mock-professional-accompaniment-data";
import { fictionalProfessionalRequests } from "./mock-professional-review-data";

export type MockProfessionalReviewMode = "success" | "error";

export interface MockProfessionalReviewAdapterOptions {
  readonly delayMs?: number;
  readonly readMode?: MockProfessionalReviewMode;
  readonly actionMode?: MockProfessionalReviewMode;
  readonly accompanimentStore?: MockProfessionalAccompanimentStore;
}

function updateRequest(
  request: ProfessionalRequest,
  action: ProfessionalRequestAction,
  onAccompanimentAccepted?: MockProfessionalAccompanimentStore["add"],
): ProfessionalRequestActionReceipt {
  if (action === "startReview" && request.status === "received") {
    const updatedRequest: ProfessionalRequest = {
      ...request,
      status: "underReview",
      updatedAt: "2026-09-18T09:00:00.000Z",
      availableActions: ["requestInformation"],
    };
    return {
      action,
      request: updatedRequest,
      message: "La solicitud quedó en revisión.",
    };
  }

  if (action === "requestInformation" && request.status === "underReview") {
    const updatedRequest: ProfessionalRequest = {
      ...request,
      status: "awaitingInformationOrAcceptance",
      updatedAt: "2026-09-18T09:00:00.000Z",
      availableActions: [],
    };
    return {
      action,
      request: updatedRequest,
      message: "La solicitud quedó esperando información.",
    };
  }

  if (action === "accept" && request.status === "awaitingInformationOrAcceptance") {
    const accompaniment = {
      id: `ACO-${request.id}`,
      studentName: request.studentName,
      objective: request.needSummary,
      status: "active" as const,
    };
    const updatedRequest: ProfessionalRequest = {
      ...request,
      status: "accepted",
      updatedAt: "2026-09-18T09:00:00.000Z",
      availableActions: [],
      accompaniment: {
        id: accompaniment.id,
        requestId: request.id,
        status: accompaniment.status,
        createdAt: "2026-09-18T09:00:00.000Z",
      },
    };
    onAccompanimentAccepted?.(accompaniment);
    return {
      action,
      request: updatedRequest,
      message: "La solicitud fue aceptada y abrió un acompañamiento.",
    };
  }

  throw new Error("Esta acción no está disponible para la solicitud seleccionada.");
}

export function createMockProfessionalReviewAdapter({
  delayMs = 0,
  readMode = "success",
  actionMode = "success",
  accompanimentStore,
}: MockProfessionalReviewAdapterOptions = {}): ProfessionalReviewPort {
  let requests = fictionalProfessionalRequests.map((request) => ({ ...request }));

  async function waitIfNeeded() {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return {
    async readProfessionalRequests() {
      await waitIfNeeded();
      if (readMode === "error") {
        throw new Error("No pudimos cargar las solicitudes del Profesional.");
      }
      return requests;
    },
    async performProfessionalRequestAction(requestId, action) {
      await waitIfNeeded();
      if (actionMode === "error") {
        throw new Error("No pudimos actualizar la solicitud. Intenta nuevamente.");
      }

      const request = requests.find((candidate) => candidate.id === requestId);
      if (!request) {
        throw new Error("No encontramos la solicitud seleccionada.");
      }

      const receipt = updateRequest(request, action, accompanimentStore?.add);
      requests = requests.map((candidate) =>
        candidate.id === requestId ? receipt.request : candidate,
      );
      return receipt;
    },
  };
}
