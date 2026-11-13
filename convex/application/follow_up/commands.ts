import type { Appointment } from "../../domain/appointments/appointment";
import {
  CONFLICT_ERROR_CODE,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import {
  FOLLOW_UP_ENTRIES_MAX,
  FOLLOW_UP_TEXT_MAX_LENGTH,
  type FollowUpAgreementInput,
  type FollowUpRejectionCause,
  type FollowUpTaskInput,
} from "../../domain/follow_up/follow_up";
import { authorizeFollowUpWrite, type AuthorizationReader } from "../authorization/authorize";

/**
 * Guardar y confirmar el registro de seguimiento de una atención (TI2-146).
 *
 * Capa de Aplicación: coordina por puertos y no toca `ctx.db`. La atención se
 * lee en el servidor y de ella salen el acompañamiento y su estado; el cliente
 * solo nombra la atención. La autorización es la de TI2-127
 * (`authorizeFollowUpWrite`): Profesional con asignación activa y
 * acompañamiento activo. El autor es el perfil de la sesión, nunca un
 * identificador del cliente.
 *
 * El primer guardado confirma el registro. Repetirlo idéntico responde lo
 * mismo sin escribir; otro contenido se rechaza con `conflict`, igual que los
 * datos que no cumplen las reglas de TI2-106. Una atención inexistente o
 * ajena responde `unauthorized`, sin revelar si existe.
 *
 * Opera con datos ficticios.
 */

/** Atención leída en el servidor: lo único que el guardado necesita de ella. */
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

/** Dependencias del guardado, todas por puerto. */
export interface SaveFollowUpRecordDeps {
  readonly auth: AuthorizationReader;
  readonly appointments: FollowUpAppointmentReader;
  readonly recorder: FollowUpRecorder;
}

/** Entrada del guardado: la sesión del servidor, la atención y el contenido. */
export type SaveFollowUpRecordCommand = FollowUpContent & {
  readonly tokenIdentifier: string | null;
  readonly appointmentId: string;
};

/** Mensaje público ante un registro ya confirmado con otro contenido. */
export const FOLLOW_UP_ALREADY_CONFIRMED_MESSAGE =
  "El seguimiento de esta atención ya está confirmado y no se puede cambiar.";

/**
 * Qué corregir por cada causa de TI2-106. El tipo exige un mensaje por causa,
 * así una causa nueva no llega al cliente sin explicación.
 */
const FOLLOW_UP_REJECTION_MESSAGES: Readonly<Record<FollowUpRejectionCause, string>> = {
  appointment_reference_required: "Falta indicar la atención.",
  accompaniment_reference_required: "Falta indicar el acompañamiento.",
  appointment_status_unknown: "La atención tiene un estado desconocido.",
  follow_up_not_admissible:
    "La atención todavía no admite seguimiento: debe estar realizada o con la inasistencia registrada.",
  entry_id_required: "Cada acuerdo y cada tarea necesitan un identificador.",
  duplicate_entry_id: "Hay acuerdos o tareas con el identificador repetido.",
  text_required:
    "Hay textos vacíos: completa los acuerdos, las tareas, los próximos pasos y, si la incluyes, la nota interna.",
  text_too_long: `Cada texto admite hasta ${FOLLOW_UP_TEXT_MAX_LENGTH} caracteres.`,
  entries_limit_exceeded: `Se admiten hasta ${FOLLOW_UP_ENTRIES_MAX} acuerdos y ${FOLLOW_UP_ENTRIES_MAX} tareas.`,
  responsible_unknown: "Una tarea tiene un responsable desconocido.",
  task_status_unknown: "Una tarea tiene un estado desconocido.",
  suggested_date_invalid: "La fecha sugerida debe ser una fecha válida con formato AAAA-MM-DD.",
  clinical_content_not_allowed:
    "El seguimiento no admite diagnósticos, evaluaciones psicológicas ni documentos clínicos.",
};

/** `conflict` con el mensaje de lo que hay que corregir, en el orden de las causas. */
function rejected<T>(causes: readonly FollowUpRejectionCause[]): ApiResult<T> {
  const message = causes.map((cause) => FOLLOW_UP_REJECTION_MESSAGES[cause]).join(" ");
  return errResult({ code: CONFLICT_ERROR_CODE, message });
}

/**
 * Guarda y confirma el registro de la atención. Responde la misma atención,
 * igual en el primer guardado y en un reintento idéntico.
 */
export async function saveFollowUpRecord(
  deps: SaveFollowUpRecordDeps,
  command: SaveFollowUpRecordCommand,
): Promise<ApiResult<{ readonly appointmentId: string }>> {
  const { tokenIdentifier, appointmentId, ...content } = command;
  const appointment = await deps.appointments.getAppointment(appointmentId);
  if (appointment === null) return errResult(unauthorizedError());

  const grant = await authorizeFollowUpWrite(deps.auth, {
    tokenIdentifier,
    accompanimentId: appointment.accompanimentId,
  });
  if (grant.status === "error") return grant;

  const outcome = await deps.recorder.save({
    ...content,
    appointmentId: appointment.id,
    accompanimentId: appointment.accompanimentId,
    authorId: grant.data.callerId,
  });
  switch (outcome.status) {
    case "saved":
      return okResult({ appointmentId: appointment.id });
    case "invalid":
      return rejected(outcome.causes);
    case "already_confirmed":
      return errResult({ code: CONFLICT_ERROR_CODE, message: FOLLOW_UP_ALREADY_CONFIRMED_MESSAGE });
    case "invalid_reference":
      // La atención ya se leyó y el autor es el perfil de la sesión, así que
      // no debería ocurrir; si ocurre, se responde como acceso denegado.
      return errResult(unauthorizedError());
  }
}
