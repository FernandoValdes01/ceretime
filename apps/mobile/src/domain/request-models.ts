export type { AccompanimentStatus } from "../../../../convex/domain/accompaniments/accompaniment";
import type { AccompanimentStatus } from "../../../../convex/domain/accompaniments/accompaniment";
export type {
  AccessNeed,
  GeneralAvailability,
  ModalityPreference,
} from "../../../../convex/domain/requests/request";

// Tipos que comparten el Estudiante y el Profesional; cada rol define sus propias proyecciones encima.

export type IsoDateTime = string;

export type RequestStatus =
  | "received"
  | "underReview"
  | "awaitingInformationOrAcceptance"
  | "accepted"
  | "referred"
  | "closedWithoutAccompaniment"
  | "cancelled";

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
