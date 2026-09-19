import type { ProfessionalAgendaReader } from "../application/professional-agenda-port";
import {
  createFictionalProfessionalAgenda,
  fictionalProfessionalAgenda,
} from "./mock-professional-agenda-data";

export type MockProfessionalAgendaMode = "success" | "empty" | "error";

export interface MockProfessionalAgendaReaderOptions {
  readonly delayMs?: number;
  readonly mode?: MockProfessionalAgendaMode;
}

/** Adapter local y reemplazable; no realiza llamadas de red ni persiste datos. */
export function createMockProfessionalAgendaReader({
  delayMs = 350,
  mode = "success",
}: MockProfessionalAgendaReaderOptions = {}): ProfessionalAgendaReader {
  return {
    async readProfessionalAgenda(dayOffset = 0) {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      if (mode === "error") {
        throw new Error("No pudimos cargar la agenda profesional.");
      }

      if (mode === "empty") {
        return { ...createFictionalProfessionalAgenda(dayOffset), events: [] };
      }

      return dayOffset === 0
        ? fictionalProfessionalAgenda
        : createFictionalProfessionalAgenda(dayOffset);
    },
  };
}
