/** Presentation models consumed by Mobile screens and hooks. */

export type IsoDateTime = string;

/** Roles are intentionally provisional and limited to this client projection. */
export type ProvisionalRole =
  | "student"
  | "ceretiProfessional"
  | "practitioner"
  | "provisionalAdministrator";

export interface StudentIdentity {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: ProvisionalRole;
}

export interface AccessNeed {
  readonly id: string;
  readonly label: string;
}

export interface GeneralAvailability {
  readonly preferredWeekdays: readonly number[];
  readonly preferredTimeRange?: {
    readonly from: string;
    readonly to: string;
  };
}

export type ModalityPreference = "inPerson" | "online";

/**
 * Provisional and intentionally open: TI2 can map this value to its canonical
 * accessible-information channel, or replace the field, without changing the
 * presentation example.
 */
export type ProvisionalAccessibleInformationChannel = string;

export type StudentRequestStatus =
  | "received"
  | "underReview"
  | "awaitingInformationOrAcceptance"
  | "accepted"
  | "referred"
  | "closedWithoutAccompaniment"
  | "cancelled";

export interface StudentRequest {
  readonly id: string;
  readonly status: StudentRequestStatus;
  /** Present when a request is closed without opening an accompaniment. */
  readonly closureReason?: string;
  readonly createdAt: IsoDateTime;
  readonly updatedAt?: IsoDateTime;
  readonly needSummary?: string;
  readonly expectedOutcome?: string;
  /** TI2 currently exposes the saved needs as one string. */
  readonly accessNeeds: string;
  readonly generalAvailability?: GeneralAvailability;
  readonly modalityPreference?: ModalityPreference;
  readonly preferredAccessibleInformationChannel?: ProvisionalAccessibleInformationChannel;
}

export type AccompanimentStatus = "active" | "paused" | "closed";

/** Presentation projection of a canonical accompaniment. */
export interface Accompaniment {
  readonly id: string;
  readonly status: AccompanimentStatus;
  readonly objective?: string;
  readonly accessNeeds?: string;
  readonly view?: "full" | "minimized";
  /** Not present in TI2's current accompaniment projection. */
  readonly requestId?: string;
  readonly createdAt?: IsoDateTime;
}

export interface StudentAreaSnapshot {
  readonly student: StudentIdentity;
  readonly requests: readonly StudentRequest[];
  readonly accompaniments: readonly Accompaniment[];
}

/** Provisional command used only by the isolated mobile submission flow. */
export interface SubmitStudentRequestCommand {
  readonly needSummary: string;
  readonly expectedOutcome: string;
  readonly accessNeeds: readonly AccessNeed[];
  readonly otherAccessNeed?: string;
  readonly generalAvailability: GeneralAvailability;
  readonly modalityPreference: ModalityPreference;
  readonly preferredAccessibleInformationChannel: ProvisionalAccessibleInformationChannel;
}

/** Minimal receipt returned by a student-request submission capability. */
export interface StudentRequestSubmissionReceipt {
  readonly requestId: string;
  readonly receivedAt: IsoDateTime;
}
