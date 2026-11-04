import type { AccompanimentStatus } from "../../../../convex/domain/accompaniments/accompaniment";

export type PractitionerAccompanimentStatus = AccompanimentStatus;

/** Proyección mínima que el Practicante puede consultar en Sprint 1. */
export interface PractitionerAccompaniment {
  readonly id: string;
  readonly objective: string;
  readonly status: PractitionerAccompanimentStatus;
  readonly view: "minimized";
}
