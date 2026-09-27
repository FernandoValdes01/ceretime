export type ProfessionalAccompanimentStatus = "active" | "paused" | "closed";

export interface ProfessionalAccompaniment {
  readonly id: string;
  readonly studentName: string;
  readonly objective: string;
  readonly status: ProfessionalAccompanimentStatus;
}
