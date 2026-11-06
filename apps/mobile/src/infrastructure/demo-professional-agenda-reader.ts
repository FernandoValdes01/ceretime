import type { ProfessionalAgendaReader } from "../application/professional-agenda-port";
import {
  createDemoProfessionalAgenda,
  demoProfessionalAgenda,
} from "./demo-professional-agenda-data";

export type DemoProfessionalAgendaMode = "success" | "empty" | "error";

export interface DemoProfessionalAgendaReaderOptions {
  readonly delayMs?: number;
  readonly mode?: DemoProfessionalAgendaMode;
}

/** Adapter local y reemplazable; no realiza llamadas de red ni persiste datos. */
export function createDemoProfessionalAgendaReader({
  delayMs = 0,
  mode = "success",
}: DemoProfessionalAgendaReaderOptions = {}): ProfessionalAgendaReader {
  return {
    async readProfessionalAgenda(dayOffset = 0) {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      if (mode === "error") {
        throw new Error("No pudimos cargar la agenda profesional.");
      }

      if (mode === "empty") {
        return { ...createDemoProfessionalAgenda(dayOffset), appointments: [] };
      }

      return dayOffset === 0 ? demoProfessionalAgenda : createDemoProfessionalAgenda(dayOffset);
    },
  };
}
