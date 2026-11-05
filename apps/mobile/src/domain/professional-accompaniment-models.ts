import type { AccompanimentStatus } from "../../../../convex/domain/accompaniments/accompaniment";

export type ProfessionalAccompanimentStatus = AccompanimentStatus;

export interface ProfessionalAccompaniment {
  readonly id: string;
  readonly studentName: string;
  readonly objective: string;
  readonly status: ProfessionalAccompanimentStatus;
}

// Error de acceso: el adaptador lo lanza cuando el acompañamiento no pertenece a la persona.
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
