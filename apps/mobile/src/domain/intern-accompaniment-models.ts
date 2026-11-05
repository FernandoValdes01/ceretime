import type { AccompanimentStatus } from "../../../../convex/domain/accompaniments/accompaniment";

export type InternAccompanimentStatus = AccompanimentStatus;

/** Proyección mínima que el Practicante puede consultar en Sprint 1. */
export interface InternAccompaniment {
  readonly id: string;
  readonly objective: string;
  readonly status: InternAccompanimentStatus;
  readonly view: "minimized";
}

// Error de acceso: el adaptador lo lanza cuando el acompañamiento no pertenece a la persona.
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
