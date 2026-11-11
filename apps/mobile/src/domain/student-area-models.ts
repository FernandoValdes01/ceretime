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
  // Identidad de sesión; no la entregan los cinco endpoints de solicitudes y acompañamientos.
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
}

export interface StudentRequest {
  // createRequest, listOwnRequests y getRequest: _id -> id, createdAt -> ISO.
  readonly id: string;
  // Públicos: received, underReview, awaitingInformationOrAcceptance y accepted.
  // referred, closedWithoutAccompaniment y cancelled siguen pendientes de TI2-141.
  readonly status: RequestStatus;
  // Provisional: TI2-141 aún no publica el cierre ni su motivo.
  readonly closureReason?: string;
  readonly createdAt: IsoDateTime;
  // Campos locales del formulario/demo. No llegan en listOwnRequests ni getRequest;
  // TI2-141 publicará el contenido completo y sus reglas de envío.
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

/** Contenido del formulario/demo. createRequest solo acepta accessNeeds como texto; el mapper enumera los campos aún no enviados. */
export type SubmitStudentRequestCommand = Readonly<AccompanimentRequestContent>;

// createRequest: _id -> requestId y createdAt -> receivedAt, sin inventar otros datos.
export interface StudentRequestSubmissionReceipt {
  readonly requestId: string;
  readonly receivedAt: IsoDateTime;
}
