import type { AccompanimentRequestContent } from "../../../../convex/domain/requests/request";
import type {
  Accompaniment,
  GeneralAvailability,
  IsoDateTime,
  ModalityPreference,
  RequestStatus,
} from "./request-models";

// Proyecciones móviles; el contenido de la solicitud procede del dominio compartido.

export interface StudentIdentity {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
}

export interface StudentRequest {
  readonly id: string;
  readonly status: RequestStatus;
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
