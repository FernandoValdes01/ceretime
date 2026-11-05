// Puerto de lectura de los acompañamientos del Profesional.
import type { ProfessionalAccompaniment } from "../domain/professional-accompaniment-models";

/** Lector reemplazable del conjunto autorizado del Profesional. */
export interface ProfessionalAccompanimentReader {
  readAccompaniments(): Promise<readonly ProfessionalAccompaniment[]>;
  readAccompaniment(accompanimentId: string): Promise<ProfessionalAccompaniment>;
}
