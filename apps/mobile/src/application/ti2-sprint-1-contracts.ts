import type { FunctionArgs, FunctionReturnType } from "convex/server";

import type { api } from "../../../../convex/_generated/api";

export type CanonicalStudentRequestsPage = FunctionReturnType<
  typeof api.presentation.requests.listOwnRequests
>;
export type CanonicalOpenRequestsPage = FunctionReturnType<
  typeof api.presentation.requests.listOpenRequests
>;
export type CanonicalAuthorizedRequestsPage = FunctionReturnType<
  typeof api.presentation.requests.listAuthorizedRequests
>;
export type CanonicalStudentAccompanimentsPage = FunctionReturnType<
  typeof api.presentation.accompaniments.listOwnedAccompaniments
>;
export type CanonicalCreatedRequest = FunctionReturnType<
  typeof api.presentation.requests.createRequest
>;
export type CanonicalTakenRequest = FunctionReturnType<
  typeof api.presentation.requests.takeRequest
>;
export type CanonicalInformationRequest = FunctionReturnType<
  typeof api.presentation.requests.requestAdditionalInformation
>;
export type CanonicalAcceptedAccompaniment = FunctionReturnType<
  typeof api.presentation.requests.acceptRequest
>;

/** Límite documentado en docs/contratos-sprint-1.md; el validador de Convex no lo codifica en el tipo. */
export const ACCESS_NEEDS_MAX_LENGTH = 2000;

export type CanonicalStudentRequest = CanonicalStudentRequestsPage["page"][number];
export type CanonicalOpenRequest = CanonicalOpenRequestsPage["page"][number];
export type CanonicalAuthorizedRequest = CanonicalAuthorizedRequestsPage["page"][number];
export type CanonicalStudentAccompaniment = CanonicalStudentAccompanimentsPage["page"][number];
export type CreateRequestArgs = FunctionArgs<typeof api.presentation.requests.createRequest>;
export type TakeRequestArgs = FunctionArgs<typeof api.presentation.requests.takeRequest>;
export type RequestAdditionalInformationArgs = FunctionArgs<
  typeof api.presentation.requests.requestAdditionalInformation
>;
export type AcceptRequestArgs = FunctionArgs<typeof api.presentation.requests.acceptRequest>;
