// Tipos de entrada y salida de las funciones de Convex de TI2, derivados de su API para detectar cambios al compilar.
import type { FunctionArgs, FunctionReturnType } from "convex/server";

import type { api } from "../../../../convex/_generated/api";

export type BackendStudentRequestsPage = FunctionReturnType<
  typeof api.presentation.requests.listOwnRequests
>;
export type BackendOpenRequestsPage = FunctionReturnType<
  typeof api.presentation.requests.listOpenRequests
>;
export type BackendAuthorizedRequestsPage = FunctionReturnType<
  typeof api.presentation.requests.listAuthorizedRequests
>;
export type BackendStudentAccompanimentsPage = FunctionReturnType<
  typeof api.presentation.accompaniments.listOwnedAccompaniments
>;
export type BackendCreatedRequest = FunctionReturnType<
  typeof api.presentation.requests.createRequest
>;
export type BackendTakenRequest = FunctionReturnType<typeof api.presentation.requests.takeRequest>;
export type BackendInformationRequest = FunctionReturnType<
  typeof api.presentation.requests.requestAdditionalInformation
>;
export type BackendAcceptedAccompaniment = FunctionReturnType<
  typeof api.presentation.requests.acceptRequest
>;

export { ACCESS_NEEDS_MAX_LENGTH } from "../../../../convex/domain/requests/request";

export type BackendStudentRequest = BackendStudentRequestsPage["page"][number];
export type BackendOpenRequest = BackendOpenRequestsPage["page"][number];
export type BackendAuthorizedRequest = BackendAuthorizedRequestsPage["page"][number];
export type BackendStudentAccompaniment = BackendStudentAccompanimentsPage["page"][number];
export type CreateRequestArgs = FunctionArgs<typeof api.presentation.requests.createRequest>;
export type TakeRequestArgs = FunctionArgs<typeof api.presentation.requests.takeRequest>;
export type RequestAdditionalInformationArgs = FunctionArgs<
  typeof api.presentation.requests.requestAdditionalInformation
>;
export type AcceptRequestArgs = FunctionArgs<typeof api.presentation.requests.acceptRequest>;
