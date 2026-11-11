import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api";
import { ACCESS_NEEDS_MAX_LENGTH } from "../../../../convex/domain/requests/request";
import { API_ERROR_MESSAGES, unauthorizedError } from "../../../../convex/domain/errors/api_error";
import {
  StudentOperationError,
  type StudentPage,
  type StudentPublicOperation,
} from "../application/student-area-port";
import type { StudentRequest } from "../domain/student-area-models";
import type { Accompaniment } from "../domain/request-models";
import {
  mapBackendStudentAccompaniment,
  mapBackendStudentRequest,
} from "./backend-contract-mappers";

// Se reutilizan las conversiones compartidas sin modificar el módulo que mantiene Fernando.
export {
  mapCreatedRequestToReceipt,
  mapStudentSubmissionToCreateRequest,
} from "./backend-contract-mappers";

/** Tipos derivados de las cinco operaciones públicas, sin crear un cliente Convex. */
export type StudentContractOperations = {
  createRequest: typeof api.presentation.requests.createRequest;
  listOwnRequests: typeof api.presentation.requests.listOwnRequests;
  getRequest: typeof api.presentation.requests.getRequest;
  listOwnedAccompaniments: typeof api.presentation.accompaniments.listOwnedAccompaniments;
  getAccompaniment: typeof api.presentation.accompaniments.getAccompaniment;
};

export type StudentContractArgs<Operation extends StudentPublicOperation> = FunctionArgs<
  StudentContractOperations[Operation]
>;

export type StudentContractResponse<Operation extends StudentPublicOperation> = FunctionReturnType<
  StudentContractOperations[Operation]
>;

/** Conserva los cursores y las instrucciones de división; nunca interpreta vacío como fin. */
export function mapStudentRequestsPage(
  response: StudentContractResponse<"listOwnRequests">,
): StudentPage<StudentRequest> {
  return { ...response, page: response.page.map(mapStudentRequestDetail) };
}

export function mapStudentRequestDetail(
  response: StudentContractResponse<"getRequest">,
): StudentRequest {
  return mapBackendStudentRequest(response);
}

export function mapStudentAccompanimentsPage(
  response: StudentContractResponse<"listOwnedAccompaniments">,
): StudentPage<Accompaniment> {
  // Una vista minimizada no corresponde al Estudiante: falla toda la página, sin éxito parcial.
  return {
    ...response,
    page: response.page.map((item) => mapStudentAccompaniment(item, "listOwnedAccompaniments")),
  };
}

export function mapStudentAccompanimentDetail(
  response: StudentContractResponse<"getAccompaniment">,
): Accompaniment {
  return mapStudentAccompaniment(response, "getAccompaniment");
}

function mapStudentAccompaniment(
  response: StudentContractResponse<"getAccompaniment">,
  operation: "listOwnedAccompaniments" | "getAccompaniment",
): Accompaniment {
  if (response.view !== "full") {
    throw new StudentOperationError(operation, "unauthorized", unauthorizedError().message);
  }
  // Conserva solo _id, status, objective, accessNeeds y view. No inventa requestId ni createdAt.
  return mapBackendStudentAccompaniment(response);
}

const fallbackMessages: Record<StudentPublicOperation, string> = {
  createRequest: "No pudimos enviar tu solicitud. Intenta nuevamente.",
  listOwnRequests: "No pudimos cargar tus solicitudes. Intenta nuevamente.",
  getRequest: "No pudimos cargar tu solicitud. Intenta nuevamente.",
  listOwnedAccompaniments: "No pudimos cargar tus acompañamientos. Intenta nuevamente.",
  getAccompaniment: "No pudimos cargar tu acompañamiento. Intenta nuevamente.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Traduce solo rechazos públicos identificados; no propaga stacks ni mensajes internos. */
export function toStudentOperationError(
  error: unknown,
  operation: StudentPublicOperation,
): StudentOperationError {
  if (error instanceof StudentOperationError && error.operation === operation) return error;
  const data = isRecord(error) ? error.data : undefined;
  // Forma efectiva de los cinco endpoints antiguos: ConvexError("No autorizado").
  if (data === unauthorizedError().message || (isRecord(data) && data.code === "unauthorized")) {
    return new StudentOperationError(operation, "unauthorized", unauthorizedError().message);
  }

  if (operation === "createRequest") {
    const rawMessage = error instanceof Error ? error.message : undefined;
    // El cliente añade ruta y stack. Solo se reconoce el mensaje exacto del rechazo publicado.
    const message = rawMessage?.startsWith("[CONVEX M(presentation/requests:createRequest)] ")
      ? /^Uncaught Error: ([^\r\n]+)\r?$/m.exec(rawMessage)?.[1]
      : rawMessage;
    if (
      message === "Se requiere describir la necesidad de acceso" ||
      (isRecord(data) && data.code === "access_needs_empty")
    ) {
      return new StudentOperationError(
        operation,
        "access_needs_empty",
        API_ERROR_MESSAGES.access_needs_empty,
      );
    }
    if (
      message ===
        `La necesidad de acceso supera el máximo permitido (${ACCESS_NEEDS_MAX_LENGTH} caracteres)` ||
      (isRecord(data) && data.code === "access_needs_too_long")
    ) {
      return new StudentOperationError(
        operation,
        "access_needs_too_long",
        API_ERROR_MESSAGES.access_needs_too_long,
      );
    }
  }

  return new StudentOperationError(operation, "unavailable", fallbackMessages[operation]);
}
