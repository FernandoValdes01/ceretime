import type { Id } from "../../../../convex/_generated/dataModel";

import type {
  ProfessionalActionDetails,
  ProfessionalRequest,
  ProfessionalRequestAction,
  ProfessionalRequestActionReceipt,
} from "../application/professional-review-models";
import type { ProfessionalReviewPort } from "../application/professional-review-port";
import type { MockProfessionalAccompanimentStore } from "./mock-professional-accompaniment-data";
import type {
  CanonicalAcceptedAccompaniment,
  CanonicalInformationRequest,
  CanonicalTakenRequest,
} from "../application/ti2-sprint-1-contracts";
import {
  mapCanonicalProfessionalRequest,
  mapCanonicalProfessionalRequests,
  mapCanonicalStudentAccompaniment,
  mapProfessionalActionToContract,
} from "./ti2-contract-mappers";
import {
  fictionalProfessionalRequestResponses,
  fictionalTakenRequestResults,
} from "./mock-professional-review-data";

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
  details?: ProfessionalActionDetails,
  onAccompanimentAccepted?: MockProfessionalAccompanimentStore["add"],
): ProfessionalRequestActionReceipt {
  if (action === "startReview" && request.status === "received") {
    const operation = mapProfessionalActionToContract(request.id, action);
    if (operation.kind !== "takeRequest") {
      throw new Error("No pudimos actualizar la solicitud.");
    }
    const previous = fictionalTakenRequestResults[request.id];
    if (!previous || previous._id !== operation.args.requestId) {
      throw new Error("No encontramos la solicitud seleccionada.");
    }
    const canonicalResult: CanonicalTakenRequest = { ...previous, status: "under_review" };
    const updatedRequest = mapCanonicalProfessionalRequest(canonicalResult);
    return {
      action,
      request: updatedRequest,
      message: "La solicitud quedó en revisión.",
    };
  }

  const source =
    fictionalProfessionalRequestResponses.authorized.find((row) => row._id === request.id) ??
    fictionalTakenRequestResults[request.id];
  if (!source) {
    throw new Error("Esta acción no está disponible para la solicitud seleccionada.");
  }

  if (action === "requestInformation" && request.status === "underReview") {
    const operation = mapProfessionalActionToContract(request.id, action, details);
    if (operation.kind !== "requestAdditionalInformation") {
      throw new Error("Indica el motivo para pedir información.");
    }
    const canonicalResult: CanonicalInformationRequest = {
      ...source,
      status: "awaiting_information_or_acceptance",
    };
    return {
      action,
      request: mapCanonicalProfessionalRequest(canonicalResult),
      message: "La solicitud quedó esperando información.",
    };
  }

  if (
    action === "accept" &&
    (request.status === "underReview" || request.status === "awaitingInformationOrAcceptance")
  ) {
    const operation = mapProfessionalActionToContract(request.id, action, details);
    if (operation.kind !== "acceptRequest") {
      throw new Error("Indica el objetivo del acompañamiento.");
    }
    const canonicalResult: CanonicalAcceptedAccompaniment = {
      _id: `ACO-${request.id}` as Id<"accompaniments">,
      studentId: source.studentId,
      status: "active",
      objective: operation.args.objective,
      accessNeeds: source.accessNeeds,
      view: "full",
    };
    const accompaniment = mapCanonicalStudentAccompaniment(canonicalResult);
    const updatedRequest: ProfessionalRequest = {
      ...request,
      status: "accepted",
      availableActions: [],
      accompaniment,
    };
    onAccompanimentAccepted?.({
      id: accompaniment.id,
      studentName: request.studentName ?? "Estudiante",
      objective: canonicalResult.objective,
      status: canonicalResult.status,
    });
    return {
      action,
      request: updatedRequest,
      message: "La solicitud fue aceptada y abrió un acompañamiento.",
    };
  }

  throw new Error("Esta acción todavía no está disponible en el contrato Mobile.");
}

export function createMockProfessionalReviewAdapter({
  delayMs = 0,
  readMode = "success",
  actionMode = "success",
  accompanimentStore,
}: MockProfessionalReviewAdapterOptions = {}): ProfessionalReviewPort {
  let requests = mapCanonicalProfessionalRequests(fictionalProfessionalRequestResponses);

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
    async performProfessionalRequestAction(requestId, action, details) {
      await waitIfNeeded();
      if (actionMode === "error") {
        throw new Error("No pudimos actualizar la solicitud. Intenta nuevamente.");
      }

      const request = requests.find((candidate) => candidate.id === requestId);
      if (!request) {
        throw new Error("No encontramos la solicitud seleccionada.");
      }

      const receipt = updateRequest(request, action, details, accompanimentStore?.add);
      requests = requests.map((candidate) =>
        candidate.id === requestId ? receipt.request : candidate,
      );
      return receipt;
    },
  };
}
