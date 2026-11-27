import { useEffect, useRef, useState } from "react";
import {
  CONFLICT_ERROR_CODE,
  FOLLOW_UP_CONTRACT_VERSION,
  FOLLOW_UP_ENTRIES_MAX,
  FOLLOW_UP_RESPONSIBLE_VALUES,
  FOLLOW_UP_TASK_STATUS_VALUES,
  FOLLOW_UP_TEXT_MAX_LENGTH,
  UNAUTHORIZED_ERROR_CODE,
  admitsFollowUp,
  type AppointmentStatus,
  type FollowUpResponsible,
  type FollowUpTaskStatus,
} from "../../../../../convex/domain/index.ts";
import { publicErrorOf } from "../../infrastructure/convex/public-error.ts";
import { ACCESS_DENIED_MESSAGE, DeniedState, LoadingState } from "../shared/view-states.tsx";
import { GESTION_FOCUS_VISIBLE } from "./assigned-accompaniments-list.tsx";
import { isAuthorizationDenial } from "../shared/authorization-denial.ts";
import { useFollowUpRecord, useSaveFollowUpRecord } from "../shared/follow-up/follow-up-data.ts";
import {
  FollowUpRecordContent,
  type FollowUpContent,
} from "../shared/follow-up/follow-up-record.tsx";
import {
  followUpResponsibleLabel,
  followUpTaskStatusLabel,
} from "../shared/follow-up/follow-up-labels.ts";

/**
 * Seguimiento de una atención desde la agenda del Profesional (TI2-165).
 *
 * Sin registro, ofrece el formulario; con registro, lo muestra en solo
 * lectura, porque el primer guardado lo confirma. El formulario separa lo que
 * se comparte con el estudiante de la nota interna con un grupo propio para
 * cada parte, su leyenda en texto y un borde distinto, sin depender solo del
 * color. Antes de guardar se muestra el resumen y se pide confirmar. Repetir
 * el guardado con el mismo contenido no duplica: el Backend responde lo mismo
 * sin escribir (`docs/contratos-sprint-3/seguimiento.md`).
 */

const FIELD = `min-h-[44px] w-full min-w-0 box-border rounded-[0.5rem] border border-outline bg-surface-container-lowest px-3 py-2 text-base text-on-surface ${GESTION_FOCUS_VISIBLE}`;
const TEXTAREA = `${FIELD} min-h-24 resize-y`;
const LABEL = "mb-2 block text-sm font-semibold text-on-surface";
const SHARED_GROUP =
  "m-0 flex min-w-0 flex-col gap-4 rounded-lg border border-border-low bg-surface-container-lowest p-4";
const INTERNAL_GROUP =
  "m-0 flex min-w-0 flex-col gap-4 rounded-lg border-2 border-dashed border-outline bg-surface-container-low p-4";
const LEGEND = "px-1 text-base font-bold text-on-surface";
const ENTRY = "flex flex-col gap-3 rounded-lg border border-border-low p-3";

type TaskDraft = {
  description: string;
  responsible: FollowUpResponsible;
  status: FollowUpTaskStatus;
};

type FollowUpDraft = {
  agreements: string[];
  tasks: TaskDraft[];
  nextSteps: string;
  suggestedDate: string;
  internalNote: string;
};

const EMPTY_DRAFT: FollowUpDraft = {
  agreements: [],
  tasks: [],
  nextSteps: "",
  suggestedDate: "",
  internalNote: "",
};

const DEFAULT_SAVE_ERROR = "No pudimos guardar el seguimiento. Inténtalo de nuevo.";

/** Contenido que se envía: textos recortados y claves opcionales solo si hay valor. */
function toContent(draft: FollowUpDraft): FollowUpContent {
  const internalNote = draft.internalNote.trim();
  return {
    agreements: draft.agreements.map((description) => ({ description: description.trim() })),
    tasks: draft.tasks.map((task) => ({ ...task, description: task.description.trim() })),
    nextSteps: draft.nextSteps.trim(),
    ...(draft.suggestedDate === "" ? {} : { suggestedNextAppointmentDate: draft.suggestedDate }),
    ...(internalNote === "" ? {} : { internalNote }),
  };
}

/** Falta un texto obligatorio: se avisa antes de mostrar el resumen. */
function hasEmptyText(content: FollowUpContent): boolean {
  return (
    content.nextSteps === "" ||
    content.agreements.some((agreement) => agreement.description === "") ||
    content.tasks.some((task) => task.description === "")
  );
}

/** Mensaje de un fallo del guardado, según el código del contrato común (TI2-88). */
function saveErrorMessage(error: unknown): string {
  const publicError = publicErrorOf(error);
  if (publicError === null) return DEFAULT_SAVE_ERROR;
  if (publicError.code === UNAUTHORIZED_ERROR_CODE) return ACCESS_DENIED_MESSAGE;
  if (publicError.code === "follow_up_fields_invalid" || publicError.code === CONFLICT_ERROR_CODE) {
    return publicError.message;
  }
  return DEFAULT_SAVE_ERROR;
}

export function AppointmentFollowUpSection({
  appointmentId,
  appointmentStatus,
}: {
  appointmentId: string;
  appointmentStatus: AppointmentStatus;
}) {
  return (
    <section aria-labelledby="follow-up-title" className="student-portal__section">
      <div className="student-portal__section-head">
        <h2 id="follow-up-title">Seguimiento de la atención</h2>
      </div>
      <FollowUpBody appointmentId={appointmentId} appointmentStatus={appointmentStatus} />
    </section>
  );
}

function FollowUpBody({
  appointmentId,
  appointmentStatus,
}: {
  appointmentId: string;
  appointmentStatus: AppointmentStatus;
}) {
  let record: ReturnType<typeof useFollowUpRecord>;
  try {
    // Hook primero y en todos los renders: el try solo clasifica el error.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    record = useFollowUpRecord(appointmentId);
  } catch (error) {
    if (isAuthorizationDenial(error)) {
      return <DeniedState title="No tienes acceso al seguimiento de esta atención." />;
    }
    throw error;
  }

  if (record === undefined) {
    return <LoadingState label="Cargando el seguimiento…" />;
  }
  if (record !== null) {
    return <FollowUpRecordContent record={record} />;
  }
  if (!admitsFollowUp(appointmentStatus)) {
    return (
      <p>
        El seguimiento se registra cuando la atención está realizada o tiene la inasistencia
        registrada.
      </p>
    );
  }
  return <FollowUpForm appointmentId={appointmentId} />;
}

function FollowUpForm({ appointmentId }: { appointmentId: string }) {
  const save = useSaveFollowUpRecord();
  const [draft, setDraft] = useState<FollowUpDraft>(EMPTY_DRAFT);
  const [reviewing, setReviewing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reviewRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (reviewing) reviewRef.current?.focus();
  }, [reviewing]);

  const content = toContent(draft);

  function update(change: Partial<FollowUpDraft>) {
    setDraft((current) => ({ ...current, ...change }));
    setError(null);
  }

  function handleReview(event: React.FormEvent) {
    event.preventDefault();
    if (hasEmptyText(content)) {
      setError(
        "Completa los próximos pasos y cada acuerdo y tarea agregados, o quita los que estén vacíos.",
      );
      return;
    }
    setError(null);
    setReviewing(true);
  }

  async function handleConfirm() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await save({ appointmentId, ...content, version: FOLLOW_UP_CONTRACT_VERSION });
      // La lectura reactiva trae el registro confirmado y reemplaza el formulario.
    } catch (caught) {
      setError(saveErrorMessage(caught));
      setPending(false);
    }
  }

  if (reviewing) {
    return (
      <div className="mt-4 flex flex-col gap-4 text-left">
        <h3 ref={reviewRef} tabIndex={-1}>
          Confirmar el seguimiento
        </h3>
        <FollowUpRecordContent record={content} pending />
        {error !== null ? (
          <p role="alert" className="student-portal__error">
            {error}
          </p>
        ) : null}
        <div className="student-portal__cta">
          <button
            type="button"
            className="student-portal__btn student-portal__btn--primary"
            disabled={pending}
            aria-busy={pending}
            onClick={() => void handleConfirm()}
          >
            {pending ? "Guardando…" : "Confirmar y guardar"}
          </button>
          <button
            type="button"
            className="student-portal__btn student-portal__btn--ghost"
            disabled={pending}
            onClick={() => {
              setError(null);
              setReviewing(false);
            }}
          >
            Volver a editar
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleReview} noValidate className="mt-4 flex flex-col gap-6 text-left">
      <fieldset className={SHARED_GROUP}>
        <legend className={LEGEND}>Se comparte con el estudiante</legend>
        <AgreementsEditor
          agreements={draft.agreements}
          onChange={(agreements) => update({ agreements })}
        />
        <TasksEditor tasks={draft.tasks} onChange={(tasks) => update({ tasks })} />
        <div>
          <label htmlFor="follow-up-next-steps" className={LABEL}>
            Próximos pasos (obligatorio)
          </label>
          <textarea
            id="follow-up-next-steps"
            className={TEXTAREA}
            maxLength={FOLLOW_UP_TEXT_MAX_LENGTH}
            value={draft.nextSteps}
            onChange={(event) => update({ nextSteps: event.target.value })}
            required
          />
        </div>
        <div>
          <label htmlFor="follow-up-suggested-date" className={LABEL}>
            Fecha sugerida para la próxima atención (opcional)
          </label>
          <input
            id="follow-up-suggested-date"
            type="date"
            className={FIELD}
            value={draft.suggestedDate}
            onChange={(event) => update({ suggestedDate: event.target.value })}
          />
        </div>
      </fieldset>
      <fieldset className={INTERNAL_GROUP}>
        <legend className={LEGEND}>Nota interna: no se comparte</legend>
        <p id="follow-up-internal-hint" className="m-0 text-sm text-on-surface-variant">
          Solo la ven los profesionales asignados a este acompañamiento. El estudiante no la ve.
        </p>
        <div>
          <label htmlFor="follow-up-internal-note" className={LABEL}>
            Nota interna (opcional)
          </label>
          <textarea
            id="follow-up-internal-note"
            className={TEXTAREA}
            maxLength={FOLLOW_UP_TEXT_MAX_LENGTH}
            value={draft.internalNote}
            aria-describedby="follow-up-internal-hint"
            onChange={(event) => update({ internalNote: event.target.value })}
          />
        </div>
      </fieldset>
      <p className="m-0 text-sm text-on-surface-variant">
        Cada texto admite hasta {FOLLOW_UP_TEXT_MAX_LENGTH} caracteres. El seguimiento no admite
        diagnósticos ni documentos clínicos.
      </p>
      {error !== null ? (
        <p role="alert" className="student-portal__error">
          {error}
        </p>
      ) : null}
      <div className="student-portal__cta">
        <button type="submit" className="student-portal__btn student-portal__btn--primary">
          Revisar antes de guardar
        </button>
      </div>
    </form>
  );
}

function AgreementsEditor({
  agreements,
  onChange,
}: {
  agreements: string[];
  onChange: (agreements: string[]) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm font-semibold text-on-surface">Acuerdos</p>
      {agreements.length === 0 ? <p className="m-0">Sin acuerdos agregados.</p> : null}
      {agreements.map((agreement, index) => (
        // Los acuerdos no tienen identificador: los distingue su posición.
        <div key={index} className={ENTRY}>
          <label htmlFor={`follow-up-agreement-${index}`} className={LABEL}>
            Acuerdo {index + 1}
          </label>
          <textarea
            id={`follow-up-agreement-${index}`}
            className={TEXTAREA}
            maxLength={FOLLOW_UP_TEXT_MAX_LENGTH}
            value={agreement}
            onChange={(event) =>
              onChange(agreements.map((item, i) => (i === index ? event.target.value : item)))
            }
          />
          <button
            type="button"
            className="student-portal__btn student-portal__btn--ghost w-fit"
            onClick={() => onChange(agreements.filter((_, i) => i !== index))}
          >
            Quitar el acuerdo {index + 1}
          </button>
        </div>
      ))}
      {agreements.length < FOLLOW_UP_ENTRIES_MAX ? (
        <button
          type="button"
          className="student-portal__btn student-portal__btn--ghost w-fit"
          onClick={() => onChange([...agreements, ""])}
        >
          Agregar un acuerdo
        </button>
      ) : (
        <p className="m-0">Se admiten hasta {FOLLOW_UP_ENTRIES_MAX} acuerdos.</p>
      )}
    </div>
  );
}

function TasksEditor({
  tasks,
  onChange,
}: {
  tasks: TaskDraft[];
  onChange: (tasks: TaskDraft[]) => void;
}) {
  function change(index: number, patch: Partial<TaskDraft>) {
    onChange(tasks.map((task, i) => (i === index ? { ...task, ...patch } : task)));
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm font-semibold text-on-surface">Tareas</p>
      {tasks.length === 0 ? <p className="m-0">Sin tareas agregadas.</p> : null}
      {tasks.map((task, index) => (
        <div key={index} className={ENTRY}>
          <div>
            <label htmlFor={`follow-up-task-${index}`} className={LABEL}>
              Tarea {index + 1}
            </label>
            <textarea
              id={`follow-up-task-${index}`}
              className={TEXTAREA}
              maxLength={FOLLOW_UP_TEXT_MAX_LENGTH}
              value={task.description}
              onChange={(event) => change(index, { description: event.target.value })}
            />
          </div>
          <div>
            <label htmlFor={`follow-up-task-${index}-responsible`} className={LABEL}>
              Responsable de la tarea {index + 1}
            </label>
            <select
              id={`follow-up-task-${index}-responsible`}
              className={FIELD}
              value={task.responsible}
              onChange={(event) =>
                change(index, { responsible: event.target.value as FollowUpResponsible })
              }
            >
              {FOLLOW_UP_RESPONSIBLE_VALUES.map((value) => (
                <option key={value} value={value}>
                  {followUpResponsibleLabel(value)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`follow-up-task-${index}-status`} className={LABEL}>
              Estado de la tarea {index + 1}
            </label>
            <select
              id={`follow-up-task-${index}-status`}
              className={FIELD}
              value={task.status}
              onChange={(event) =>
                change(index, { status: event.target.value as FollowUpTaskStatus })
              }
            >
              {FOLLOW_UP_TASK_STATUS_VALUES.map((value) => (
                <option key={value} value={value}>
                  {followUpTaskStatusLabel(value)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="student-portal__btn student-portal__btn--ghost w-fit"
            onClick={() => onChange(tasks.filter((_, i) => i !== index))}
          >
            Quitar la tarea {index + 1}
          </button>
        </div>
      ))}
      {tasks.length < FOLLOW_UP_ENTRIES_MAX ? (
        <button
          type="button"
          className="student-portal__btn student-portal__btn--ghost w-fit"
          onClick={() =>
            onChange([...tasks, { description: "", responsible: "student", status: "pending" }])
          }
        >
          Agregar una tarea
        </button>
      ) : (
        <p className="m-0">Se admiten hasta {FOLLOW_UP_ENTRIES_MAX} tareas.</p>
      )}
    </div>
  );
}
