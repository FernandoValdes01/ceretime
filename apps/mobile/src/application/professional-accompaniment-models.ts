import type { AccompanimentStatus } from "../../../../convex/domain/accompaniments/accompaniment";

export type ProfessionalAccompanimentStatus = AccompanimentStatus;

export interface ProfessionalAccompaniment {
  readonly id: string;
  readonly studentName: string;
  readonly objective: string;
  readonly status: ProfessionalAccompanimentStatus;
}
