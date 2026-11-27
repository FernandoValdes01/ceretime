import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ACCOMPANIMENT_CLOSURE_REASON_MAX_LENGTH,
  CONFLICT_ERROR_CODE,
  UNAUTHORIZED_ERROR_CODE,
  type AccompanimentStatus,
} from "../../../../../convex/domain/index.ts";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { publicErrorOf } from "../../infrastructure/convex/public-error.ts";
import { accompanimentStatusLabel } from "../routes/student-panel-labels.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import "../routes/student-portal.css";
import { ACCESS_DENIED_MESSAGE, DeniedState, LoadingState } from "../shared/view-states.tsx";
import {
  ACCOMPANIMENT_BACK_LINK,
  ACCOMPANIMENT_TITLE,
  AssignedAccompanimentsList,
  GESTION_FOCUS_VISIBLE,
} from "./assigned-accompaniments-list.tsx";
import { isAuthorizationDenial } from "./authorization-denial.ts";
import { AccompanimentProfessionalsSection } from "./accompaniment-professionals.tsx";
import { AccompanimentInternsSection } from "./accompaniment-interns.tsx";
import { DetailRow } from "./detail-row.tsx";
import { FollowUpHistory } from "./follow-up-record.tsx";
import { useAssignedAccompanimentDetail } from "./practitioner-accompaniments-data.ts";
import {
  accompanimentActions,
  useClosurePreview,
  useCloseAccompaniment,
  usePauseAccompaniment,
  useReactivateAccompaniment,
} from "./professional-accompaniments-data.ts";

/**
 * Acompañamientos del Profesional (TI2-165, TI2-170).
 *
 * El listado reutiliza el del Practicante sobre `listAssignedAccompaniments`:
 * cada fila muestra solo el objetivo y el estado y abre su propio detalle,
 * así varios acompañamientos se recorren sin mezclarse. El detalle agrega
 * pausar, reactivar y cerrar con las operaciones de TI2-152, el cambio de
 * profesionales, la gestión de practicantes (TI2-170) y el historial de
 * seguimiento en solo lectura; la autorización y la política de estados las
 * decide el Backend, y un acompañamiento cerrado no ofrece asignaciones
 * nuevas, solo retiros.
 */

const PROFESSIONAL_DENIED_HINT = "Si crees que deberías verlo, consulta con CERETI.";

/** Campos de gestión según DESIGN.md, igual que en la agenda del Profesional. */
const GESTION_LABEL = "mb-2 block text-sm font-semibold text-on-surface";
const GESTION_TEXTAREA = `min-h-32 w-full min-w-0 box-border resize-y rounded-[0.5rem] border border-outline bg-surface-container-lowest px-3 py-2 text-base text-on-surface ${GESTION_FOCUS_VISIBLE}`;

const DEFAULT_ACTION_ERROR = "No pudimos completar la acción. Inténtalo de nuevo.";

/**
 * Mensaje de un fallo de las operaciones de estado. Se distingue por el
 * código del contrato común (TI2-88), nunca por el texto del SDK.
 */
function actionErrorMessage(error: unknown): string {
  const publicError = publicErrorOf(error);
  if (publicError?.code === UNAUTHORIZED_ERROR_CODE) return ACCESS_DENIED_MESSAGE;
  if (publicError?.code === CONFLICT_ERROR_CODE) {
    return "El acompañamiento cambió mientras lo revisabas. Revisa su estado y vuelve a intentarlo.";
  }
  return DEFAULT_ACTION_ERROR;
}

export function ProfessionalAccompanimentsPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="professional-accompaniments-title">
      <h1
        id="professional-accompaniments-title"
        ref={headingRef}
        tabIndex={-1}
        className={ACCOMPANIMENT_TITLE}
      >
        Acompañamientos
      </h1>
      <p>Los acompañamientos que tienes asignados, con su objetivo y su estado.</p>
      <StudentPanelErrorBoundary subject="tus acompañamientos" level="section">
        <AssignedAccompanimentsList
          area="professional"
          texts={{
            loading: "Cargando tus acompañamientos…",
            deniedTitle: "No tienes acceso a acompañamientos.",
            deniedHint: PROFESSIONAL_DENIED_HINT,
            emptyTitle: "No tienes acompañamientos asignados.",
            emptyHint:
              "Cuando aceptes una solicitud o te asignen un acompañamiento, aparecerá aquí.",
          }}
        />
      </StudentPanelErrorBoundary>
    </section>
  );
}

export function ProfessionalAccompanimentDetailPage({
  accompanimentId,
}: {
  accompanimentId: string;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="professional-accompaniment-detail-title">
      <h1
        id="professional-accompaniment-detail-title"
        ref={headingRef}
        tabIndex={-1}
        className={ACCOMPANIMENT_TITLE}
      >
        Detalle del acompañamiento
      </h1>
      <p>
        <Link to="/profesional/acompanamientos" className={ACCOMPANIMENT_BACK_LINK}>
          <span aria-hidden="true">←</span> Volver a acompañamientos
        </Link>
      </p>
      <StudentPanelErrorBoundary
        key={accompanimentId}
        subject="el detalle del acompañamiento"
        level="section"
      >
        <AccompanimentDetailBody accompanimentId={accompanimentId} />
      </StudentPanelErrorBoundary>
    </section>
  );
}

function AccompanimentDetailBody({ accompanimentId }: { accompanimentId: string }) {
  let view: ReturnType<typeof useAssignedAccompanimentDetail>;
  try {
    // Hook primero y en todos los renders: el try solo clasifica el error.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    view = useAssignedAccompanimentDetail(accompanimentId);
  } catch (error) {
    if (isAuthorizationDenial(error)) {
      return (
        <DeniedState
          title="No tienes acceso a este acompañamiento."
          description={PROFESSIONAL_DENIED_HINT}
        />
      );
    }
    throw error;
  }

  if (view === undefined) {
    return <LoadingState label="Cargando el detalle…" />;
  }

  // `#root` centra el texto de toda la Web: el detalle se alinea a la
  // izquierda para que los textos largos se lean como párrafos.
  return (
    <div className="text-left">
      <dl className="m-0 divide-y divide-(--ct-line)">
        <DetailRow label="Estado">{accompanimentStatusLabel(view.status)}</DetailRow>
        <DetailRow label="Objetivo">{view.objective}</DetailRow>
        {view.view === "full" ? (
          <DetailRow label="Necesidades de acceso">{view.accessNeeds}</DetailRow>
        ) : null}
      </dl>
      <AccompanimentStatusSection accompanimentId={view._id} status={view.status} />
      {view.view === "full" ? (
        <StudentPanelErrorBoundary subject="los profesionales del acompañamiento" level="section">
          <AccompanimentProfessionalsSection accompanimentId={view._id} status={view.status} />
        </StudentPanelErrorBoundary>
      ) : null}
      {view.view === "full" ? (
        <StudentPanelErrorBoundary subject="los practicantes del acompañamiento" level="section">
          <AccompanimentInternsSection accompanimentId={view._id} status={view.status} />
        </StudentPanelErrorBoundary>
      ) : null}
      <StudentPanelErrorBoundary subject="el historial de seguimiento" level="section">
        <FollowUpHistory accompanimentId={view._id} />
      </StudentPanelErrorBoundary>
    </div>
  );
}

/**
 * Pausar, reactivar y cerrar (TI2-152, TI2-165).
 *
 * Las acciones salen de la tabla canónica del dominio. Pausar y reactivar se
 * envían con un solo botón porque se pueden deshacer; cerrar es definitivo,
 * así que abre una confirmación con las atenciones que cancelaría y un motivo
 * opcional. El estado mostrado se actualiza solo, porque el detalle es una
 * query reactiva.
 */
function AccompanimentStatusSection({
  accompanimentId,
  status,
}: {
  accompanimentId: Id<"accompaniments">;
  status: AccompanimentStatus;
}) {
  const pause = usePauseAccompaniment();
  const reactivate = useReactivateAccompaniment();
  const [pending, setPending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const actions = accompanimentActions(status);

  // El botón usado desaparece al cambiar el estado: el foco pasa al aviso para
  // que el teclado y el lector de pantalla no queden en el inicio de la página.
  useEffect(() => {
    if (notice !== null) noticeRef.current?.focus();
  }, [notice]);

  async function run(action: () => Promise<unknown>, done: string) {
    if (pending) return;
    setPending(true);
    setNotice(null);
    setError(null);
    try {
      await action();
      setNotice(done);
    } catch (caught) {
      setError(actionErrorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="accompaniment-status-title" className="student-portal__section">
      <div className="student-portal__section-head">
        <h2 id="accompaniment-status-title">Estado del acompañamiento</h2>
      </div>
      {notice !== null ? (
        <p ref={noticeRef} tabIndex={-1} role="status">
          {notice}
        </p>
      ) : null}
      {error !== null ? (
        <p role="alert" className="student-portal__error">
          {error}
        </p>
      ) : null}
      {status === "closed" ? (
        <p>
          Este acompañamiento está cerrado: es de solo lectura y no se reabre. Una necesidad
          posterior comienza con una solicitud nueva.
        </p>
      ) : null}
      {status === "paused" ? (
        <p>
          Mientras dure la pausa, sus atenciones se mantienen, pero no se pueden reservar, cancelar,
          cambiar ni registrar.
        </p>
      ) : null}
      {actions.length > 0 && !closing ? (
        <div className="student-portal__cta">
          {actions.includes("pause") ? (
            <button
              type="button"
              className="student-portal__btn student-portal__btn--ghost"
              disabled={pending}
              aria-busy={pending}
              onClick={() => void run(() => pause({ accompanimentId }), "Acompañamiento pausado.")}
            >
              Pausar el acompañamiento
            </button>
          ) : null}
          {actions.includes("reactivate") ? (
            <button
              type="button"
              className="student-portal__btn student-portal__btn--primary"
              disabled={pending}
              aria-busy={pending}
              onClick={() =>
                void run(() => reactivate({ accompanimentId }), "Acompañamiento reactivado.")
              }
            >
              Reactivar el acompañamiento
            </button>
          ) : null}
          {actions.includes("close") ? (
            <button
              type="button"
              className="student-portal__btn student-portal__btn--ghost"
              disabled={pending}
              onClick={() => {
                setNotice(null);
                setError(null);
                setClosing(true);
              }}
            >
              Cerrar el acompañamiento
            </button>
          ) : null}
        </div>
      ) : null}
      {closing && status !== "closed" ? (
        <ClosureConfirmation
          accompanimentId={accompanimentId}
          status={status}
          onCancel={() => setClosing(false)}
          onClosed={(cancelled) => {
            setClosing(false);
            setError(null);
            setNotice(
              cancelled === 0
                ? "Acompañamiento cerrado. No había atenciones futuras que cancelar."
                : cancelled === 1
                  ? "Acompañamiento cerrado. Se canceló 1 atención futura."
                  : `Acompañamiento cerrado. Se cancelaron ${cancelled} atenciones futuras.`,
            );
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * Confirmación del cierre: muestra cuántas atenciones futuras se cancelarían
 * y, si queda alguna con la hora pasada sin registrar, explica por qué no se
 * puede cerrar todavía. El motivo es opcional y se guarda en el propio
 * acompañamiento.
 */
function ClosureConfirmation({
  accompanimentId,
  status,
  onCancel,
  onClosed,
}: {
  accompanimentId: Id<"accompaniments">;
  status: AccompanimentStatus;
  onCancel: () => void;
  onClosed: (cancelledAppointments: number) => void;
}) {
  const close = useCloseAccompaniment();
  const preview = useClosurePreview(accompanimentId);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const trimmed = reason.trim();
      const result = await close({
        accompanimentId,
        ...(trimmed === "" ? {} : { reason: trimmed }),
      });
      onClosed(result.cancelledAppointments);
    } catch (caught) {
      setError(actionErrorMessage(caught));
      setPending(false);
    }
  }

  const blocked = preview.status === "ok" && preview.unrecordedAppointments > 0;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-labelledby="accompaniment-closure-title"
      className="mt-4 flex flex-col gap-4"
    >
      <h3 id="accompaniment-closure-title" ref={headingRef} tabIndex={-1}>
        Cerrar el acompañamiento
      </h3>
      {preview.status === "loading" ? (
        <LoadingState label="Revisando las atenciones del acompañamiento…" />
      ) : null}
      {preview.status === "error" ? (
        <p role="alert" className="student-portal__error">
          {preview.message}
        </p>
      ) : null}
      {preview.status === "ok" && blocked ? (
        <p role="alert" className="student-portal__error">
          {preview.unrecordedAppointments === 1
            ? "Queda 1 atención cuya hora ya pasó sin registrar si se realizó."
            : `Quedan ${preview.unrecordedAppointments} atenciones cuya hora ya pasó sin registrar si se realizaron.`}{" "}
          {status === "paused"
            ? "Reactiva el acompañamiento, registra su resultado en la agenda y después ciérralo."
            : "Registra su resultado en la agenda y después cierra el acompañamiento."}
        </p>
      ) : null}
      {preview.status === "ok" && !blocked ? (
        <p>
          {preview.appointmentsToCancel === 0
            ? "No hay atenciones futuras que cancelar."
            : preview.appointmentsToCancel === 1
              ? "Se cancelará 1 atención futura y se liberará su cupo."
              : `Se cancelarán ${preview.appointmentsToCancel} atenciones futuras y se liberarán sus cupos.`}{" "}
          El cierre es definitivo: el acompañamiento no se reabre.
        </p>
      ) : null}
      <div>
        <label htmlFor="accompaniment-closure-reason" className={GESTION_LABEL}>
          Motivo del cierre (opcional)
        </label>
        <textarea
          id="accompaniment-closure-reason"
          className={GESTION_TEXTAREA}
          rows={4}
          maxLength={ACCOMPANIMENT_CLOSURE_REASON_MAX_LENGTH}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          aria-describedby="accompaniment-closure-reason-hint"
          disabled={pending}
        />
        <p id="accompaniment-closure-reason-hint" className="student-portal__hint">
          Hasta {ACCOMPANIMENT_CLOSURE_REASON_MAX_LENGTH} caracteres.
        </p>
      </div>
      {error !== null ? (
        <p role="alert" className="student-portal__error">
          {error}
        </p>
      ) : null}
      <div className="student-portal__cta">
        <button
          type="submit"
          className="student-portal__btn student-portal__btn--primary"
          disabled={pending || preview.status !== "ok" || blocked}
          aria-busy={pending}
        >
          {pending ? "Cerrando…" : "Confirmar el cierre"}
        </button>
        <button
          type="button"
          className="student-portal__btn student-portal__btn--ghost"
          disabled={pending}
          onClick={onCancel}
        >
          No cerrar
        </button>
      </div>
    </form>
  );
}
