import type { ProfessionalAccompaniment } from "./professional-accompaniment-models";

/** Lector reemplazable del conjunto autorizado del Profesional. */
export interface ProfessionalAccompanimentReader {
  readAccompaniments(): Promise<readonly ProfessionalAccompaniment[]>;
}
