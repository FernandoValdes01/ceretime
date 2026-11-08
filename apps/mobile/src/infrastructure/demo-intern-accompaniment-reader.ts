import { AccompanimentAccessDeniedError } from "../domain/accompaniment-access-denied-error";
import type { InternAccompanimentReader } from "../application/intern-accompaniment-port";
import { demoInternAccompanimentsByIntern } from "./demo-intern-accompaniment-data";

export type DemoInternAccompanimentMode = "success" | "empty" | "error";

export interface DemoInternAccompanimentReaderOptions {
  readonly delayMs?: number;
  readonly mode?: DemoInternAccompanimentMode;
}

/** Adapter local y reemplazable. No realiza llamadas de red ni persiste datos. */
export function createDemoInternAccompanimentReader({
  delayMs = 0,
  mode = "success",
}: DemoInternAccompanimentReaderOptions = {}): InternAccompanimentReader {
  return {
    async readAssignedAccompaniments(internId) {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      if (mode === "error") {
        throw new Error("No pudimos cargar tus acompañamientos asignados.");
      }

      if (mode === "empty") {
        return [];
      }

      return demoInternAccompanimentsByIntern[internId] ?? [];
    },
    async readAssignedAccompaniment(internId, accompanimentId) {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      if (mode === "error") {
        throw new Error("No pudimos cargar el acompañamiento.");
      }

      if (mode === "empty") {
        throw new AccompanimentAccessDeniedError();
      }

      const accompaniment = demoInternAccompanimentsByIntern[internId]?.find(
        (candidate) => candidate.id === accompanimentId,
      );

      if (!accompaniment) {
        throw new AccompanimentAccessDeniedError();
      }

      return accompaniment;
    },
  };
}
