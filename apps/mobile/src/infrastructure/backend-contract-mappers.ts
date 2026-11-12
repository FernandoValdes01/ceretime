// Traductores entre los contratos de Convex (snake_case, timestamps) y los modelos de la app (camelCase, ISO).
import type {
  StudentAreaSnapshot,
  StudentRequest,
  StudentRequestSubmissionReceipt,
  SubmitStudentRequestCommand,
} from "../domain/student-area-models";
import type { Accompaniment } from "../domain/request-models";
import type {
  ProfessionalRequest,
  ProfessionalRequestAction,
  ProfessionalActionDetails,
} from "../domain/professional-review-models";
import { ACCESS_NEEDS_MAX_LENGTH } from "./backend-contracts";
import type {
  AcceptRequestArgs,
  BackendAuthorizedRequest,
  BackendCreatedRequest,
  BackendOpenRequest,
  BackendStudentAccompaniment,
  BackendStudentRequest,
  BackendTakenRequest,
  CreateRequestArgs,
  RequestAdditionalInformationArgs,
  TakeRequestArgs,
} from "./backend-contracts";

export interface BackendStudentAreaResponses {
  readonly requests: BackendStudentRequest[];
  readonly accompaniments: BackendStudentAccompaniment[];
}

export interface BackendProfessionalRequestResponses {
  readonly open: BackendOpenRequest[];
  readonly authorized: BackendAuthorizedRequest[];
}

export type ProfessionalActionMapping =
  | { readonly kind: "takeRequest"; readonly args: TakeRequestArgs }
  | {
      readonly kind: "requestAdditionalInformation";
      readonly args: RequestAdditionalInformationArgs;
    }
  | { readonly kind: "acceptRequest"; readonly args: AcceptRequestArgs }
  | {
      readonly kind: "unsupported";
      readonly reason: "reason_required" | "objective_required";
    };

export function mapBackendRequestStatus(
  status: BackendStudentRequest["status"],
): StudentRequest["status"] {
  switch (status) {
    case "received":
      return "received";
    case "under_review":
      return "underReview";
    case "awaiting_information_or_acceptance":
      return "awaitingInformationOrAcceptance";
    case "accepted":
      return "accepted";
    case "referred":
      return "referred";
    case "closed_without_accompaniment":
      return "closedWithoutAccompaniment";
    case "cancelled":
      return "cancelled";
  }
}

function toIsoDateTime(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function mapBackendStudentRequest(request: BackendStudentRequest): StudentRequest {
  return {
    id: request._id,
    status: mapBackendRequestStatus(request.status),
    createdAt: toIsoDateTime(request.createdAt),
    accessNeeds: request.accessNeeds,
  };
}

export function mapBackendStudentAccompaniment(
  accompaniment: BackendStudentAccompaniment,
): Accompaniment {
  if (accompaniment.view !== "full") {
    throw new Error("La consulta del Estudiante debe devolver la vista completa.");
  }

  return {
    id: accompaniment._id,
    status: accompaniment.status,
    objective: accompaniment.objective,
    accessNeeds: accompaniment.accessNeeds,
    view: accompaniment.view,
  };
}

export function mapBackendStudentArea(
  student: StudentAreaSnapshot["student"],
  responses: BackendStudentAreaResponses,
): StudentAreaSnapshot {
  return {
    student,
    requests: responses.requests.map(mapBackendStudentRequest),
    accompaniments: responses.accompaniments.map(mapBackendStudentAccompaniment),
  };
}

export function mapBackendProfessionalRequest(
  request: BackendOpenRequest | BackendAuthorizedRequest | BackendTakenRequest,
  scope: "open" | "authorized" = "authorized",
): ProfessionalRequest {
  const status = mapBackendRequestStatus(request.status);
  const availableActions = getAvailableActions(scope, status);
  return {
    id: request._id,
    studentId: request.studentId,
    status,
    createdAt: toIsoDateTime(request.createdAt),
    accessNeeds: "accessNeeds" in request ? request.accessNeeds : undefined,
    availableActions,
  };
}

function getAvailableActions(
  scope: "open" | "authorized",
  status: StudentRequest["status"],
): readonly ProfessionalRequestAction[] {
  if (scope === "open") return status === "received" ? ["startReview"] : [];
  switch (status) {
    case "underReview":
      return ["requestInformation", "accept"];
    case "awaitingInformationOrAcceptance":
      return ["accept"];
    default:
      return [];
  }
}

export function mapBackendProfessionalRequests(
  responses: BackendProfessionalRequestResponses,
): readonly ProfessionalRequest[] {
  return [
    ...responses.open.map((request) => mapBackendProfessionalRequest(request, "open")),
    ...responses.authorized.map((request) => mapBackendProfessionalRequest(request)),
  ];
}

// El backend de TI2 hoy solo recibe `accessNeeds`; `omittedFields` deja explícito lo que el formulario
// captura pero aún no se envía, y las pruebas lo fijan para detectar cuando el contrato crezca.
export function mapStudentSubmissionToCreateRequest(command: SubmitStudentRequestCommand): {
  readonly args: CreateRequestArgs;
  readonly omittedFields: readonly string[];
} {
  const accessNeeds = [
    ...command.accessNeeds.map((need) => need.label.trim()),
    command.otherAccessNeed?.trim(),
  ].filter((need): need is string => Boolean(need));
  const accessNeedsText = accessNeeds.join("\n");
  if (!accessNeedsText.trim()) {
    throw new Error("Se requiere describir la necesidad de acceso");
  }
  if (accessNeedsText.length > ACCESS_NEEDS_MAX_LENGTH) {
    throw new Error(
      `La necesidad de acceso supera el máximo permitido (${ACCESS_NEEDS_MAX_LENGTH} caracteres)`,
    );
  }

  // TI2 solo recibe accessNeeds; el resto del formulario queda fuera del contrato actual.
  return {
    args: { accessNeeds: accessNeedsText },
    omittedFields: [
      "needSummary",
      "expectedOutcome",
      "generalAvailability",
      "modalityPreference",
      "preferredAccessibleInformationChannel",
    ],
  };
}

export function mapCreatedRequestToReceipt(
  request: BackendCreatedRequest,
): StudentRequestSubmissionReceipt {
  return {
    requestId: request._id,
    receivedAt: toIsoDateTime(request.createdAt),
  };
}

// Traduce la acción de la interfaz a la mutación de Convex. Los IDs llegan como string y se convierten a
// `Id<"requests">` con un cast: la app no puede construir IDs de Convex, solo reenviar los recibidos.
export function mapProfessionalActionToContract(
  requestId: string,
  action: ProfessionalRequestAction,
  details?: ProfessionalActionDetails,
): ProfessionalActionMapping {
  if (action === "startReview") {
    // Convex valida el ID en runtime, pero el contrato local lo expone como string.
    return { kind: "takeRequest", args: { requestId: requestId as TakeRequestArgs["requestId"] } };
  }

  if (action === "requestInformation") {
    if (!details?.reason?.trim()) return { kind: "unsupported", reason: "reason_required" };
    return {
      kind: "requestAdditionalInformation",
      args: {
        requestId: requestId as RequestAdditionalInformationArgs["requestId"],
        reason: details.reason.trim(),
      },
    };
  }

  if (!details?.objective?.trim()) return { kind: "unsupported", reason: "objective_required" };
  return {
    kind: "acceptRequest",
    args: {
      requestId: requestId as AcceptRequestArgs["requestId"],
      objective: details.objective.trim(),
    },
  };
}
