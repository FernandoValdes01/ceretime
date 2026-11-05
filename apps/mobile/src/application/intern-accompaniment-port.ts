// Puerto de lectura de los acompañamientos asignados al Practicante.
import type { InternAccompaniment } from "./intern-accompaniment-models";

/** Lector reemplazable para la lista autorizada del Practicante. */
export interface InternAccompanimentReader {
  readAssignedAccompaniments(internId: string): Promise<readonly InternAccompaniment[]>;
  readAssignedAccompaniment(
    internId: string,
    accompanimentId: string,
  ): Promise<InternAccompaniment>;
}

export const internAccompanimentAccessDeniedMessage = "No puedes acceder a este acompañamiento.";

export class InternAccompanimentAccessDeniedError extends Error {
  constructor() {
    super(internAccompanimentAccessDeniedMessage);
    this.name = "InternAccompanimentAccessDeniedError";
  }
}

export function isInternAccompanimentAccessDeniedError(
  error: unknown,
): error is InternAccompanimentAccessDeniedError {
  return error instanceof InternAccompanimentAccessDeniedError;
}
