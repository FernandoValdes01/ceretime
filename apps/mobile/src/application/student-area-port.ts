// Puertos del Estudiante: leer su área (solicitudes y acompañamientos) y enviar una solicitud nueva.
import type {
  StudentAreaSnapshot,
  StudentRequestSubmissionReceipt,
  StudentRequest,
  SubmitStudentRequestCommand,
} from "../domain/student-area-models";
import type { Accompaniment } from "../domain/request-models";
import { UserFacingError } from "./user-facing-error";

/** Opciones locales para listOwnRequests y listOwnedAccompaniments. Los cursores son opacos. */
export interface StudentPageOptions {
  readonly numItems: number;
  readonly cursor: string | null;
  readonly endCursor?: string | null;
  readonly maximumRowsRead?: number;
  readonly maximumBytesRead?: number;
}

/** Una página vacía puede tener continuación; solo isDone indica el final. */
export interface StudentPage<T> {
  readonly page: readonly T[];
  readonly isDone: boolean;
  readonly continueCursor: string;
  readonly splitCursor?: string | null;
  readonly pageStatus?: "SplitRecommended" | "SplitRequired" | null;
}

/** Consultas públicas propias. La autorización y la identidad se resuelven en el servidor. */
export interface StudentQueries {
  listOwnRequests(options: StudentPageOptions): Promise<StudentPage<StudentRequest>>;
  getRequest(requestId: string): Promise<StudentRequest>;
  listOwnedAccompaniments(options: StudentPageOptions): Promise<StudentPage<Accompaniment>>;
  getAccompaniment(accompanimentId: string): Promise<Accompaniment>;
}

export type StudentPublicOperation = keyof StudentQueries | "createRequest";

/** Códigos locales: unavailable es un fallo sin detalle público, no un código emitido por TI2. */
export type StudentOperationErrorCode =
  | "unauthorized"
  | "access_needs_empty"
  | "access_needs_too_long"
  | "unavailable";

export class StudentOperationError extends UserFacingError {
  constructor(
    readonly operation: StudentPublicOperation,
    readonly code: StudentOperationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StudentOperationError";
  }
}

/** Intenciones provisionales, sin método ejecutable ni comprobante de éxito ficticio. */
export type ProvisionalStudentRequestAction =
  | {
      readonly kind: "cancelRequest";
      readonly requestId: string;
      readonly reason: string;
    }
  | {
      readonly kind: "respondToInformationRequest";
      readonly requestId: string;
      readonly response: string;
    };

export const PROVISIONAL_STUDENT_REQUEST_OPERATIONS = {
  cancelRequest: {
    status: "provisional",
    reference: "convex/application/requests/commands.ts#cancelRequest",
    publicationIssue: "TI2-141",
  },
  respondToInformationRequest: {
    status: "provisional",
    // TI2-141 confirma que este caso de uso todavía no existe; la firma local no es su contrato.
    reference: "TI2-141: respuesta del estudiante a la información solicitada",
    publicationIssue: "TI2-141",
  },
} as const;

/** Lectura del área estudiantil, sin dependencias de React ni del transporte. */
export interface StudentAreaReader {
  readStudentArea(): Promise<StudentAreaSnapshot>;
  subscribe?(onChange: () => void): () => void;
}

/** Envío de contenido completo. La composición actual selecciona un simulador local. */
export interface StudentRequestSubmitter {
  submitStudentRequest(
    command: SubmitStudentRequestCommand,
  ): Promise<StudentRequestSubmissionReceipt>;
}
