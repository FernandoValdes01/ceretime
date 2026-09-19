import type {
  ProfessionalRequest,
  ProfessionalRequestAction,
  ProfessionalRequestActionReceipt,
} from "./professional-review-models";

export interface ProfessionalReviewReader {
  readProfessionalRequests(): Promise<readonly ProfessionalRequest[]>;
}

export interface ProfessionalReviewActions {
  performProfessionalRequestAction(
    requestId: string,
    action: ProfessionalRequestAction,
  ): Promise<ProfessionalRequestActionReceipt>;
}

export type ProfessionalReviewPort = ProfessionalReviewReader & ProfessionalReviewActions;
