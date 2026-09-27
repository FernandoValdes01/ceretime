import type { ProfessionalAccompaniment } from "../application/professional-accompaniment-models";
import {
  ProfessionalAccompanimentAccessDeniedError,
  type ProfessionalAccompanimentReader,
} from "../application/professional-accompaniment-port";
import {
  createMockProfessionalAccompanimentStore,
  type MockProfessionalAccompanimentStore,
} from "./mock-professional-accompaniment-data";

export type MockProfessionalAccompanimentMode = "success" | "empty" | "error";

export interface MockProfessionalAccompanimentReaderOptions {
  readonly delayMs?: number;
  readonly mode?: MockProfessionalAccompanimentMode;
  readonly store?: MockProfessionalAccompanimentStore;
}

/** Adapter local y reemplazable. No realiza llamadas de red ni persiste datos. */
export function createMockProfessionalAccompanimentReader({
  delayMs = 0,
  mode = "success",
  store = createMockProfessionalAccompanimentStore(),
}: MockProfessionalAccompanimentReaderOptions = {}): ProfessionalAccompanimentReader {
  return {
    async readAccompaniments(): Promise<readonly ProfessionalAccompaniment[]> {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      if (mode === "error") {
        throw new Error("No pudimos cargar tus acompañamientos.");
      }

      if (mode === "empty") {
        return [];
      }

      return store.read();
    },
    async readAccompaniment(accompanimentId): Promise<ProfessionalAccompaniment> {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      if (mode === "error") {
        throw new Error("No pudimos cargar el acompañamiento.");
      }

      const accompaniment = store.read().find((candidate) => candidate.id === accompanimentId);

      if (!accompaniment) {
        throw new ProfessionalAccompanimentAccessDeniedError();
      }

      return accompaniment;
    },
  };
}
