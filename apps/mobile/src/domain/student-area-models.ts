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

// Proyecciones móviles; el contenido de la solicitud procede del dominio compartido.

export type IsoDateTime = string;

export interface StudentIdentity {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
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
  // Solo existe cuando la solicitud se cierra sin abrir un acompañamiento.
  readonly closureReason?: string;
  readonly createdAt: IsoDateTime;
  readonly updatedAt?: IsoDateTime;
  readonly needSummary?: string;
  readonly expectedOutcome?: string;
  // TI2 hoy expone las necesidades guardadas como un único texto.
  readonly accessNeeds: string;
  readonly generalAvailability?: GeneralAvailability;
  readonly modalityPreference?: ModalityPreference;
  readonly preferredAccessibleInformationChannel?: string;
}

// Vista del acompañamiento que recibe la app, derivada del modelo canónico del dominio.
export interface Accompaniment {
  readonly id: string;
  readonly status: AccompanimentStatus;
  readonly objective?: string;
  readonly accessNeeds?: string;
  readonly view?: "full" | "minimized";
  // No viene en la proyección actual de acompañamientos de TI2.
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

// Comprobante mínimo que devuelve el envío de una solicitud.
export interface StudentRequestSubmissionReceipt {
  readonly requestId: string;
  readonly receivedAt: IsoDateTime;
}
