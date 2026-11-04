import type { AccompanimentStatus } from "../../../../convex/domain/accompaniments/accompaniment";
export type { AccompanimentStatus } from "../../../../convex/domain/accompaniments/accompaniment";
import type {
  AccompanimentRequestContent,
  GeneralAvailability,
  ModalityPreference,
} from "../../../../convex/domain/requests/request";
export type {
  AccessNeed,
  GeneralAvailability,
  ModalityPreference,
} from "../../../../convex/domain/requests/request";

/** Proyecciones móviles; el contenido de la solicitud procede del dominio compartido. */

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
  readonly preferredAccessibleInformationChannel?: string;
}

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

/** Contenido canónico completo, usado por el formulario y el simulador local. */
export type SubmitStudentRequestCommand = Readonly<AccompanimentRequestContent>;

/** Minimal receipt returned by a student-request submission capability. */
export interface StudentRequestSubmissionReceipt {
  readonly requestId: string;
  readonly receivedAt: IsoDateTime;
}
