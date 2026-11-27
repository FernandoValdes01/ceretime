import type { Appointment, AppointmentStatus } from "../../domain/appointments/appointment";
import type {
  FollowUpAgreementInput,
  FollowUpRecord,
  FollowUpRejectionCause,
  FollowUpTaskInput,
} from "../../domain/follow_up/follow_up";

/**
 * Puertos de los casos de uso de seguimiento (TI2-146).
 *
 * Capa de Aplicación: fija lo que guardar y leer necesitan, sin Convex.
 * Infraestructura los cumple por forma con `followUpRecorder(ctx)`,
 * `followUpRecordReader(ctx)` y `appointmentAgendaReader(ctx)`, creados en
 * Presentación con el mismo `ctx`. Las pruebas pasan dobles en memoria.
 */

/** Atención leída en el servidor: lo único que guardar y leer necesitan de ella. */
export interface FollowUpAppointmentReader {
  getAppointment(
    appointmentId: string,
  ): Promise<Pick<Appointment, "id" | "accompanimentId" | "status"> | null>;
}

/** Contenido del registro que escribe el Profesional. */
export interface FollowUpContent {
  readonly agreements: readonly FollowUpAgreementInput[];
  readonly tasks: readonly FollowUpTaskInput[];
  readonly nextSteps: string;
  readonly suggestedNextAppointmentDate?: string;
  readonly internalNote?: string;
}

/** Resultado de la escritura atómica: validación, unicidad e inserción. */
export type FollowUpSaveOutcome =
  | { readonly status: "saved" }
  | { readonly status: "invalid"; readonly causes: readonly FollowUpRejectionCause[] }
  | { readonly status: "invalid_reference" }
  | { readonly status: "already_confirmed" };

/**
 * Escritura del registro. Valida contra el estado vigente de la atención,
 * comprueba el registro confirmado e inserta en una sola transacción: partirla
 * en llamadas separadas permitiría dos registros para la misma atención.
 */
export interface FollowUpRecorder {
  save(
    input: FollowUpContent & {
      readonly appointmentId: string;
      readonly accompanimentId: string;
      readonly authorId: string;
    },
  ): Promise<FollowUpSaveOutcome>;
}

/**
 * Registro guardado, sin el texto de la nota. El estado, el inicio y el
 * acompañamiento vienen de la atención vigente; `internalNoteId` es la única
 * vía a la nota.
 */
export interface StoredFollowUp {
  readonly record: Omit<FollowUpRecord, "internalNote">;
  readonly appointmentStatus: AppointmentStatus;
  readonly appointmentStartsAt: number;
  readonly internalNoteId?: string;
}

/** Página de registros de un acompañamiento, de la atención más reciente a la más antigua. */
export interface StoredFollowUpPage {
  readonly items: readonly StoredFollowUp[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

/** Lecturas del seguimiento. Ninguna autoriza: eso ocurre antes de llamarlas. */
export interface FollowUpRecordReader {
  findByAppointment(appointmentId: string): Promise<StoredFollowUp | null>;
  /**
   * Recorre las atenciones del acompañamiento y entrega las que tienen
   * registro. Una página puede traer menos registros que `limit`, porque
   * cuenta atenciones, no registros. Responde `null` cuando el cursor no
   * salió de esta misma consulta.
   */
  listByAccompaniment(
    accompanimentId: string,
    page: { readonly limit: number; readonly cursor: string | null },
  ): Promise<StoredFollowUpPage | null>;
  /** Texto de la nota, solo si pertenece al acompañamiento indicado. */
  readInternalNote(noteId: string, accompanimentId: string): Promise<string | null>;
}
