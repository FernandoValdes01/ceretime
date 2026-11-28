import { useId, useRef, useState, useEffect } from "react";
import { formatCivilDateWithYear } from "../shared/date-format.ts";
import { formatAppointmentInstant } from "./agenda-labels.ts";
import type { JustificationSituation } from "./student-appointment-changes.ts";
import { getAgendaPort } from "./schedule-search-data.ts";
import { PRIMARY_BUTTON_CLASS, SECTION_TITLE_CLASS, fieldClass } from "./student-page-classes.ts";

/**
 * Justificación de una inasistencia propia (TI2-119, TI2-147, TI2-163).
 *
 * Muestra el plazo de cinco días hábiles, la entrega con su fecha de recepción
 * y el estado de la revisión, incluida la explicación del rechazo (TI2-155).
 * El respaldo no se sube: la persona declara que lo entregó por un canal
 * oficial. El plazo y la revisión los decide el Backend; si rechaza una entrega
 * fuera de plazo, la explicación escrita se conserva.
 */

const EXPLANATION_MAX_LENGTH = 1000;

const EXPLANATION_REQUIRED_MESSAGE = "Escribe por qué no pudiste asistir.";
const SUBMIT_FALLBACK = "No pudimos enviar la justificación. Inténtalo de nuevo.";

const REVIEW_LABELS: Record<string, string> = {
  pending: "En revisión por tu profesional",
  accepted: "Aceptada",
  rejected: "Rechazada",
};

type SubmitFailure = { readonly status: "denied" } | { readonly status: "error"; message: string };

export function AppointmentJustification({
  appointmentId,
  situation,
  onSubmitted,
}: {
  appointmentId: string;
  situation: Exclude<JustificationSituation, { kind: "none" }>;
  onSubmitted: () => void;
}) {
  return (
    <section aria-labelledby="justification-title" className="mt-6 flex flex-col gap-3 text-left">
      <h2 id="justification-title" className={SECTION_TITLE_CLASS}>
        Justificación de la inasistencia
      </h2>
      <JustificationBody
        appointmentId={appointmentId}
        situation={situation}
        onSubmitted={onSubmitted}
      />
    </section>
  );
}

function JustificationBody({
  appointmentId,
  situation,
  onSubmitted,
}: {
  appointmentId: string;
  situation: Exclude<JustificationSituation, { kind: "none" }>;
  onSubmitted: () => void;
}) {
  if (situation.kind === "closed") {
    return <p className="m-0">No se entregó una justificación dentro del plazo.</p>;
  }

  const deadline = (
    <p className="m-0">
      Plazo para justificar: hasta el {formatCivilDateWithYear(situation.deadlineDate)}, inclusive
      (cinco días hábiles).
    </p>
  );

  if (situation.kind === "expired") {
    return (
      <>
        {deadline}
        <p className="m-0">
          El plazo venció sin una entrega. La inasistencia quedará como no justificada.
        </p>
      </>
    );
  }

  if (situation.kind === "open") {
    return (
      <>
        {deadline}
        <JustificationForm appointmentId={appointmentId} onSubmitted={onSubmitted} />
      </>
    );
  }

  return (
    <dl className="m-0 grid gap-3">
      <JustificationRow label="Recepción">
        Recibida el {formatAppointmentInstant(situation.submittedAt)}
      </JustificationRow>
      <JustificationRow label="Respaldo">
        {situation.supportingDocumentReceived
          ? "Informaste que lo entregaste por un canal oficial de CERETI."
          : "No informaste un respaldo."}
      </JustificationRow>
      <JustificationRow label="Estado de la revisión">
        {REVIEW_LABELS[situation.review] ?? situation.review}
      </JustificationRow>
      {situation.review === "rejected" && situation.reviewExplanation !== undefined ? (
        <JustificationRow label="Explicación del rechazo">
          {situation.reviewExplanation}
        </JustificationRow>
      ) : null}
    </dl>
  );
}

function JustificationRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-semibold text-on-surface">{label}</dt>
      <dd className="m-0 text-base text-on-surface">{children}</dd>
    </div>
  );
}

/**
 * Entrega de la justificación. Al enviarse, el detalle vuelve a leer la
 * atención: la recepción reemplaza este formulario y el detalle anuncia el
 * envío.
 */
function JustificationForm({
  appointmentId,
  onSubmitted,
}: {
  appointmentId: string;
  onSubmitted: () => void;
}) {
  const [explanation, setExplanation] = useState("");
  const [supportingDocumentReceived, setSupportingDocumentReceived] = useState(false);
  const [showExplanationError, setShowExplanationError] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<SubmitFailure | null>(null);
  const deniedRef = useRef<HTMLParagraphElement>(null);
  const ids = useId();
  const explanationId = `${ids}-explanation`;
  const hintId = `${ids}-hint`;
  const errorId = `${ids}-error`;

  useEffect(() => {
    if (failure?.status === "denied") {
      deniedRef.current?.focus();
    }
  }, [failure]);

  if (failure?.status === "denied") {
    return (
      <p ref={deniedRef} tabIndex={-1} className="student-portal__error m-0">
        No tienes acceso a esta atención.
      </p>
    );
  }

  const trimmed = explanation.trim();
  const explanationInvalid = showExplanationError && trimmed === "";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) {
      return;
    }
    if (trimmed === "") {
      setShowExplanationError(true);
      return;
    }
    setFailure(null);
    setPending(true);
    try {
      const result = await getAgendaPort().submitAppointmentJustification({
        appointmentId,
        explanation: trimmed,
        supportingDocumentReceived,
      });
      if (result.status === "submitted") {
        onSubmitted();
      } else if (result.status === "denied") {
        setFailure({ status: "denied" });
      } else {
        setFailure({ status: "error", message: result.error.message });
      }
    } catch {
      setFailure({ status: "error", message: SUBMIT_FALLBACK });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={explanationId} className="font-semibold">
          Por qué no pudiste asistir
        </label>
        <p id={hintId} className="m-0 text-sm text-on-surface-variant">
          Explica lo ocurrido sin diagnósticos ni datos de salud. Solo puedes enviarla una vez.
        </p>
        <textarea
          id={explanationId}
          value={explanation}
          rows={4}
          maxLength={EXPLANATION_MAX_LENGTH}
          required
          aria-invalid={explanationInvalid}
          aria-describedby={explanationInvalid ? `${hintId} ${errorId}` : hintId}
          disabled={pending}
          onChange={(event) => setExplanation(event.target.value)}
          className={fieldClass(explanationInvalid)}
        />
        {explanationInvalid ? (
          <p id={errorId} className="m-0 font-semibold text-error">
            {EXPLANATION_REQUIRED_MESSAGE}
          </p>
        ) : null}
      </div>
      <label className="flex min-h-[44px] items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-5"
          checked={supportingDocumentReceived}
          disabled={pending}
          onChange={(event) => setSupportingDocumentReceived(event.target.checked)}
        />
        <span>
          Ya entregué un respaldo por un canal oficial de CERETI. No adjuntes archivos aquí.
        </span>
      </label>
      {failure?.status === "error" ? (
        <p role="alert" className="student-portal__error m-0">
          {failure.message} Lo que escribiste se conserva.
        </p>
      ) : null}
      <button
        type="submit"
        className={`${PRIMARY_BUTTON_CLASS} w-fit`}
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? "Enviando…" : "Enviar justificación"}
      </button>
    </form>
  );
}
