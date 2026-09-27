import type { PractitionerAccompaniment } from "./practitioner-accompaniment-models";

/** Lector reemplazable para la lista autorizada del Practicante. */
export interface PractitionerAccompanimentReader {
  readAssignedAccompaniments(practitionerId: string): Promise<readonly PractitionerAccompaniment[]>;
  readAssignedAccompaniment(
    practitionerId: string,
    accompanimentId: string,
  ): Promise<PractitionerAccompaniment>;
}

export const practitionerAccompanimentAccessDeniedMessage =
  "No puedes acceder a este acompañamiento.";

export class PractitionerAccompanimentAccessDeniedError extends Error {
  constructor() {
    super(practitionerAccompanimentAccessDeniedMessage);
    this.name = "PractitionerAccompanimentAccessDeniedError";
  }
}

export function isPractitionerAccompanimentAccessDeniedError(
  error: unknown,
): error is PractitionerAccompanimentAccessDeniedError {
  return error instanceof PractitionerAccompanimentAccessDeniedError;
}
