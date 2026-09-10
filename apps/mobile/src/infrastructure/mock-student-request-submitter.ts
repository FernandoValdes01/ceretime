import type { StudentRequestSubmitter } from "../application/student-area-port";

export interface MockStudentRequestSubmitterOptions {
  readonly delayMs?: number;
  readonly now?: () => Date;
}

/** In-memory demo adapter. It performs no network call and stores no data. */
export function createMockStudentRequestSubmitter({
  delayMs = 600,
  now = () => new Date(),
}: MockStudentRequestSubmitterOptions = {}): StudentRequestSubmitter {
  let sequence = 0;

  return {
    async submitStudentRequest() {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      sequence += 1;
      return {
        requestId: `SOL-DEMO-${sequence.toString().padStart(3, "0")}`,
        receivedAt: now().toISOString(),
      };
    },
  };
}
