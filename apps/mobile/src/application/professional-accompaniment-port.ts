import type { ProfessionalAccompaniment } from "./professional-accompaniment-models";

/** Lector reemplazable del conjunto autorizado del Profesional. */
export interface ProfessionalAccompanimentReader {
  readAccompaniments(): Promise<readonly ProfessionalAccompaniment[]>;
  readAccompaniment(accompanimentId: string): Promise<ProfessionalAccompaniment>;
}

export const professionalAccompanimentAccessDeniedMessage =
  "No puedes acceder a este acompañamiento.";

export class ProfessionalAccompanimentAccessDeniedError extends Error {
  constructor() {
    super(professionalAccompanimentAccessDeniedMessage);
    this.name = "ProfessionalAccompanimentAccessDeniedError";
  }
}

export function isProfessionalAccompanimentAccessDeniedError(
  error: unknown,
): error is ProfessionalAccompanimentAccessDeniedError {
  return error instanceof ProfessionalAccompanimentAccessDeniedError;
}
