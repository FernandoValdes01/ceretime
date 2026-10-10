import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { formatPanelDate, requestStatusLabel } from "../routes/student-panel-labels.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
// Reutiliza el lenguaje visual del panel (listas, fichas, errores): una sola
// fuente para no duplicar el sistema de diseño entre vistas.
import "../routes/student-portal.css";
import "./student-requests.css";
import { useOwnRequestDetail, useOwnRequests } from "./student-requests-data.ts";

/**
 * Listado y detalle de solicitudes propias del Estudiante (TI2-89).
 *
 * Lee solo queries públicas ya existentes; la autorización vive en Convex.
 * `listOwnRequests` devuelve solo filas propias y `getRequest` detalla la
 * solicitud del titular. Otra cuenta, otro rol o una cuenta pendiente de
 * habilitación reciben la denegación genérica del Backend sin filtrar
 * existencia ni titularidad. Sin acciones de crear ni operar: eso es de
 * otras entregas.
 */
export function StudentRequestsPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="student-requests-page-title">
      <h1 id="student-requests-page-title" ref={headingRef} tabIndex={-1}>
        Mis solicitudes
      </h1>
      <p>Consulta el estado de tus solicitudes registradas.</p>
      <StudentPanelErrorBoundary subject="tus solicitudes" level="section">
        <OwnRequestsBody />
      </StudentPanelErrorBoundary>
    </section>
  );
}

/** Fila mínima que muestra la lista: coincide con la vista completa. */
type RequestListItem = {
  readonly _id: string;
  readonly status: string;
  readonly createdAt: number;
};

/** Página tal como la devuelve el Backend: claves `page`, `isDone` y cursor. */
type RequestListPage<Item extends RequestListItem> = {
  readonly page: ReadonlyArray<Item>;
  readonly isDone: boolean;
  readonly continueCursor: string;
};

/**
 * Acumula páginas con cursor sin duplicar y refleja actualizaciones
 * reactivas (TI2-89).
 *
 * Guarda cada página una sola vez durante el render (patrón documentado de
 * React para ajustar estado en render): evita setState en efectos sin
 * perder páginas al avanzar el cursor. La clave es el cursor pedido.
 * Además, si Convex devuelve una página distinta para el mismo cursor
 * (actualización reactiva), se reemplaza ese segmento y se reconstruye
 * la lista completa en orden de cursor.
 */
function usePagedItems<Item extends RequestListItem>(
  usePage: (cursor: string | null) => RequestListPage<Item> | undefined,
) {
  const [cursor, setCursor] = useState<string | null>(null);
  const page = usePage(cursor);
  const [pages, setPages] = useState<Map<string, { items: ReadonlyArray<Item>; hash: string }>>(
    new Map(),
  );
  const [done, setDone] = useState(false);

  if (page !== undefined) {
    const currentHash = page.page.map((item) => item._id).join(",");
    const existing = pages.get(cursor ?? "first");
    const pageChanged = !existing || existing.hash !== currentHash;

    if (pageChanged) {
      setPages((prev) => {
        const next = new Map(prev);
        next.set(cursor ?? "first", { items: page.page, hash: currentHash });
        return next;
      });
      setDone(page.isDone);
    }
  }

  // Reconstruye la lista concatenando páginas en orden de cursor:
  // "first" (null) primero, luego el resto en orden de inserción.
  const items = Array.from(pages.entries())
    .sort(([a], [b]) => (a === "first" ? -1 : b === "first" ? 1 : 0))
    .flatMap(([, v]) => v.items);

  return {
    items,
    done,
    pending: page === undefined,
    loadMore: () => setCursor(page?.continueCursor ?? null),
  };
}

function OwnRequestsBody() {
  const { items, done, pending, loadMore } = usePagedItems(useOwnRequests);

  if (pending && items.length === 0) {
    return (
      <p role="status" className="student-portal__loading">
        Cargando tus solicitudes…
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="student-portal__empty">
        <p className="student-portal__empty-title">Aún no tienes solicitudes registradas.</p>
        <p>Cuando envíes tu primera solicitud, aparecerá aquí con su estado.</p>
      </div>
    );
  }

  return (
    <>
      <ul className="student-portal__list">
        {items.map((request) => (
          <li key={request._id} className="student-portal__item">
            <Link
              to="/estudiante/solicitudes/$requestId"
              params={{ requestId: request._id }}
              className="estudiante-request-link"
            >
              <span className="student-portal__chip">{requestStatusLabel(request.status)}</span>
              <span className="student-portal__item-meta">
                Registrada el {formatPanelDate(request.createdAt)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {done ? null : (
        <div className="student-portal__cta">
          <button
            type="button"
            className="student-portal__btn student-portal__btn--primary"
            disabled={pending}
            onClick={loadMore}
            aria-busy={pending}
          >
            {pending ? "Cargando…" : "Cargar más"}
          </button>
          {pending && (
            <span role="status" aria-live="polite" className="student-portal__sr-only">
              Cargando más solicitudes…
            </span>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Detalle de una solicitud propia (TI2-89).
 *
 * La fila completa —incluidas las necesidades de acceso— solo llega por
 * `getRequest`, que el Backend deniega sin filtrar existencia cuando la
 * solicitud es ajena o inexistente. Ante denegación se muestra el aviso
 * genérico del límite.
 */
export function StudentRequestDetailPage({ requestId }: { requestId: string }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="student-request-detail-title">
      <h1 id="student-request-detail-title" ref={headingRef} tabIndex={-1}>
        Detalle de la solicitud
      </h1>
      <p>
        <Link to="/estudiante/solicitudes" className="estudiante-request-link">
          Volver a solicitudes
        </Link>
      </p>
      <StudentPanelErrorBoundary subject="el detalle de la solicitud" level="section">
        <OwnRequestDetailBody requestId={requestId} />
      </StudentPanelErrorBoundary>
    </section>
  );
}

function OwnRequestDetailBody({ requestId }: { requestId: string }) {
  const request = useOwnRequestDetail(requestId);

  if (request === undefined) {
    return (
      <p role="status" className="student-portal__loading">
        Cargando el detalle…
      </p>
    );
  }

  return (
    <dl>
      <div>
        <dt>Estado</dt>
        <dd>{requestStatusLabel(request.status)}</dd>
      </div>
      <div>
        <dt>Registrada</dt>
        <dd>{formatPanelDate(request.createdAt)}</dd>
      </div>
      <div>
        <dt>Necesidades de acceso</dt>
        <dd>{request.accessNeeds}</dd>
      </div>
    </dl>
  );
}
