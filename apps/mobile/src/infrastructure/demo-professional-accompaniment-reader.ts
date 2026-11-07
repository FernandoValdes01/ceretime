import type { ProfessionalAccompaniment } from "../domain/professional-accompaniment-models";
import { AccompanimentAccessDeniedError } from "../domain/accompaniment-access-denied-error";
import type { ProfessionalAccompanimentReader } from "../application/professional-accompaniment-port";
import {
  createDemoProfessionalAccompanimentStore,
  type DemoProfessionalAccompanimentStore,
} from "./demo-professional-accompaniment-data";

export type DemoProfessionalAccompanimentMode = "success" | "empty" | "error";

export interface DemoProfessionalAccompanimentReaderOptions {
  readonly delayMs?: number;
  readonly mode?: DemoProfessionalAccompanimentMode;
  readonly store?: DemoProfessionalAccompanimentStore;
}

/** Adapter local y reemplazable. No realiza llamadas de red ni persiste datos. */
export function createDemoProfessionalAccompanimentReader({
  delayMs = 0,
  mode = "success",
  store = createDemoProfessionalAccompanimentStore(),
}: DemoProfessionalAccompanimentReaderOptions = {}): ProfessionalAccompanimentReader {
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
        throw new AccompanimentAccessDeniedError();
      }

      return accompaniment;
    },
  };
}
