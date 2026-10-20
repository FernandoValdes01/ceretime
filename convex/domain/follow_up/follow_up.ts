/**
 * Registro de seguimiento: acuerdos, tareas y próximos pasos (TI2-106).
 *
 * Dominio puro: no importa Convex, React ni Expo. Modela el contenido mínimo
 * posterior a una atención sin convertirlo en ficha clínica: estado de la
 * atención, acuerdos, tareas con responsable y estado, próximos pasos y una
 * fecha sugerida. No hay diagnósticos, evaluaciones psicológicas ni historial
 * clínico; la validación rechaza esas etiquetas explícitas.
 *
 * La nota interna breve no se duplica acá como entidad: `followUpNotes` sigue
 * siendo la única tabla de notas internas. El registro solo la acompaña para
 * que la proyección compartida con el estudiante la omita. Sin persistencia
 * (TI2-118), sin política de acceso (TI2-127) y sin segunda tabla de notas.
 */

import { APPOINTMENT_STATUS_VALUES, type AppointmentStatus } from "../appointments/appointment";
import { isValidCivilDate } from "../availability/availability";

/** Versión del contrato público del registro de seguimiento. */
export const FOLLOW_UP_CONTRACT_VERSION = "v1" as const;

export type FollowUpContractVersion = typeof FOLLOW_UP_CONTRACT_VERSION;

/** Estados operativos de una tarea; ninguno describe una evaluación clínica. */
export const FOLLOW_UP_TASK_STATUS_VALUES = [
  "pending",
  "in_progress",
  "done",
  "cancelled",
] as const;

export type FollowUpTaskStatus = (typeof FOLLOW_UP_TASK_STATUS_VALUES)[number];

/** Verdadero cuando el valor es un estado de tarea conocido. */
export function isFollowUpTaskStatus(value: string): value is FollowUpTaskStatus {
  return (FOLLOW_UP_TASK_STATUS_VALUES as readonly string[]).includes(value);
}

/** Responsables posibles de una tarea, sin exponer identidades ni vínculos. */
export const FOLLOW_UP_RESPONSIBLE_VALUES = ["student", "professional", "cereti"] as const;

export type FollowUpResponsible = (typeof FOLLOW_UP_RESPONSIBLE_VALUES)[number];

/** Verdadero cuando el valor es un responsable conocido. */
export function isFollowUpResponsible(value: string): value is FollowUpResponsible {
  return (FOLLOW_UP_RESPONSIBLE_VALUES as readonly string[]).includes(value);
}

/** Largo máximo de cada texto operativo, incluida la nota interna. */
export const FOLLOW_UP_TEXT_MAX_LENGTH = 500;

/** Cantidad máxima de acuerdos y de tareas en un registro. */
export const FOLLOW_UP_ENTRIES_MAX = 20;

/** Acuerdo operativo: identificador estable y descripción breve. */
export interface FollowUpAgreement {
  readonly id: string;
  readonly description: string;
}

/** Tarea operativa con responsable y estado, sin diagnóstico asociado. */
export interface FollowUpTask {
  readonly id: string;
  readonly description: string;
  readonly responsible: FollowUpResponsible;
  readonly status: FollowUpTaskStatus;
}

/**
 * Registro de seguimiento validado: vista profesional del contenido.
 *
 * `internalNote` representa la nota breve de `followUpNotes`, no una segunda
 * entidad. Solo la proyección compartida decide qué sale hacia el estudiante;
 * este tipo nunca debe entregarse tal cual a una vista de estudiante.
 */
export interface FollowUpRecord {
  readonly appointmentId: string;
  readonly accompanimentId: string;
  readonly appointmentStatus: AppointmentStatus;
  readonly agreements: readonly FollowUpAgreement[];
  readonly tasks: readonly FollowUpTask[];
  readonly nextSteps: string;
  /** Fecha civil `YYYY-MM-DD` sugerida para la próxima atención. */
  readonly suggestedNextAppointmentDate?: string;
  readonly internalNote?: string;
  readonly version: FollowUpContractVersion;
}

/**
 * Proyección compartida con el estudiante: acuerdos, tareas y próximos pasos.
 *
 * Omite `internalNote` por construcción. La autorización de cada vista vive
 * en Aplicación; acá solo se recorta la forma.
 */
export interface SharedFollowUpProjection {
  readonly appointmentId: string;
  readonly accompanimentId: string;
  readonly appointmentStatus: AppointmentStatus;
  readonly agreements: readonly FollowUpAgreement[];
  readonly tasks: readonly FollowUpTask[];
  readonly nextSteps: string;
  readonly suggestedNextAppointmentDate?: string;
  readonly version: FollowUpContractVersion;
}

/** Acuerdo de entrada: el adaptador puede traer texto sin normalizar. */
export interface FollowUpAgreementInput {
  readonly id: string;
  readonly description: string;
}

/** Tarea de entrada: responsable y estado llegan como texto a validar. */
export interface FollowUpTaskInput {
  readonly id: string;
  readonly description: string;
  readonly responsible: string;
  readonly status: string;
}

/** Entrada del registro: los estados se validan en tiempo de ejecución. */
export interface FollowUpRecordInput {
  readonly appointmentId: string;
  readonly accompanimentId: string;
  readonly appointmentStatus: string;
  readonly agreements: readonly FollowUpAgreementInput[];
  readonly tasks: readonly FollowUpTaskInput[];
  readonly nextSteps: string;
  readonly suggestedNextAppointmentDate?: string;
  readonly internalNote?: string;
}

/** Causas de rechazo, devueltas como valor y no como excepción. */
export const FOLLOW_UP_REJECTION_CAUSES = [
  "appointment_reference_required",
  "accompaniment_reference_required",
  "appointment_status_unknown",
  "entry_id_required",
  "duplicate_entry_id",
  "text_required",
  "text_too_long",
  "entries_limit_exceeded",
  "responsible_unknown",
  "task_status_unknown",
  "suggested_date_invalid",
  "clinical_content_not_allowed",
] as const;

export type FollowUpRejectionCause = (typeof FOLLOW_UP_REJECTION_CAUSES)[number];

export type FollowUpValidationResult =
  | { readonly status: "valid"; readonly record: FollowUpRecord }
  | { readonly status: "invalid"; readonly causes: readonly FollowUpRejectionCause[] };

/** Minúsculas sin tildes, para comparar etiquetas sin depender de la tilde. */
function withoutDiacritics(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Etiquetas clínicas explícitas que el registro no admite.
 *
 * Es un resguardo contra diagnósticos, fichas e informes, no un clasificador
 * de contenido: el texto libre sigue siendo responsabilidad de quien escribe.
 * Se guardan normalizadas para compararlas sin depender de la tilde.
 */
const CLINICAL_CONTENT_MARKERS = [
  "diagnóstico",
  "ficha clínica",
  "informe psicológico",
  "evaluación psicológica",
  "cie-10",
  "cie 10",
  "dsm-5",
  "dsm 5",
].map(withoutDiacritics);

/** Verdadero cuando el valor es un estado de atención declarado. */
function isAppointmentStatus(value: string): value is AppointmentStatus {
  return (APPOINTMENT_STATUS_VALUES as readonly string[]).includes(value);
}

/** Verdadero cuando el texto declara una etiqueta clínica explícita. */
function hasClinicalLabel(value: string): boolean {
  const comparable = withoutDiacritics(value);
  return CLINICAL_CONTENT_MARKERS.some((marker) => comparable.includes(marker));
}

/**
 * Valida un texto operativo: no vacío, dentro del largo y sin etiqueta clínica.
 *
 * Un texto vacío no agrega causa clínica: el error útil es que falta contenido.
 */
function validateText(value: string, found: Set<FollowUpRejectionCause>): void {
  if (value === "") {
    found.add("text_required");
    return;
  }
  if (value.length > FOLLOW_UP_TEXT_MAX_LENGTH) {
    found.add("text_too_long");
  }
  if (hasClinicalLabel(value)) {
    found.add("clinical_content_not_allowed");
  }
}

/** Valida identificadores únicos y descripciones de acuerdos o tareas. */
function validateEntries(
  entries: ReadonlyArray<{ readonly id: string; readonly description: string }>,
  found: Set<FollowUpRejectionCause>,
): void {
  if (entries.length > FOLLOW_UP_ENTRIES_MAX) {
    found.add("entries_limit_exceeded");
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.id === "") {
      found.add("entry_id_required");
    } else if (seen.has(entry.id)) {
      found.add("duplicate_entry_id");
    }
    seen.add(entry.id);
    validateText(entry.description, found);
  }
}

/**
 * Valida y normaliza un registro de seguimiento.
 *
 * Devuelve todas las causas únicas en el orden declarado, no solo la primera,
 * para que un formulario pueda señalarlas juntas. Un registro válido sale con
 * textos e identificadores recortados y con la versión vigente. No persiste
 * nada: TI2-118 decide el almacenamiento.
 */
export function validateFollowUpRecord(input: FollowUpRecordInput): FollowUpValidationResult {
  const found = new Set<FollowUpRejectionCause>();

  const appointmentId = input.appointmentId.trim();
  if (appointmentId === "") found.add("appointment_reference_required");

  const accompanimentId = input.accompanimentId.trim();
  if (accompanimentId === "") found.add("accompaniment_reference_required");

  if (!isAppointmentStatus(input.appointmentStatus)) found.add("appointment_status_unknown");

  const agreements = input.agreements.map((agreement) => ({
    id: agreement.id.trim(),
    description: agreement.description.trim(),
  }));
  const tasks = input.tasks.map((task) => ({
    id: task.id.trim(),
    description: task.description.trim(),
    responsible: task.responsible,
    status: task.status,
  }));

  validateEntries(agreements, found);
  validateEntries(tasks, found);
  for (const task of tasks) {
    if (!isFollowUpResponsible(task.responsible)) found.add("responsible_unknown");
    if (!isFollowUpTaskStatus(task.status)) found.add("task_status_unknown");
  }

  const nextSteps = input.nextSteps.trim();
  validateText(nextSteps, found);

  const suggestedNextAppointmentDate = input.suggestedNextAppointmentDate?.trim();
  if (
    suggestedNextAppointmentDate !== undefined &&
    !isValidCivilDate(suggestedNextAppointmentDate)
  ) {
    found.add("suggested_date_invalid");
  }

  const internalNote = input.internalNote?.trim();
  if (internalNote !== undefined) validateText(internalNote, found);

  if (found.size > 0) {
    return {
      status: "invalid",
      causes: FOLLOW_UP_REJECTION_CAUSES.filter((cause) => found.has(cause)),
    };
  }

  return {
    status: "valid",
    record: {
      appointmentId,
      accompanimentId,
      appointmentStatus: input.appointmentStatus as AppointmentStatus,
      agreements,
      tasks: tasks.map((task) => ({
        ...task,
        responsible: task.responsible as FollowUpResponsible,
        status: task.status as FollowUpTaskStatus,
      })),
      nextSteps,
      ...(suggestedNextAppointmentDate === undefined ? {} : { suggestedNextAppointmentDate }),
      ...(internalNote === undefined ? {} : { internalNote }),
      version: FOLLOW_UP_CONTRACT_VERSION,
    },
  };
}

/**
 * Proyección compartida con el estudiante.
 *
 * Arma el objeto campo por campo: aunque el registro traiga la nota interna,
 * la salida no puede incluirla ni por accidente. Acuerdos y tareas se copian
 * con su forma mínima.
 */
export function toSharedFollowUpProjection(record: FollowUpRecord): SharedFollowUpProjection {
  return {
    appointmentId: record.appointmentId,
    accompanimentId: record.accompanimentId,
    appointmentStatus: record.appointmentStatus,
    agreements: record.agreements.map(({ id, description }) => ({ id, description })),
    tasks: record.tasks.map(({ id, description, responsible, status }) => ({
      id,
      description,
      responsible,
      status,
    })),
    nextSteps: record.nextSteps,
    ...(record.suggestedNextAppointmentDate === undefined
      ? {}
      : { suggestedNextAppointmentDate: record.suggestedNextAppointmentDate }),
    version: record.version,
  };
}
