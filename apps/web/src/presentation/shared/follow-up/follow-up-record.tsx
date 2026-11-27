import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CONFLICT_ERROR_CODE } from "../../../../../../convex/domain/index.ts";
import { publicErrorOf } from "../../../infrastructure/convex/public-error.ts";
import { isAuthorizationDenial } from "../authorization-denial.ts";
import { formatAgendaDate, formatCivilDateWithYear } from "../date-format.ts";
import { DeniedState, EmptyState, LoadingState } from "../view-states.tsx";
import {
  useFollowUpHistory,
  type FollowUpHistoryPage,
  type FollowUpRecordView,
} from "./follow-up-data.ts";
import { followUpResponsibleLabel, followUpTaskStatusLabel } from "./follow-up-labels.ts";

/**
 * Seguimiento confirmado en solo lectura (TI2-165, TI2-166).
 *
 * Una sola representación para el Profesional y el Estudiante; cambia solo lo
 * que depende de quién mira (`audience`). Para el Profesional separa lo que
 * ve el estudiante de la nota interna con un encabezado propio para cada
 * parte, un borde distinto y el texto «no se comparte»: la diferencia no
 * depende solo del color. El Estudiante recibe del Backend la vista `shared`,
 * sin nota interna, y además el componente no la muestra en su audiencia. No
 * ofrece editar, porque el primer guardado confirma el registro y el contrato
 * no admite cambios.
 */

/** Quién mira el seguimiento. */
export type FollowUpAudience = "professional" | "student";

const SHARED_BLOCK = "rounded-lg border border-border-low bg-surface-container-lowest p-4";
const INTERNAL_BLOCK =
  "rounded-lg border-2 border-dashed border-outline bg-surface-container-low p-4";
const BLOCK_TITLE = "m-0 text-base font-bold text-on-surface";

/** Contenido de un seguimiento que se muestra, confirmado o por confirmar. */
export type FollowUpContent = Pick<
  FollowUpRecordView,
  "agreements" | "tasks" | "nextSteps" | "suggestedNextAppointmentDate"
> & { readonly internalNote?: string };

/**
 * Seguimiento en solo lectura. `pending` muestra el resumen antes de
 * confirmar; sin él, es un registro ya confirmado.
 */
export function FollowUpRecordContent({
  record,
  pending = false,
  audience = "professional",
}: {
  record: FollowUpContent;
  pending?: boolean;
  audience?: FollowUpAudience;
}) {
  const student = audience === "student";
  return (
    <div className="flex flex-col gap-4 text-left wrap-anywhere">
      {student ? null : (
        <p className="m-0 text-sm text-on-surface-variant">
          {pending
            ? "Revisa el seguimiento: al confirmarlo queda guardado y ya no se puede editar."
            : "Seguimiento confirmado: no se puede editar."}
        </p>
      )}
      <section
        aria-label={student ? "Seguimiento de la atención" : "Se comparte con el estudiante"}
        className={SHARED_BLOCK}
      >
        {student ? null : <p className={BLOCK_TITLE}>Se comparte con el estudiante</p>}
        <FollowUpField label="Acuerdos">
          {record.agreements.length === 0 ? (
            <p className="m-0">Sin acuerdos.</p>
          ) : (
            <ul className="m-0 list-disc pl-5">
              {record.agreements.map((agreement, index) => (
                // Los acuerdos no tienen identificador: los distingue su posición.
                <li key={index}>{agreement.description}</li>
              ))}
            </ul>
          )}
        </FollowUpField>
        <FollowUpField label="Tareas">
          {record.tasks.length === 0 ? (
            <p className="m-0">Sin tareas.</p>
          ) : (
            <ul className="m-0 list-disc pl-5">
              {record.tasks.map((task, index) => (
                <li key={index}>
                  {task.description}
                  <span className="block text-sm text-on-surface-variant">
                    Responsable: {followUpResponsibleLabel(task.responsible)}. Estado:{" "}
                    {followUpTaskStatusLabel(task.status)}.
                  </span>
                </li>
              ))}
            </ul>
          )}
        </FollowUpField>
        <FollowUpField label="Próximos pasos">
          <p className="m-0 whitespace-pre-line">{record.nextSteps}</p>
        </FollowUpField>
        {record.suggestedNextAppointmentDate === undefined ? null : (
          <FollowUpField label="Fecha sugerida para la próxima atención">
            <p className="m-0">{formatCivilDateWithYear(record.suggestedNextAppointmentDate)}</p>
          </FollowUpField>
        )}
      </section>
      {!student && record.internalNote !== undefined ? (
        <section aria-label="Nota interna: no se comparte" className={INTERNAL_BLOCK}>
          <p className={BLOCK_TITLE}>Nota interna: no se comparte</p>
          <p className="m-0 mt-2 text-sm text-on-surface-variant">
            Solo la ven los profesionales asignados a este acompañamiento.
          </p>
          <p className="m-0 mt-2 whitespace-pre-line">{record.internalNote}</p>
        </section>
      ) : null}
    </div>
  );
}

function FollowUpField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-3">
      <p className="m-0 text-sm font-semibold text-on-surface">{label}</p>
      <div className="text-base text-on-surface">{children}</div>
    </div>
  );
}

/**
 * Lo que el historial muestra distinto según quién mira: la etiqueta del
 * estado de la atención y el enlace a su detalle viven en el área de cada rol,
 * y el texto del historial vacío dice dónde se origina el seguimiento.
 */
export interface FollowUpHistoryAudience {
  readonly audience: FollowUpAudience;
  readonly appointmentStatusLabel: (status: string) => string;
  readonly renderAppointmentLink: (appointmentId: string) => ReactNode;
  readonly emptyHint: string;
}

/**
 * Historial de seguimiento de un acompañamiento (TI2-165, TI2-166).
 *
 * Solo recorre las atenciones del acompañamiento pedido, así que no mezcla
 * acompañamientos. El Backend pagina por atenciones: una página puede traer
 * menos registros que el límite, o ninguno, y aun así tener más.
 */
export function FollowUpHistory({
  accompanimentId,
  view,
}: {
  accompanimentId: string;
  view: FollowUpHistoryAudience;
}) {
  // Cursores pedidos; el primero es `null`. Crece con "Cargar más".
  const [cursors, setCursors] = useState<ReadonlyArray<string | null>>([null]);
  const [counts, setCounts] = useState<ReadonlyArray<number>>([]);

  const report = useCallback((index: number, count: number) => {
    setCounts((current) => {
      if (current[index] === count) return current;
      const next = [...current];
      next[index] = count;
      return next;
    });
  }, []);

  const restart = useCallback(() => {
    setCursors([null]);
    setCounts([]);
  }, []);

  return (
    <section aria-labelledby="follow-up-history-title" className="student-portal__section">
      <div className="student-portal__section-head">
        <h2 id="follow-up-history-title">Historial de seguimiento</h2>
      </div>
      <p>
        Seguimientos confirmados de las atenciones de este acompañamiento, del más reciente al más
        antiguo.
      </p>
      {cursors.map((cursor, index) => (
        <FollowUpHistoryPageView
          key={cursor ?? "first"}
          accompanimentId={accompanimentId}
          view={view}
          cursor={cursor}
          index={index}
          isLast={index === cursors.length - 1}
          totalBefore={counts.slice(0, index).reduce((sum, count) => sum + count, 0)}
          onReport={report}
          onMore={(next) => setCursors((current) => [...current, next])}
          onRestart={restart}
        />
      ))}
    </section>
  );
}

function FollowUpHistoryPageView({
  accompanimentId,
  view,
  cursor,
  index,
  isLast,
  totalBefore,
  onReport,
  onMore,
  onRestart,
}: {
  accompanimentId: string;
  view: FollowUpHistoryAudience;
  cursor: string | null;
  index: number;
  isLast: boolean;
  totalBefore: number;
  onReport: (index: number, count: number) => void;
  onMore: (cursor: string) => void;
  onRestart: () => void;
}) {
  let page: FollowUpHistoryPage | undefined;
  try {
    // Hook primero y en todos los renders: el try solo clasifica el error.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    page = useFollowUpHistory(accompanimentId, cursor);
  } catch (error) {
    if (isAuthorizationDenial(error)) {
      return <DeniedState title="No tienes acceso al historial de este acompañamiento." />;
    }
    if (publicErrorOf(error)?.code === CONFLICT_ERROR_CODE && cursor !== null) {
      // El contrato pide volver a la primera página si Convex rechaza el cursor.
      return (
        <div className="student-portal__cta">
          <p role="alert" className="student-portal__error">
            No pudimos seguir el historial desde donde quedó.
          </p>
          <button
            type="button"
            className="student-portal__btn student-portal__btn--ghost"
            onClick={onRestart}
          >
            Volver al inicio del historial
          </button>
        </div>
      );
    }
    throw error;
  }

  if (page === undefined) {
    return <LoadingState label="Cargando el historial…" />;
  }

  return (
    <FollowUpHistoryPageItems
      page={page}
      view={view}
      index={index}
      isLast={isLast}
      totalBefore={totalBefore}
      onReport={onReport}
      onMore={onMore}
    />
  );
}

function FollowUpHistoryPageItems({
  page,
  view,
  index,
  isLast,
  totalBefore,
  onReport,
  onMore,
}: {
  page: FollowUpHistoryPage;
  view: FollowUpHistoryAudience;
  index: number;
  isLast: boolean;
  totalBefore: number;
  onReport: (index: number, count: number) => void;
  onMore: (cursor: string) => void;
}) {
  // Cuántos registros trajo la página: el vacío considera todas las cargadas.
  useEffect(() => {
    onReport(index, page.items.length);
  }, [onReport, index, page.items.length]);

  const empty = isLast && !page.hasMore && totalBefore + page.items.length === 0;

  return (
    <>
      {empty ? (
        <EmptyState title="Este acompañamiento todavía no tiene seguimientos.">
          <p>{view.emptyHint}</p>
        </EmptyState>
      ) : null}
      {page.items.length > 0 ? (
        <ol className="mt-4 grid list-none gap-4 p-0">
          {page.items.map((record) => (
            <li key={record.appointmentId} className="rounded-lg border border-border-low p-4">
              <article
                aria-label={`Seguimiento de la atención del ${formatAgendaDate(record.appointmentStartsAt)}`}
              >
                <p className="m-0 text-lg font-semibold">
                  Atención del {formatAgendaDate(record.appointmentStartsAt)} ·{" "}
                  {view.appointmentStatusLabel(record.appointmentStatus)}
                </p>
                {view.renderAppointmentLink(record.appointmentId)}
                <FollowUpRecordContent record={record} audience={view.audience} />
              </article>
            </li>
          ))}
        </ol>
      ) : null}
      {isLast && page.hasMore && page.nextCursor !== null ? (
        <div className="student-portal__cta">
          <button
            type="button"
            className="student-portal__btn student-portal__btn--primary"
            onClick={() => {
              if (page.nextCursor !== null) onMore(page.nextCursor);
            }}
          >
            Cargar más
          </button>
        </div>
      ) : null}
    </>
  );
}
