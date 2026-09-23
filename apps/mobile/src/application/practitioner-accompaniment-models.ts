export type PractitionerAccompanimentStatus = "active" | "paused" | "closed";

/** Proyección mínima que el Practicante puede consultar en Sprint 1. */
export interface PractitionerAccompaniment {
  readonly id: string;
  readonly objective: string;
  readonly status: PractitionerAccompanimentStatus;
  readonly view: "minimized";
}
