import type {
  Accompaniment,
  GeneralAvailability,
  IsoDateTime,
  ModalityPreference,
  RequestStatus,
} from "./request-models";

export type ProfessionalRequestAction = "startReview" | "requestInformation" | "accept";

export interface ProfessionalActionDetails {
  readonly reason?: string;
  readonly objective?: string;
}

export interface ProfessionalRequest {
  readonly id: string;
  readonly studentId?: string;
  readonly studentName?: string;
  readonly status: RequestStatus;
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

// Lo que el servidor confirmó de la solicitud: el resto se conserva de la que ya mostraba la pantalla.
export type ProfessionalRequestUpdate = Pick<
  ProfessionalRequest,
  "id" | "status" | "availableActions"
> &
  Partial<ProfessionalRequest>;

export interface ProfessionalRequestActionReceipt {
  readonly request: ProfessionalRequestUpdate;
  readonly action: ProfessionalRequestAction;
  readonly message: string;
}
