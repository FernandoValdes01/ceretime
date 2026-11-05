// Puerto con que el Profesional lee solicitudes y actúa sobre ellas (revisar, pedir información, aceptar).
import type {
  ProfessionalRequest,
  ProfessionalRequestAction,
  ProfessionalRequestActionReceipt,
  ProfessionalActionDetails,
} from "./professional-review-models";

export interface ProfessionalReviewReader {
  readProfessionalRequests(): Promise<readonly ProfessionalRequest[]>;
}

export interface ProfessionalReviewActions {
  performProfessionalRequestAction(
    requestId: string,
    action: ProfessionalRequestAction,
    details?: ProfessionalActionDetails,
  ): Promise<ProfessionalRequestActionReceipt>;
}

export type ProfessionalReviewPort = ProfessionalReviewReader & ProfessionalReviewActions;
