/**
 * Provisional Mobile client models for Sprint 1.
 *
 * These are client-facing projections for the demo only. They are not the
 * canonical CERETI domain contract and must not become a second source of
 * truth. A future adapter can map TI2's approved API contract to this port.
 */

export type IsoDateTime = string;

export type UserArea = 'student' | 'management';

/** Provisional roles documented for the initial client experience. */
export type ProvisionalRole =
  | 'student'
  | 'ceretiProfessional'
  | 'practitioner'
  | 'provisionalAdministrator';

export interface MobileUser {
  readonly id: string;
  readonly displayName: string;
  readonly institutionalEmail: string;
  readonly area: UserArea;
  readonly role: ProvisionalRole;
}

export interface AccessNeed {
  readonly id: string;
  readonly label: string;
  /** Keep sensitive detail minimal in the client projection. */
  readonly detail?: string;
}

export interface GeneralAvailability {
  readonly preferredWeekdays: readonly number[];
  readonly preferredTimeRange?: {
    readonly from: string;
    readonly to: string;
  };
  readonly preferredModality?: 'inPerson' | 'online' | 'either';
  readonly note?: string;
}

export type StudentRequestStatus =
  | 'received'
  | 'underReview'
  | 'awaitingInformationOrAcceptance'
  | 'accepted'
  | 'referred'
  | 'closedWithoutAccompaniment'
  | 'cancelled';

export interface StudentRequest {
  readonly id: string;
  readonly status: StudentRequestStatus;
  readonly needSummary: string;
  readonly expectedOutcome?: string;
  readonly accessNeeds: readonly AccessNeed[];
  readonly generalAvailability: GeneralAvailability;
  readonly createdAt: IsoDateTime;
  readonly origin: 'student' | 'institutionalChannel';
}

export type AccompanimentStatus = 'active' | 'paused' | 'closed';

export interface Accompaniment {
  readonly id: string;
  readonly requestId: string;
  readonly status: AccompanimentStatus;
  readonly objective: string;
  readonly professionalNames: readonly string[];
  readonly openedAt: IsoDateTime;
  readonly closedAt?: IsoDateTime;
}

export type AppointmentStatus =
  | 'scheduled'
  | 'completed'
  | 'cancelled'
  | 'rescheduled'
  | 'noShow';

export interface Appointment {
  readonly id: string;
  readonly accompanimentId: string;
  readonly status: AppointmentStatus;
  readonly startsAt: IsoDateTime;
  readonly endsAt: IsoDateTime;
  readonly modality: 'inPerson' | 'online';
  readonly locationLabel?: string;
  /** Snapshot preserves the access needs used for this appointment. */
  readonly accessNeedsSnapshot: readonly AccessNeed[];
  readonly cancellationReason?: string;
  readonly absence?: {
    readonly status: 'registered' | 'justified' | 'unjustified';
    readonly explanationReceivedAt?: IsoDateTime;
  };
}

export interface FollowUpAgreement {
  readonly id: string;
  readonly summary: string;
  readonly agreedAt: IsoDateTime;
}

export interface FollowUpTask {
  readonly id: string;
  readonly summary: string;
  readonly responsibleName: string;
  readonly dueAt?: IsoDateTime;
  readonly completed: boolean;
}

export interface OperationalFollowUp {
  readonly id: string;
  readonly accompanimentId: string;
  readonly appointmentId: string;
  readonly summary: string;
  readonly nextStep?: string;
  readonly suggestedNextDate?: IsoDateTime;
  readonly agreements: readonly FollowUpAgreement[];
  readonly tasks: readonly FollowUpTask[];
  /** Internal notes are intentionally not included in this student projection. */
}

/** Data the Sprint 1 student area needs; returned by the client port. */
export interface StudentAreaSnapshot {
  readonly user: MobileUser;
  readonly requests: readonly StudentRequest[];
  readonly accompaniments: readonly Accompaniment[];
  readonly appointments: readonly Appointment[];
  readonly followUps: readonly OperationalFollowUp[];
}

/**
 * Replaceable client boundary. The mock is only one implementation; a future
 * TI2 canonical-contract adapter should map its responses to this projection.
 */
export interface MobileClient {
  getStudentArea(): Promise<StudentAreaSnapshot>;
}
