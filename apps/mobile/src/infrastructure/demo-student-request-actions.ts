import { toInformationResponse } from "../../../../convex/domain/requests/request";
import {
  StudentRequestActionError,
  type StudentRequestActions,
} from "../application/student-area-port";
import { mapBackendStudentRequest } from "./backend-contract-mappers";
import { demoStudentAreaResponses } from "./demo-student-area-data";
import type { DemoStudentAreaStore } from "./demo-student-area-store";

// Simula las dos acciones publicadas por TI2-141 sobre el estado local de la demo.
// No demuestra autorización ni persistencia del backend; con ingreso institucional se usa el adaptador de Convex.
export function createDemoStudentRequestActions({
  store,
  delayMs = 600,
  failureMode = "never",
  now = () => new Date(),
}: {
  readonly store: DemoStudentAreaStore;
  readonly delayMs?: number;
  readonly failureMode?: "never" | "once";
  readonly now?: () => Date;
}): StudentRequestActions {
  let shouldFail = failureMode === "once";
  return {
    async execute(command) {
      if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      if (shouldFail) {
        shouldFail = false;
        throw new Error("Falla simulada de la acción");
      }
      const request =
        store.readRequests().find((item) => item.id === command.requestId) ??
        demoStudentAreaResponses.requests
          .map(mapBackendStudentRequest)
          .find((item) => item.id === command.requestId);
      if (!request)
        throw new StudentRequestActionError("unauthorized", "No tienes acceso a esta solicitud.");
      const responding = command.kind === "respondToInformationRequest";
      const allowed = responding
        ? request.status === "awaitingInformationOrAcceptance"
        : ["received", "underReview", "awaitingInformationOrAcceptance"].includes(request.status);
      if (!allowed)
        throw new StudentRequestActionError(
          "conflict",
          "La solicitud cambió y ya no admite esta acción. Actualiza el detalle.",
        );
      const text = responding ? command.response.trim() : command.reason.trim();
      if (responding) {
        const response = toInformationResponse(text);
        if (response.status === "error")
          throw new StudentRequestActionError("invalid", response.error.message);
      } else if (!text) {
        throw new StudentRequestActionError("invalid", "Indica el motivo de cancelación.");
      }
      const updated = {
        ...request,
        status: responding ? ("underReview" as const) : ("cancelled" as const),
        updatedAt: now().toISOString(),
        ...(responding
          ? { informationRequest: undefined, informationResponse: text }
          : { closureReason: text }),
      };
      store.updateRequest(updated);
      return updated;
    },
  };
}
