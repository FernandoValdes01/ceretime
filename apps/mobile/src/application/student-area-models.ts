/**
 * Provisional Sprint 1 client projections. These are not canonical CERETI
 * contracts; TI2 may map or replace them when its API contract is available.
 */

export type IsoDateTime = string;

/** Roles are intentionally provisional and limited to this client projection. */
export type ProvisionalRole =
  | 'student'
  | 'ceretiProfessional'
  | 'practitioner'
  | 'provisionalAdministrator';

export interface StudentIdentity {
  readonly id: string;
  readonly displayName: string;
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

export type ModalityPreference = 'inPerson' | 'online';

/**
 * Provisional and intentionally open: TI2 can map this value to its canonical
 * accessible-information channel, or replace the field, without changing the
 * presentation example.
 */
export type ProvisionalAccessibleInformationChannel = string;

export type StudentRequestStatus =
  | 'received'
  | 'underReview'
  | 'awaitingInformationOrAcceptance'
  | 'accepted'
  | 'referred'
  | 'closedWithoutAccompaniment'
  | 'cancelled';

export type StudentRequestOrigin = 'student' | 'institutionalChannel';

export interface StudentRequest {
  readonly id: string;
  readonly status: StudentRequestStatus;
  readonly origin: StudentRequestOrigin;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly needSummary: string;
  readonly expectedOutcome: string;
  readonly accessNeeds: readonly AccessNeed[];
  readonly generalAvailability: GeneralAvailability;
  readonly modalityPreference: ModalityPreference;
  readonly preferredAccessibleInformationChannel: ProvisionalAccessibleInformationChannel;
}

export type AccompanimentStatus = 'active' | 'paused' | 'closed';

/** The minimum resulting representation for an accepted request. */
export interface Accompaniment {
  readonly id: string;
  readonly requestId: string;
  readonly status: AccompanimentStatus;
  readonly createdAt: IsoDateTime;
}

export interface StudentAreaSnapshot {
  readonly student: StudentIdentity;
  readonly requests: readonly StudentRequest[];
  readonly accompaniments: readonly Accompaniment[];
}
