import type { Id } from "../../../../convex/_generated/dataModel";

import type { StudentRequestSubmitter } from "@/application/student-area-port";
import type { CanonicalCreatedRequest } from "@/application/ti2-sprint-1-contracts";
import type { MockStudentAreaStore } from "./mock-student-area-store";
import {
  mapCreatedRequestToReceipt,
  mapStudentSubmissionToCreateRequest,
} from "./ti2-contract-mappers";

export interface MockStudentRequestSubmitterOptions {
  readonly delayMs?: number;
  readonly failureMode?: "never" | "once";
  readonly now?: () => Date;
  readonly store?: MockStudentAreaStore;
}

/** Demo adapter with optional session storage; it never calls the network. */
export function createMockStudentRequestSubmitter({
  delayMs = 600,
  failureMode = "never",
  now = () => new Date(),
  store,
}: MockStudentRequestSubmitterOptions = {}): StudentRequestSubmitter {
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
      const requestId =
        store?.nextRequestId() ?? `SOL-DEMO-${(++sequence).toString().padStart(3, "0")}`;
      const createdAt = now().getTime();
      const canonicalResult: CanonicalCreatedRequest = {
        _id: requestId as Id<"requests">,
        studentId: "users:student-demo-1" as Id<"users">,
        status: "received",
        accessNeeds: mapped.args.accessNeeds,
        createdAt,
      };

      store?.addRequest({
        id: canonicalResult._id,
        status: "received",
        createdAt: new Date(createdAt).toISOString(),
        needSummary: command.needSummary,
        expectedOutcome: command.expectedOutcome,
        accessNeeds: mapped.args.accessNeeds,
        generalAvailability: command.generalAvailability,
        modalityPreference: command.modalityPreference,
        preferredAccessibleInformationChannel: command.preferredAccessibleInformationChannel,
      });

      return mapCreatedRequestToReceipt(canonicalResult);
    },
  };
}
