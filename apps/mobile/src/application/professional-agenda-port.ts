import type { ProfessionalAgendaDay } from "./professional-agenda-models";

/** Adapter reemplazable para leer la agenda del Profesional. */
export interface ProfessionalAgendaReader {
  readProfessionalAgenda(dayOffset?: number): Promise<ProfessionalAgendaDay>;
}
