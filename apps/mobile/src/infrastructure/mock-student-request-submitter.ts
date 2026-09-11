import type { StudentRequestSubmitter } from "@/application/student-area-port";

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
    async submitStudentRequest() {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      if (shouldFail) {
        shouldFail = false;
        throw new Error("Falla simulada del envío");
      }

      sequence += 1;
      return {
        requestId: `SOL-DEMO-${sequence.toString().padStart(3, "0")}`,
        receivedAt: now().toISOString(),
      };
    },
  };
}
