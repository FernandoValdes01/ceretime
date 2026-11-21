/**
 * Registro de seguimiento: acuerdos, tareas y próximos pasos (TI2-106).
 *
 * Dominio puro: no importa Convex, React ni Expo. Modela el contenido mínimo
 * posterior a una atención sin convertirlo en ficha clínica: acuerdos, tareas
 * con responsable y estado, próximos pasos y una fecha sugerida. No hay
 * diagnósticos, evaluaciones psicológicas ni historial clínico; la validación
 * rechaza esas etiquetas explícitas.
 *
 * El estado de la atención no se copia: vive en la atención y la vista lo
 * combina al leer. La validación recibe el estado vigente solo para decidir
 * si el seguimiento procede, con una lista explícita de estados posteriores.
 *
 * La nota interna breve no se duplica acá como entidad: `followUpNotes` sigue
 * siendo la única tabla de notas internas. El registro solo la acompaña para
 * que la proyección compartida con el estudiante la omita. La persistencia
 * vive en el repositorio de seguimiento (TI2-118); sin política de acceso
 * (TI2-127) y sin segunda tabla de notas.
 *
 * El primer guardado confirma el registro (TI2-146): desde entonces solo se
 * admite repetirlo idéntico, como reintento. `isFollowUpRetry` decide qué
 * cuenta como repetición; editar, reemplazar o eliminar no tiene vía.
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

/**
 * Acuerdo operativo: una descripción breve. Acuerdos y tareas no llevan un
 * identificador del cliente, porque ACUERDOS_SEGUIMIENTO y TAREAS_SEGUIMIENTO
 * del MER no lo tienen (TI2-165): los distingue su posición en el registro.
 */
export interface FollowUpAgreement {
  readonly description: string;
}

/** Tarea operativa con responsable y estado, sin diagnóstico asociado. */
export interface FollowUpTask {
  readonly description: string;
  readonly responsible: FollowUpResponsible;
  readonly status: FollowUpTaskStatus;
}

/**
 * Registro de seguimiento validado: vista profesional del contenido.
 *
 * No guarda el estado de la atención: ese dato pertenece a la atención y la
 * proyección lo recibe al leer, para que las dos copias no puedan divergir.
 * `internalNote` representa la nota breve de `followUpNotes`, no una segunda
 * entidad. Solo la proyección compartida decide qué sale hacia el estudiante;
 * este tipo nunca debe entregarse tal cual a una vista de estudiante.
 */
export interface FollowUpRecord {
  readonly appointmentId: string;
  readonly accompanimentId: string;
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
 * Omite `internalNote` por construcción. `appointmentStatus` es el estado
 * vigente que la aplicación lee de la atención al proyectar, no una copia
 * guardada en el seguimiento. La autorización de cada vista vive en
 * Aplicación; acá solo se recorta la forma.
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

/** Vistas de lectura del seguimiento según el rol (TI2-127). */
export const FOLLOW_UP_VIEW_VALUES = ["professional", "shared", "minimized"] as const;

export type FollowUpView = (typeof FOLLOW_UP_VIEW_VALUES)[number];

/**
 * Proyección minimizada para el Practicante con asignación activa y vigente.
 *
 * Incluye acuerdos, tareas y próximos pasos con la misma forma que la vista
 * compartida, por decisión del 2026-11-15 (TI2-186): gana el diagrama. Solo
 * para el seguimiento, reemplaza la minimización de TI2-127, que omitía esos
 * textos por posible mención de necesidades de acceso. Mantiene fuera la nota
 * interna y el vínculo con el acompañamiento, que el diagrama no asigna al
 * practicante.
 */
export interface MinimizedFollowUpProjection {
  readonly appointmentId: string;
  readonly appointmentStatus: AppointmentStatus;
  readonly agreements: readonly FollowUpAgreement[];
  readonly tasks: readonly FollowUpTask[];
  readonly nextSteps: string;
  readonly suggestedNextAppointmentDate?: string;
  readonly version: FollowUpContractVersion;
  readonly view: "minimized";
}

/** Proyección de lectura del seguimiento según la vista autorizada. */
export type FollowUpProjection =
  | (SharedFollowUpProjection & { readonly internalNote?: string; readonly view: "professional" })
  | (SharedFollowUpProjection & { readonly view: "shared" })
  | MinimizedFollowUpProjection;

/** Acuerdo de entrada: el adaptador puede traer texto sin normalizar. */
export interface FollowUpAgreementInput {
  readonly description: string;
}

/** Tarea de entrada: responsable y estado llegan como texto a validar. */
export interface FollowUpTaskInput {
  readonly description: string;
  readonly responsible: string;
  readonly status: string;
}

/**
 * Entrada del registro: los estados se validan en tiempo de ejecución.
 *
 * `appointmentStatus` es el estado vigente de la atención y solo decide si el
 * seguimiento procede; no se copia al registro devuelto.
 */
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
  "follow_up_not_admissible",
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

/**
 * Estados posteriores a la atención que admiten registro de seguimiento.
 *
 * La atención realizada y sus desenlaces de inasistencia dejan constancia
 * operativa; una reserva pendiente, un reagendamiento o una cancelación no.
 */
const FOLLOW_UP_ADMISSIBLE_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  "completed",
  "no_show",
  "no_show_justified",
  "no_show_unjustified",
]);

/** Verdadero cuando una atención en ese estado admite registrar su seguimiento. */
export function admitsFollowUp(status: AppointmentStatus): boolean {
  return FOLLOW_UP_ADMISSIBLE_STATUSES.has(status);
}

/** Minúsculas sin tildes, para comparar etiquetas sin depender de la tilde. */
function withoutDiacritics(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Marcadores que declaran contenido clínico, no simples menciones.
 *
 * Es un resguardo contra diagnósticos, fichas e informes, no un clasificador
 * de contenido: el texto libre sigue siendo responsabilidad de quien escribe.
 * Por eso solo se rechaza el diagnóstico cuando aparece como etiqueta con dos
 * puntos (`Diagnóstico:`), y los documentos clínicos por su nombre. Una frase
 * que niega la etiqueta, como «no se necesita diagnóstico», sigue siendo
 * válida. Se comparan sin tildes para no depender de ellas.
 */
const CLINICAL_DOCUMENT_MARKERS = [
  "ficha clínica",
  "informe psicológico",
  "evaluación psicológica",
  "cie-10",
  "cie 10",
  "dsm-5",
  "dsm 5",
].map(withoutDiacritics);

/** Etiqueta de diagnóstico con dos puntos: declara contenido, no lo menciona. */
const CLINICAL_DIAGNOSIS_LABEL = /\bdiagnostico\s*:/;

/** Verdadero cuando el valor es un estado de atención declarado. */
function isAppointmentStatus(value: string): value is AppointmentStatus {
  return (APPOINTMENT_STATUS_VALUES as readonly string[]).includes(value);
}

/** Verdadero cuando el texto declara una etiqueta clínica explícita. */
function hasClinicalLabel(value: string): boolean {
  const comparable = withoutDiacritics(value);
  if (CLINICAL_DIAGNOSIS_LABEL.test(comparable)) return true;
  return CLINICAL_DOCUMENT_MARKERS.some((marker) => comparable.includes(marker));
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

/** Valida la cantidad y las descripciones de acuerdos o tareas. */
function validateEntries(
  entries: ReadonlyArray<{ readonly description: string }>,
  found: Set<FollowUpRejectionCause>,
): void {
  if (entries.length > FOLLOW_UP_ENTRIES_MAX) {
    found.add("entries_limit_exceeded");
  }
  for (const entry of entries) {
    validateText(entry.description, found);
  }
}

/**
 * Valida y normaliza un registro de seguimiento.
 *
 * Devuelve todas las causas únicas en el orden declarado, no solo la primera,
 * para que un formulario pueda señalarlas juntas. Un registro válido sale con
 * los textos recortados y con la versión vigente. No persiste
 * nada: el repositorio de seguimiento (TI2-118) guarda el registro válido.
 */
export function validateFollowUpRecord(input: FollowUpRecordInput): FollowUpValidationResult {
  const found = new Set<FollowUpRejectionCause>();

  const appointmentId = input.appointmentId.trim();
  if (appointmentId === "") found.add("appointment_reference_required");

  const accompanimentId = input.accompanimentId.trim();
  if (accompanimentId === "") found.add("accompaniment_reference_required");

  if (!isAppointmentStatus(input.appointmentStatus)) {
    found.add("appointment_status_unknown");
  } else if (!admitsFollowUp(input.appointmentStatus)) {
    found.add("follow_up_not_admissible");
  }

  const agreements = input.agreements.map((agreement) => ({
    description: agreement.description.trim(),
  }));
  const tasks = input.tasks.map((task) => ({
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
 * Un comparador por cada clave de `T`, incluidas las opcionales: si el tipo
 * suma un campo, el mapa deja de compilar hasta que se decida cómo se compara.
 */
type FieldComparators<T> = { readonly [K in keyof T]-?: (left: T[K], right: T[K]) => boolean };

function same<V>(left: V, right: V): boolean {
  return left === right;
}

function sameFields<T>(left: T, right: T, fields: FieldComparators<T>): boolean {
  return (Object.keys(fields) as (keyof T)[]).every((key) => fields[key](left[key], right[key]));
}

/** Misma cantidad, mismo orden y cada entrada igual campo por campo. */
function sameEntries<T>(fields: FieldComparators<T>) {
  return (confirmed: readonly T[], incoming: readonly T[]): boolean =>
    confirmed.length === incoming.length &&
    confirmed.every((entry, index) => {
      const other = incoming[index];
      return other !== undefined && sameFields(entry, other, fields);
    });
}

const AGREEMENT_FIELDS: FieldComparators<FollowUpAgreement> = { description: same };

const TASK_FIELDS: FieldComparators<FollowUpTask> = {
  description: same,
  responsible: same,
  status: same,
};

const RECORD_FIELDS: FieldComparators<FollowUpRecord> = {
  appointmentId: same,
  accompanimentId: same,
  agreements: sameEntries(AGREEMENT_FIELDS),
  tasks: sameEntries(TASK_FIELDS),
  nextSteps: same,
  suggestedNextAppointmentDate: same,
  internalNote: same,
  version: same,
};

/**
 * Verdadero cuando el guardado repite el registro ya confirmado (TI2-146).
 *
 * Un registro confirmado no se edita: la única escritura posterior que se
 * acepta es el reintento de la misma constancia, que no escribe nada. Compara
 * los dos registros ya validados, así los espacios que el validador recorta no
 * cuentan como cambio; el orden de acuerdos y tareas sí cuenta, porque es el
 * que se guardó y lo único que los distingue (TI2-165). Cualquier diferencia,
 * incluida la nota interna, es un intento
 * de edición. `RECORD_FIELDS` cubre cada campo por tipo: uno nuevo sin
 * comparar no compila, así que no puede volverse una edición silenciosa.
 */
export function isFollowUpRetry(confirmed: FollowUpRecord, incoming: FollowUpRecord): boolean {
  return sameFields(confirmed, incoming, RECORD_FIELDS);
}

/**
 * Proyección compartida con el estudiante.
 *
 * Arma el objeto campo por campo: aunque el registro traiga la nota interna,
 * la salida no puede incluirla ni por accidente. `appointmentStatus` lo aporta
 * la atención vigente al leer; el seguimiento no guarda una copia. Acuerdos y
 * tareas se copian con su forma mínima.
 */
export function toSharedFollowUpProjection(
  record: FollowUpRecord,
  appointmentStatus: AppointmentStatus,
): SharedFollowUpProjection {
  return {
    appointmentId: record.appointmentId,
    accompanimentId: record.accompanimentId,
    appointmentStatus,
    agreements: record.agreements.map(({ description }) => ({ description })),
    tasks: record.tasks.map(({ description, responsible, status }) => ({
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

/**
 * Adaptador explícito de registro a vista de lectura. La vista ya viene
 * decidida por la autorización; acá solo se recorta la forma. La vista
 * minimizada deriva de la compartida quitando solo el vínculo: como lo
 * compartido nunca trae la nota, la garantía se conserva sin duplicar el
 * mapeo. Solo la vista profesional agrega la nota, de forma explícita.
 */
export function toFollowUpProjection(
  record: FollowUpRecord,
  appointmentStatus: AppointmentStatus,
  view: FollowUpView,
): FollowUpProjection {
  if (view === "minimized") {
    const { accompanimentId: _link, ...content } = toSharedFollowUpProjection(
      record,
      appointmentStatus,
    );
    return { ...content, view };
  }
  const shared = toSharedFollowUpProjection(record, appointmentStatus);
  if (view === "shared") return { ...shared, view };
  return {
    ...shared,
    ...(record.internalNote === undefined ? {} : { internalNote: record.internalNote }),
    view,
  };
}
