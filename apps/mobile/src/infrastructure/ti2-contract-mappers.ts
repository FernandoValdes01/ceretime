import type {
  Accompaniment,
  StudentAreaSnapshot,
  StudentRequest,
  StudentRequestSubmissionReceipt,
  SubmitStudentRequestCommand,
} from "../application/student-area-models";
import type {
  ProfessionalRequest,
  ProfessionalRequestAction,
  ProfessionalActionDetails,
} from "../application/professional-review-models";
import { ACCESS_NEEDS_MAX_LENGTH } from "../application/ti2-sprint-1-contracts";
import type {
  AcceptRequestArgs,
  CanonicalAuthorizedRequest,
  CanonicalCreatedRequest,
  CanonicalOpenRequest,
  CanonicalStudentAccompaniment,
  CanonicalStudentRequest,
  CanonicalTakenRequest,
  CreateRequestArgs,
  RequestAdditionalInformationArgs,
  TakeRequestArgs,
} from "../application/ti2-sprint-1-contracts";

export interface CanonicalStudentAreaResponses {
  readonly requests: CanonicalStudentRequest[];
  readonly accompaniments: CanonicalStudentAccompaniment[];
}

export interface CanonicalProfessionalRequestResponses {
  readonly open: CanonicalOpenRequest[];
  readonly authorized: CanonicalAuthorizedRequest[];
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

export function mapCanonicalRequestStatus(
  status: CanonicalStudentRequest["status"],
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
  }
}

function toIsoDateTime(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function mapCanonicalStudentRequest(request: CanonicalStudentRequest): StudentRequest {
  return {
    id: request._id,
    status: mapCanonicalRequestStatus(request.status),
    createdAt: toIsoDateTime(request.createdAt),
    accessNeeds: request.accessNeeds,
  };
}

export function mapCanonicalStudentAccompaniment(
  accompaniment: CanonicalStudentAccompaniment,
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

export function mapCanonicalStudentArea(
  student: StudentAreaSnapshot["student"],
  responses: CanonicalStudentAreaResponses,
): StudentAreaSnapshot {
  return {
    student,
    requests: responses.requests.map(mapCanonicalStudentRequest),
    accompaniments: responses.accompaniments.map(mapCanonicalStudentAccompaniment),
  };
}

export function mapCanonicalProfessionalRequest(
  request: CanonicalOpenRequest | CanonicalAuthorizedRequest | CanonicalTakenRequest,
  scope: "open" | "authorized" = "authorized",
): ProfessionalRequest {
  const status = mapCanonicalRequestStatus(request.status);
  const availableActions: readonly ProfessionalRequestAction[] =
    scope === "open"
      ? status === "received"
        ? ["startReview"]
        : []
      : status === "underReview"
        ? ["requestInformation", "accept"]
        : status === "awaitingInformationOrAcceptance"
          ? ["accept"]
          : [];
  return {
    id: request._id,
    studentId: request.studentId,
    status,
    createdAt: toIsoDateTime(request.createdAt),
    accessNeeds: "accessNeeds" in request ? request.accessNeeds : undefined,
    availableActions,
  };
}

export function mapCanonicalProfessionalRequests(
  responses: CanonicalProfessionalRequestResponses,
): readonly ProfessionalRequest[] {
  return [
    ...responses.open.map((request) => mapCanonicalProfessionalRequest(request, "open")),
    ...responses.authorized.map((request) => mapCanonicalProfessionalRequest(request)),
  ];
}

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
  request: CanonicalCreatedRequest,
): StudentRequestSubmissionReceipt {
  return {
    requestId: request._id,
    receivedAt: toIsoDateTime(request.createdAt),
  };
}

export function mapProfessionalActionToContract(
  requestId: string,
  action: ProfessionalRequestAction,
  details?: ProfessionalActionDetails,
): ProfessionalActionMapping {
  if (action === "startReview") {
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
