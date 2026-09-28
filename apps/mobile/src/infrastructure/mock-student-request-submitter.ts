import type { Id } from "../../../../convex/_generated/dataModel";

import type { StudentRequestSubmitter } from "@/application/student-area-port";
import type { CanonicalCreatedRequest } from "@/application/ti2-sprint-1-contracts";
import {
  mapCreatedRequestToReceipt,
  mapStudentSubmissionToCreateRequest,
} from "./ti2-contract-mappers";

export interface MockStudentRequestSubmitterOptions {
  readonly delayMs?: number;
  readonly failureMode?: "never" | "once";
  readonly now?: () => Date;
}

/** In-memory demo adapter. It performs no network call and stores no data. */
export function createMockStudentRequestSubmitter({
  delayMs = 600,
  failureMode = "never",
  now = () => new Date(),
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
      sequence += 1;
      const createdAt = now().getTime();
      const canonicalResult: CanonicalCreatedRequest = {
        _id: `SOL-DEMO-${sequence.toString().padStart(3, "0")}` as Id<"requests">,
        studentId: "users:student-demo-1" as Id<"users">,
        status: "received",
        accessNeeds: mapped.args.accessNeeds,
        createdAt,
      };
      return mapCreatedRequestToReceipt(canonicalResult);
    },
  };
}
