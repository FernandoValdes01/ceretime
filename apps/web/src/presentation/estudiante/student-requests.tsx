import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
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

/** Segmento de página con su firma de datos y su cursor. */
type PageSegment<Item extends RequestListItem> = {
  readonly items: ReadonlyArray<Item>;
  readonly hash: string;
  readonly continueCursor: string;
};

/** Firma de datos y avance de un segmento. */
function pageHash<Item extends RequestListItem>(page: RequestListPage<Item>): string {
  return [
    page.isDone ? "done" : "more",
    ...page.page.map((item) => `${item._id}:${item.status}`),
  ].join(",");
}

/**
 * Sonda de suscripción de un cursor fijo (TI2-89).
 *
 * Mantiene viva la suscripción de su página para que los pushes reactivos
 * actualicen cada segmento cargado, no solo la cola. No muestra nada;
 * entrega el segmento al mapa compartido. La guarda por contenido evita
 * trabajo de más cuando nada cambió.
 */
function PageProbe<Item extends RequestListItem>(props: {
  readonly usePage: (cursor: string | null) => RequestListPage<Item> | undefined;
  readonly cursor: string | null;
  readonly onSegment: (key: string, page: RequestListPage<Item>) => void;
}) {
  const page = props.usePage(props.cursor);
  if (page !== undefined) {
    props.onSegment(props.cursor ?? "first", page);
  }
  return null;
}

/**
 * Acumula páginas con cursor sin duplicar y refleja actualizaciones
 * reactivas (TI2-89).
 *
 * Suscribe todos los cursores cargados, uno por sonda fija: un push
 * reactivo actualiza cualquier página, no solo la cola. Converge con
 * `usePaginatedQuery` de TI2-92 (resultados siempre frescos, avance por
 * cursor); al integrar esa tarea se conserva un solo mecanismo. Guarda
 * cada segmento una sola vez durante el render (patrón documentado de
 * React para ajustar estado en render): evita setState en efectos sin
 * perder páginas al avanzar el cursor. La clave es el cursor pedido.
 * Además, si Convex devuelve una página distinta para el mismo cursor
 * (actualización reactiva), se reemplaza ese segmento y se reconstruye
 * la lista completa en orden de cursor.
 */
function usePagedItems<Item extends RequestListItem>(
  usePage: (cursor: string | null) => RequestListPage<Item> | undefined,
) {
  const [cursors, setCursors] = useState<readonly (string | null)[]>([null]);
  const [segments, setSegments] = useState<ReadonlyMap<string, PageSegment<Item>>>(new Map());
  const [done, setDone] = useState(false);

  const mergeSegment = (key: string, page: RequestListPage<Item>) => {
    const hash = pageHash(page);
    setSegments((prev) => {
      const existing = prev.get(key);
      if (existing !== undefined && existing.hash === hash) {
        return prev;
      }
      const next = new Map(prev);
      next.set(key, {
        items: page.page,
        hash,
        continueCursor: page.continueCursor,
      });
      return next;
    });
    if (key === (cursors[cursors.length - 1] ?? "first") && page.isDone !== done) {
      setDone(page.isDone);
    }
  };

  const probes = cursors.map((cursor) => (
    <PageProbe key={cursor ?? "first"} usePage={usePage} cursor={cursor} onSegment={mergeSegment} />
  ));

  // Reconstruye la lista concatenando segmentos en orden de cursor.
  const items = cursors.flatMap((cursor) => segments.get(cursor ?? "first")?.items ?? []);
  const tailKey = cursors[cursors.length - 1] ?? "first";
  const pending = !segments.has(tailKey);

  const loadMore = () => {
    const next = segments.get(tailKey)?.continueCursor ?? null;
    if (next === null || next === "") {
      return;
    }
    setCursors((prev) => (prev.includes(next) ? prev : [...prev, next]));
  };

  return {
    items,
    done,
    pending,
    loadMore,
    probes,
  };
}

function OwnRequestsBody() {
  const { items, done, pending, loadMore, probes } = usePagedItems(useOwnRequests);

  let content: ReactNode;
  if (pending && items.length === 0) {
    content = (
      <p
        role="status"
        className="rounded-lg bg-surface-container-low p-6 text-lg text-on-surface-variant"
      >
        Cargando tus solicitudes…
      </p>
    );
  } else if (items.length === 0) {
    content = (
      <div className="rounded-lg border-t-4 border-secondary-container bg-surface-container-low p-6 text-on-surface-variant">
        <p className="mb-2 font-semibold text-on-surface">Aún no tienes solicitudes registradas.</p>
        <p>Cuando envíes tu primera solicitud, aparecerá aquí con su estado.</p>
      </div>
    );
  } else {
    content = (
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

  // Las sondas sostienen la suscripción de cada página cargada sin
  // mostrar nada: van siempre montadas, también en carga y vacío.
  return (
    <>
      {probes}
      {content}
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
