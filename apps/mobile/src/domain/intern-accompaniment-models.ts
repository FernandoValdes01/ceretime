import type { AccompanimentStatus } from "../../../../convex/domain/accompaniments/accompaniment";

export type InternAccompanimentStatus = AccompanimentStatus;

/** Proyección mínima que el Practicante puede consultar en Sprint 1. */
export interface InternAccompaniment {
  readonly id: string;
  readonly objective: string;
  readonly status: InternAccompanimentStatus;
  readonly view: "minimized";
}
