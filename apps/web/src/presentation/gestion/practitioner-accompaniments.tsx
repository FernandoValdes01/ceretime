import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ConvexError } from "convex/values";
// Fuente canónica del contrato de errores (TI2-23, TI2-88): el Backend
// responde toda denegación con este mensaje genérico, sin motivo ni
// existencia del recurso. Se importa del barrel, no se duplica el literal.
import { UNAUTHORIZED_ERROR_MESSAGE } from "../../../../../convex/domain/index.ts";
import { accompanimentStatusLabel } from "../routes/student-panel-labels.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
// Reutiliza el lenguaje visual del panel (listas, fichas, errores): una sola
// fuente para no duplicar el sistema de diseño entre portales.
import "../routes/student-portal.css";
import {
  toMinimizedAccompaniment,
  useAssignedAccompanimentDetail,
  useAssignedAccompaniments,
  type AssignedAccompanimentsPage,
  type MinimizedAccompaniment,
} from "./practitioner-accompaniments-data.ts";

/**
 * Acompañamientos asignados al Practicante en solo lectura (TI2-116).
 *
 * Lee solo las queries públicas ya existentes; la autorización vive en
 * Convex, que entrega la vista minimizada (`_id`, `status`, `objective`,
 * `view`) de los acompañamientos con asignación vigente y deniega sin
 * filtrar existencia en cualquier otro caso, también cuando la asignación
 * se revoca con la URL abierta. Sin acciones profesionales (tomar, notas,
 * cambios de estado) ni llamada a `getInternalNotes`: el Practicante no
 * hereda permisos del Profesional.
 */

/** Mismas clases de fila que la gestión del Profesional (DESIGN.md: 44px y foco de 3px). */
const GESTION_ROW = "flex items-center gap-2 min-h-[44px] px-3 py-2 text-inherit";
const GESTION_FOCUS_VISIBLE =
  "focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-[2px]";

/**
 * El valor canónico viaja en `error.data`: el SDK del cliente decora
 * `error.message` con su contexto (query y request ID), así que comparar el
 * mensaje falla contra el Backend real.
 */
function isAuthorizationDenial(error: unknown): boolean {
  return error instanceof ConvexError && error.data === UNAUTHORIZED_ERROR_MESSAGE;
}

function DeniedNotice({ title }: { title: string }) {
  return (
    <div className="rounded-lg border-t-4 border-secondary-container bg-surface-container-low p-6 text-on-surface-variant">
      <p role="alert" className="mb-2 font-semibold text-on-surface">
        {title}
      </p>
      <p>Si crees que deberías verlo, consulta con el Profesional a cargo o con CERETI.</p>
    </div>
  );
}

export function PractitionerAccompanimentsPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="practitioner-accompaniments-title">
      <h1 id="practitioner-accompaniments-title" ref={headingRef} tabIndex={-1}>
        Acompañamientos asignados
      </h1>
      <p>
        Consulta en solo lectura el estado y el objetivo de los acompañamientos que te asignaron.
      </p>
      <StudentPanelErrorBoundary subject="tus acompañamientos asignados" level="section">
        <AssignedAccompanimentsBody />
      </StudentPanelErrorBoundary>
    </section>
  );
}

/** Estado de la última página encadenada: decide el botón "Cargar más". */
type TailState = { readonly pending: boolean; readonly hasMore: boolean };

function AssignedAccompanimentsBody() {
  // Páginas pedidas; solo crece con "Cargar más".
  const [pageCount, setPageCount] = useState(1);
  const [tail, setTail] = useState<TailState>({ pending: false, hasMore: false });

  let firstPage: AssignedAccompanimentsPage | undefined;
  try {
    // El hook se invoca primero y en todos los renders: el orden es estable
    // y el try solo clasifica el error ya lanzado, no condiciona la llamada.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    firstPage = useAssignedAccompaniments(undefined);
  } catch (error) {
    if (isAuthorizationDenial(error)) {
      return <DeniedNotice title="No tienes acceso a acompañamientos asignados." />;
    }
    throw error;
  }

  if (firstPage === undefined) {
    return (
      <p role="status" className="student-portal__loading">
        Cargando tus acompañamientos…
      </p>
    );
  }

  if (firstPage.items.length === 0 && !firstPage.hasMore) {
    return (
      <div className="student-portal__empty">
        <p className="student-portal__empty-title">No tienes acompañamientos asignados.</p>
        <p>Cuando un Profesional te asigne un acompañamiento, aparecerá aquí.</p>
      </div>
    );
  }

  return (
    <>
      <ul className="student-portal__list">
        <AssignedPageLevel page={firstPage} index={0} pageCount={pageCount} onTail={setTail} />
      </ul>
      {tail.hasMore ? (
        <div className="student-portal__cta">
          <button
            type="button"
            className="student-portal__btn student-portal__btn--primary"
            disabled={tail.pending}
            onClick={() => setPageCount((count) => count + 1)}
            aria-busy={tail.pending}
          >
            {tail.pending ? "Cargando…" : "Cargar más"}
          </button>
          {tail.pending && (
            <span role="status" aria-live="polite" className="sr-only">
              Cargando más acompañamientos…
            </span>
          )}
        </div>
      ) : null}
    </>
  );
}

/**
 * Páginas encadenadas por cursor keyset (TI2-116).
 *
 * Cada página siguiente se suscribe con el `lastId` vigente de la anterior,
 * no con uno congelado: si una asignación se concede o se revoca en una
 * página ya cargada, las siguientes se vuelven a pedir desde el nuevo borde y el
 * listado sigue contiguo, sin huecos ni filas repetidas. La página donde
 * termina la cadena reporta su estado en layout effect (antes del paint)
 * para que el botón no parpadee.
 */
function AssignedPageLevel({
  page,
  index,
  pageCount,
  onTail,
}: {
  page: AssignedAccompanimentsPage;
  index: number;
  pageCount: number;
  onTail: (tail: TailState) => void;
}) {
  const canContinue = page.hasMore && page.lastId !== null;
  const expanded = canContinue && index + 1 < pageCount;

  useLayoutEffect(() => {
    if (!expanded) {
      onTail({ pending: false, hasMore: canContinue });
    }
  }, [expanded, canContinue, onTail]);

  return (
    <>
      {page.items.map((item) => (
        <AssignedAccompanimentRow key={item._id} accompaniment={toMinimizedAccompaniment(item)} />
      ))}
      {expanded && page.lastId !== null ? (
        <AssignedPageFetcher
          after={page.lastId}
          index={index + 1}
          pageCount={pageCount}
          onTail={onTail}
        />
      ) : null}
    </>
  );
}

function AssignedPageFetcher({
  after,
  index,
  pageCount,
  onTail,
}: {
  after: string;
  index: number;
  pageCount: number;
  onTail: (tail: TailState) => void;
}) {
  const page = useAssignedAccompaniments(after);

  useLayoutEffect(() => {
    if (page === undefined) {
      onTail({ pending: true, hasMore: true });
    }
  }, [page, onTail]);

  if (page === undefined) {
    return null;
  }
  return <AssignedPageLevel page={page} index={index} pageCount={pageCount} onTail={onTail} />;
}

function AssignedAccompanimentRow({ accompaniment }: { accompaniment: MinimizedAccompaniment }) {
  return (
    <li className="student-portal__item">
      <Link
        to="/practicante/acompanamientos/$accompanimentId"
        params={{ accompanimentId: accompaniment._id }}
        className={`${GESTION_ROW} no-underline ${GESTION_FOCUS_VISIBLE}`}
      >
        <span className="student-portal__chip">
          {accompanimentStatusLabel(accompaniment.status)}
        </span>
        <span className="student-portal__item-meta">{accompaniment.objective}</span>
      </Link>
    </li>
  );
}

/**
 * Detalle minimizado de un acompañamiento asignado (TI2-116).
 *
 * Solo estado y objetivo: el Backend no entrega al Practicante `studentId`,
 * `accessNeeds` ni notas internas. La denegación (sin asignación, revocada,
 * otra cuenta o inexistente) muestra el mismo aviso permanente sin revelar
 * si el acompañamiento existe; como la query es reactiva, una revocación
 * con la página abierta reemplaza el contenido por ese aviso.
 */
export function PractitionerAccompanimentDetailPage({
  accompanimentId,
}: {
  accompanimentId: string;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="practitioner-accompaniment-detail-title">
      <h1 id="practitioner-accompaniment-detail-title" ref={headingRef} tabIndex={-1}>
        Detalle del acompañamiento
      </h1>
      <p>
        <Link
          to="/practicante/acompanamientos"
          className={`${GESTION_ROW} no-underline ${GESTION_FOCUS_VISIBLE}`}
        >
          Volver a acompañamientos
        </Link>
      </p>
      <StudentPanelErrorBoundary
        key={accompanimentId}
        subject="el detalle del acompañamiento"
        level="section"
      >
        <AssignedAccompanimentDetailBody accompanimentId={accompanimentId} />
      </StudentPanelErrorBoundary>
    </section>
  );
}

function AssignedAccompanimentDetailBody({ accompanimentId }: { accompanimentId: string }) {
  let accompaniment: MinimizedAccompaniment | undefined;
  try {
    // Mismo patrón que el listado: hook primero y en todos los renders.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const view = useAssignedAccompanimentDetail(accompanimentId);
    accompaniment = view === undefined ? undefined : toMinimizedAccompaniment(view);
  } catch (error) {
    if (isAuthorizationDenial(error)) {
      return <DeniedNotice title="No tienes acceso a este acompañamiento." />;
    }
    throw error;
  }

  if (accompaniment === undefined) {
    return (
      <p role="status" className="student-portal__loading">
        Cargando el detalle…
      </p>
    );
  }

  return (
    <>
      <p className="rounded-lg border-t-4 border-secondary-container bg-surface-container-low p-6 text-on-surface-variant">
        Vista de solo lectura: como Practicante consultas el estado y el objetivo del acompañamiento
        asignado.
      </p>
      <dl className="rounded-lg border border-border-low bg-surface-container-lowest p-8">
        <div className="py-2">
          <dt className="font-semibold text-on-surface">Estado</dt>
          <dd className="m-0 text-on-surface">{accompanimentStatusLabel(accompaniment.status)}</dd>
        </div>
        <div className="py-2">
          <dt className="font-semibold text-on-surface">Objetivo</dt>
          <dd className="m-0 text-on-surface">{accompaniment.objective}</dd>
        </div>
      </dl>
    </>
  );
}
