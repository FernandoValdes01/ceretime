import {
  PractitionerAccompanimentAccessDeniedError,
  type PractitionerAccompanimentReader,
} from "../application/practitioner-accompaniment-port";
import { fictionalPractitionerAccompanimentsByPractitioner } from "./mock-practitioner-accompaniment-data";

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

      return fictionalPractitionerAccompanimentsByPractitioner[practitionerId] ?? [];
    },
    async readAssignedAccompaniment(practitionerId, accompanimentId) {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      if (mode === "error") {
        throw new Error("No pudimos cargar el acompañamiento.");
      }

      if (mode === "empty") {
        throw new PractitionerAccompanimentAccessDeniedError();
      }

      const accompaniment = fictionalPractitionerAccompanimentsByPractitioner[practitionerId]?.find(
        (candidate) => candidate.id === accompanimentId,
      );

      if (!accompaniment) {
        throw new PractitionerAccompanimentAccessDeniedError();
      }

      return accompaniment;
    },
  };
}
