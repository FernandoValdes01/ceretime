import {
  CONFLICT_ERROR_CODE,
  FOLLOW_UP_FIELDS_INVALID_ERROR_CODE,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import {
  FOLLOW_UP_ENTRIES_MAX,
  FOLLOW_UP_TEXT_MAX_LENGTH,
  type FollowUpRejectionCause,
} from "../../domain/follow_up/follow_up";
import { authorizeFollowUpWrite, type AuthorizationReader } from "../authorization/authorize";
import type { FollowUpAppointmentReader, FollowUpContent, FollowUpRecorder } from "./ports";

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
 * mismo sin escribir; otro contenido, o una atención que todavía no admite
 * seguimiento, se rechaza con `conflict`, porque depende del estado. Los datos
 * que no cumplen las reglas de TI2-106 responden `follow_up_fields_invalid`,
 * con qué corregir. Una atención inexistente o ajena responde
 * `unauthorized`, sin revelar si existe. Una referencia que el servidor ya
 * resolvió y llega rechazada es un defecto interno, no un error del cliente.
 *
 * Opera con datos ficticios.
 */

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
 * Causas de referencias que resuelve el servidor: el acompañamiento sale de la
 * atención leída y la atención ya se encontró. El cliente no puede
 * corregirlas desde el formulario.
 */
type ServerResolvedCause = "appointment_reference_required" | "accompaniment_reference_required";

const SERVER_RESOLVED_CAUSES: ReadonlySet<FollowUpRejectionCause> = new Set<ServerResolvedCause>([
  "appointment_reference_required",
  "accompaniment_reference_required",
]);

function isClientCause(
  cause: FollowUpRejectionCause,
): cause is Exclude<FollowUpRejectionCause, ServerResolvedCause> {
  return !SERVER_RESOLVED_CAUSES.has(cause);
}

/**
 * Qué corregir por cada causa de TI2-106 que llega al cliente. El tipo exige
 * un mensaje por causa, así una causa nueva no llega sin explicación.
 */
const FOLLOW_UP_REJECTION_MESSAGES: Readonly<
  Record<Exclude<FollowUpRejectionCause, ServerResolvedCause>, string>
> = {
  appointment_status_unknown: "La atención tiene un estado desconocido.",
  follow_up_not_admissible:
    "La atención todavía no admite seguimiento: debe estar realizada o con la inasistencia registrada.",
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

/**
 * Causas que dependen del estado de la atención, no de lo que escribió el
 * Profesional: corregir el formulario no las resuelve.
 */
const STATE_CAUSES: ReadonlySet<FollowUpRejectionCause> = new Set([
  "appointment_status_unknown",
  "follow_up_not_admissible",
]);

/**
 * Si la atención no admite seguimiento, `conflict` con ese motivo, porque
 * los campos no importan todavía. Si no, `follow_up_fields_invalid` con lo
 * que hay que corregir, en el orden de las causas. Una causa que resuelve el
 * servidor lanza un error interno, igual que `invalid_reference`.
 */
function rejected<T>(allCauses: readonly FollowUpRejectionCause[]): ApiResult<T> {
  const causes = allCauses.filter(isClientCause);
  if (causes.length < allCauses.length) throw serverReferenceError();
  const stateCauses = causes.filter((cause) => STATE_CAUSES.has(cause));
  const reported = stateCauses.length > 0 ? stateCauses : causes;
  const message = reported.map((cause) => FOLLOW_UP_REJECTION_MESSAGES[cause]).join(" ");
  const code = stateCauses.length > 0 ? CONFLICT_ERROR_CODE : FOLLOW_UP_FIELDS_INVALID_ERROR_CODE;
  return errResult({ code, message });
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
      // La atención ya se leyó y el autor es el perfil de la sesión: llegar
      // aquí es un defecto del servidor, no un problema de permisos.
      throw serverReferenceError();
  }
}

function serverReferenceError(): Error {
  return new Error(
    "El guardado del seguimiento recibió una referencia que el servidor ya había resuelto.",
  );
}
