// Puerto de lectura de la agenda diaria del Profesional.
import type { ProfessionalAgendaDayViewModel } from "../domain/professional-agenda-view-models";

/** Adapter reemplazable para leer la agenda del Profesional. */
export interface ProfessionalAgendaReader {
  readProfessionalAgenda(dayOffset?: number): Promise<ProfessionalAgendaDayViewModel>;
}
