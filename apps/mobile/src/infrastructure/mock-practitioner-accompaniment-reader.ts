import type { PractitionerAccompaniment } from "../application/practitioner-accompaniment-models";
import type { PractitionerAccompanimentReader } from "../application/practitioner-accompaniment-port";

const assignedAccompanimentsByPractitioner: Readonly<
  Record<string, readonly PractitionerAccompaniment[]>
> = {
  "mock-practitioner-assigned-1": [
    {
      id: "mock-accompaniment-1",
      objective: "Organizar apoyos para participar en actividades académicas.",
      status: "active",
      view: "minimized",
    },
  ],
};

export type MockPractitionerAccompanimentMode = "success" | "empty" | "error";

export interface MockPractitionerAccompanimentReaderOptions {
  readonly delayMs?: number;
  readonly mode?: MockPractitionerAccompanimentMode;
}

/** Adapter local y reemplazable. No realiza llamadas de red ni persiste datos. */
export function createMockPractitionerAccompanimentReader({
  delayMs = 0,
  mode = "success",
}: MockPractitionerAccompanimentReaderOptions = {}): PractitionerAccompanimentReader {
  return {
    async readAssignedAccompaniments(practitionerId) {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      if (mode === "error") {
        throw new Error("No pudimos cargar tus acompañamientos asignados.");
      }

      if (mode === "empty") {
        return [];
      }

      return assignedAccompanimentsByPractitioner[practitionerId] ?? [];
    },
  };
}
