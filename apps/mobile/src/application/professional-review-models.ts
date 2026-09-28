import type {
  Accompaniment,
  GeneralAvailability,
  IsoDateTime,
  ModalityPreference,
  StudentRequestStatus,
} from "./student-area-models";

export type ProfessionalRequestAction = "startReview" | "requestInformation" | "accept";

export interface ProfessionalActionDetails {
  readonly reason?: string;
  readonly objective?: string;
}

export interface ProfessionalRequest {
  readonly id: string;
  readonly studentId?: string;
  readonly studentName?: string;
  readonly status: StudentRequestStatus;
  readonly createdAt: IsoDateTime;
  readonly updatedAt?: IsoDateTime;
  readonly needSummary?: string;
  readonly expectedOutcome?: string;
  readonly accessNeeds?: string;
  readonly generalAvailability?: GeneralAvailability;
  readonly modalityPreference?: ModalityPreference;
  readonly preferredAccessibleInformationChannel?: string;
  readonly availableActions: readonly ProfessionalRequestAction[];
  readonly accompaniment?: Accompaniment;
}

export interface ProfessionalRequestActionReceipt {
  readonly request: ProfessionalRequest;
  readonly action: ProfessionalRequestAction;
  readonly message: string;
}
