import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { formatPanelDate, requestStatusLabel } from "../routes/student-panel-labels.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import { useOwnRequestDetail, useOwnRequests } from "./student-requests-data.ts";

/**
 * Listado y detalle de solicitudes propias del Estudiante (TI2-89).
 *
 * Primera pantalla web en utilidades Tailwind (TI2-130): usa solo tokens del
 * `@theme` de `index.css`, sin CSS propio. Lee solo queries públicas ya
 * existentes; la autorización vive en Convex. `listOwnRequests` devuelve solo
 * filas propias y `getRequest` detalla la solicitud del titular. Otra cuenta,
 * otro rol o una cuenta pendiente de habilitación reciben la denegación
 * genérica del Backend sin filtrar existencia ni titularidad. Sin acciones de
 * crear ni operar: eso es de otras entregas.
 */
export function StudentRequestsPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="student-requests-page-title" className="flex flex-col gap-6">
      <h1
        id="student-requests-page-title"
        ref={headingRef}
        tabIndex={-1}
        className="text-[1.75rem] leading-snug font-semibold text-primary"
      >
        Mis solicitudes
      </h1>
      <p className="text-base text-on-surface">
        Consulta el estado de tus solicitudes registradas.
      </p>
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
    // La firma cubre datos y avance de página: el mismo ID con
    // otro estado o con `isDone` distinto reemplaza el segmento en vez de
    // conservar la vista anterior.
    const currentHash = [
      page.isDone ? "done" : "more",
      ...page.page.map((item) => `${item._id}:${item.status}`),
    ].join(",");
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
      <p
        role="status"
        className="rounded-lg bg-surface-container-low p-6 text-lg text-on-surface-variant"
      >
        Cargando tus solicitudes…
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border-t-4 border-secondary-container bg-surface-container-low p-6 text-on-surface-variant">
        <p className="mb-2 font-semibold text-on-surface">Aún no tienes solicitudes registradas.</p>
        <p>Cuando envíes tu primera solicitud, aparecerá aquí con su estado.</p>
      </div>
    );
  }

  return (
    <>
      <ul className="grid gap-3 p-0">
        {items.map((request) => (
          <li
            key={request._id}
            className="rounded-md border border-border-low bg-surface-container-lowest px-5 py-4"
          >
            <Link
              to="/estudiante/solicitudes/$requestId"
              params={{ requestId: request._id }}
              className="flex min-h-[44px] items-center gap-2 rounded-[0.5rem] px-3 py-2 no-underline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <span className="inline-flex w-fit items-center rounded-full bg-surface-container-low px-3 py-1 text-sm font-bold text-on-surface">
                {requestStatusLabel(request.status)}
              </span>
              <span className="text-base text-on-surface-variant">
                Registrada el {formatPanelDate(request.createdAt)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {done ? null : (
        <div className="mt-6 flex flex-col gap-4">
          <button
            type="button"
            className="inline-flex min-h-12 min-w-11 items-center justify-center gap-3 rounded-[0.5rem] bg-primary px-6 py-2.5 text-base font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-60 not-disabled:hover:bg-on-primary-fixed-variant focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            disabled={pending}
            onClick={loadMore}
            aria-busy={pending}
          >
            {pending ? "Cargando…" : "Cargar más"}
          </button>
          {pending && (
            <span role="status" aria-live="polite" className="sr-only">
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
    <section aria-labelledby="student-request-detail-title" className="flex flex-col gap-6">
      <h1
        id="student-request-detail-title"
        ref={headingRef}
        tabIndex={-1}
        className="text-[1.75rem] leading-snug font-semibold text-primary"
      >
        Detalle de la solicitud
      </h1>
      <p>
        <Link
          to="/estudiante/solicitudes"
          className="inline-flex min-h-[44px] items-center rounded-[0.5rem] px-3 py-2 no-underline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
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
      <p
        role="status"
        className="rounded-lg bg-surface-container-low p-6 text-lg text-on-surface-variant"
      >
        Cargando el detalle…
      </p>
    );
  }

  return (
    <dl className="rounded-lg border border-border-low bg-surface-container-lowest p-8">
      <div className="py-2">
        <dt className="font-semibold text-on-surface">Estado</dt>
        <dd className="m-0 text-on-surface">{requestStatusLabel(request.status)}</dd>
      </div>
      <div className="py-2">
        <dt className="font-semibold text-on-surface">Registrada</dt>
        <dd className="m-0 text-on-surface">{formatPanelDate(request.createdAt)}</dd>
      </div>
      <div className="py-2">
        <dt className="font-semibold text-on-surface">Necesidades de acceso</dt>
        <dd className="m-0 text-on-surface">{request.accessNeeds}</dd>
      </div>
    </dl>
  );
}
