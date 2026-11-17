import { toRequestSubmission } from "../../../../convex/domain/requests/request";
import { UserFacingError } from "@/application/user-facing-error";
import type { Id } from "../../../../convex/_generated/dataModel";

import type { StudentRequestSubmitter } from "@/application/student-area-port";
import type { BackendCreatedRequest } from "@/infrastructure/backend-contracts";
import type { DemoStudentAreaStore } from "./demo-student-area-store";
import {
  mapCreatedRequestToReceipt,
  mapStudentSubmissionToCreateRequest,
} from "./backend-contract-mappers";

export interface DemoStudentRequestSubmitterOptions {
  readonly delayMs?: number;
  readonly failureMode?: "never" | "once";
  readonly now?: () => Date;
  readonly store?: DemoStudentAreaStore;
}

// Adaptador de demostración con almacén de sesión opcional; nunca usa la red.
export function createDemoStudentRequestSubmitter({
  delayMs = 600,
  failureMode = "never",
  now = () => new Date(),
  store,
}: DemoStudentRequestSubmitterOptions = {}): StudentRequestSubmitter {
  let sequence = 0;
  let shouldFail = failureMode === "once";

  return {
    async submitStudentRequest(command) {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      if (shouldFail) {
        shouldFail = false;
        throw new Error("Falla simulada del envío");
      }

      const mapped = mapStudentSubmissionToCreateRequest(command);
      const validated = toRequestSubmission({ ...command, idempotencyKey: "demo" });
      if (validated.status === "error") throw new UserFacingError(validated.error.message);
      const content = validated.data;
      const requestId =
        store?.nextRequestId() ?? `SOL-DEMO-${(++sequence).toString().padStart(3, "0")}`;
      const createdAt = now().getTime();
      const backendResult: BackendCreatedRequest = {
        _id: requestId as Id<"requests">,
        studentId: "users:student-demo-1" as Id<"users">,
        status: "received",
        accessNeeds: mapped.args.accessNeeds,
        createdAt,
      };

      store?.addRequest({
        id: backendResult._id,
        status: "received",
        createdAt: new Date(createdAt).toISOString(),
        needSummary: content.needSummary,
        expectedOutcome: content.expectedOutcome,
        accessNeeds: mapped.args.accessNeeds,
        generalAvailability: content.generalAvailability,
        modalityPreference: content.modalityPreference,
        preferredAccessibleInformationChannel: content.preferredAccessibleInformationChannel,
      });

      return mapCreatedRequestToReceipt(backendResult);
    },
  };
}
