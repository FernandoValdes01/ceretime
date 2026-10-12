import { useEffect, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { formatPanelDate } from "../routes/student-panel-labels.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
// Reutiliza el lenguaje visual del panel (listas, fichas, errores): una sola
// fuente para no duplicar el sistema de diseño entre portales.
import "../routes/student-portal.css";
import { requestStatusLabel } from "./gestion-labels.ts";
import { usePagedList, type RequestListItem, type RequestListPage } from "./paged-requests.ts";

/**
 * Clases Tailwind de las filas de gestión (TI2-91, migrado de
 * professional-requests.css por TI2-130): 44px de alto táctil mínimo y foco
 * visible de 3px según DESIGN.md. El anillo usa el token --color-focus-ring
 * del tema; el resto del lenguaje (listas, fichas, botones, avisos) sigue en
 * student-portal.css hasta que su responsable lo migre.
 */
const GESTION_ROW = "flex items-center gap-2 min-h-[44px] px-3 py-2 text-inherit";
const GESTION_FOCUS_VISIBLE =
  "focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-[2px]";
import {
  useAuthorizedRequests,
  useOpenRequests,
  useRequestDetail,
} from "./professional-requests-data.ts";

/**
 * Bandeja y tomadas del Profesional (TI2-91).
 *
 * Lee solo queries públicas ya existentes; la autorización vive en Convex.
 * La bandeja trae filas minimizadas (sin `accessNeeds` por diseño) y el
 * detalle completo solo llega vía `getRequest`, que el Backend deniega sin
 * toma activa. Sin acciones de tomar ni pedir información: eso es TI2-92.
 */
export function ProfessionalRequestsPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="professional-requests-title">
      <h1 id="professional-requests-title" ref={headingRef} tabIndex={-1}>
        Solicitudes
      </h1>
      <section aria-labelledby="open-inbox-title" className="student-portal__section">
        <div className="student-portal__section-head">
          <h2 id="open-inbox-title">Bandeja de triage</h2>
        </div>
        <p>Solicitudes recibidas con información mínima para descubrir.</p>
        <StudentPanelErrorBoundary subject="la bandeja de solicitudes" level="section">
          <OpenInboxBody />
        </StudentPanelErrorBoundary>
      </section>
      <section aria-labelledby="authorized-requests-title" className="student-portal__section">
        <div className="student-portal__section-head">
          <h2 id="authorized-requests-title">Mis tomadas</h2>
        </div>
        <StudentPanelErrorBoundary subject="tus solicitudes tomadas" level="section">
          <AuthorizedRequestsBody />
        </StudentPanelErrorBoundary>
      </section>
    </section>
  );
}

function RequestRow({
  request,
  clickable = true,
}: {
  request: RequestListItem;
  clickable?: boolean;
}) {
  const content = (
    <>
      <span className="student-portal__chip">{requestStatusLabel(request.status)}</span>
      <span className="student-portal__item-meta">
        Registrada el {formatPanelDate(request.createdAt)}
      </span>
    </>
  );

  if (!clickable) {
    return (
      <li className="student-portal__item">
        <span className={GESTION_ROW}>{content}</span>
      </li>
    );
  }

  return (
    <li className="student-portal__item">
      <Link
        to="/profesional/solicitudes/$requestId"
        params={{ requestId: request._id }}
        className={`${GESTION_ROW} no-underline ${GESTION_FOCUS_VISIBLE}`}
      >
        {content}
      </Link>
    </li>
  );
}

/**
 * Filas de cada página cargada, cada una con su propia suscripción (TI2-91).
 *
 * Un hijo <PageItems> por cursor pedido (identidad estable: los cursores solo
 * se agregan): todas las páginas cargadas mantienen lectura reactiva aunque
 * Convex actualice una anterior. El padre decide carga/vacío/botón con la
 * primera y la última página. `renderItem` pone la `key` de cada fila.
 *
 * Desduplicación: los cursores son posiciones fijas y un corrimiento por
 * cambios concurrentes puede repetir una fila en dos páginas; cada página
 * omite los IDs que ya mostraron las anteriores (registro idsByCursor del
 * hook). Se exporta para probar la reactividad por página de forma aislada.
 */
export function PagedItems<Item extends RequestListItem>({
  cursors,
  usePage,
  renderItem,
  onIds,
  idsByCursor,
}: {
  cursors: ReadonlyArray<string | null>;
  usePage: (cursor: string | null) => RequestListPage<Item> | undefined;
  renderItem: (item: Item) => ReactNode;
  onIds: (cursor: string | null, ids: ReadonlyArray<string>) => void;
  idsByCursor: ReadonlyMap<string, ReadonlyArray<string>>;
}) {
  const seen = new Set<string>();
  return (
    <>
      {cursors.map((cursor) => {
        const exclude = new Set(seen);
        for (const id of idsByCursor.get(cursor ?? "first") ?? []) {
          seen.add(id);
        }
        return (
          <PageItems
            key={cursor ?? "first"}
            cursor={cursor}
            usePage={usePage}
            renderItem={renderItem}
            onIds={onIds}
            exclude={exclude}
          />
        );
      })}
    </>
  );
}

function PageItems<Item extends RequestListItem>({
  cursor,
  usePage,
  renderItem,
  onIds,
  exclude,
}: {
  cursor: string | null;
  usePage: (cursor: string | null) => RequestListPage<Item> | undefined;
  renderItem: (item: Item) => ReactNode;
  onIds: (cursor: string | null, ids: ReadonlyArray<string>) => void;
  exclude: ReadonlySet<string>;
}) {
  const page = usePage(cursor);
  // Reporte en layout effect (no en render ni en efecto pasivo): en render
  // dispara el aviso "Cannot update ... while rendering a different
  // component", y con efecto pasivo el reporte llega después del paint — un
  // frame donde conviven el aviso de vacío y las filas recién llegadas. El
  // layout effect corre sincrónico antes del paint, sin parpadeo. La dep es
  // el objeto página (identidad estable por dato) y el updater con guarda
  // evita re-renders redundantes. Sin SSR en la app, no aplica su advertencia.
  useLayoutEffect(() => {
    onIds(cursor, page === undefined ? [] : page.page.map((item) => item._id));
  }, [cursor, page, onIds]);
  if (page === undefined) {
    return null;
  }
  return <>{page.page.filter((item) => !exclude.has(item._id)).map((item) => renderItem(item))}</>;
}

function OpenInboxBody() {
  const {
    cursors,
    firstPage,
    hasItems,
    allReported,
    idsByCursor,
    tailPending,
    tailDone,
    loadMore,
    reportIds,
  } = usePagedList(useOpenRequests);

  if (firstPage === undefined) {
    return (
      <p role="status" className="student-portal__loading">
        Cargando la bandeja…
      </p>
    );
  }

  return (
    <>
      {!hasItems && allReported && tailDone ? (
        <div className="student-portal__empty">
          <p className="student-portal__empty-title">No hay solicitudes por revisar.</p>
          <p>Cuando un estudiante registre una solicitud, aparecerá aquí.</p>
        </div>
      ) : null}
      <ul className="student-portal__list">
        <PagedItems
          cursors={cursors}
          usePage={useOpenRequests}
          renderItem={(request) => (
            <RequestRow key={request._id} request={request} clickable={false} />
          )}
          onIds={reportIds}
          idsByCursor={idsByCursor}
        />
      </ul>
      {tailDone ? null : (
        <div className="student-portal__cta">
          <button
            type="button"
            className="student-portal__btn student-portal__btn--primary"
            disabled={tailPending}
            onClick={loadMore}
            aria-busy={tailPending}
          >
            {tailPending ? "Cargando…" : "Cargar más"}
          </button>
          {tailPending && (
            <span role="status" aria-live="polite" className="sr-only">
              Cargando más solicitudes…
            </span>
          )}
        </div>
      )}
    </>
  );
}

function AuthorizedRequestsBody() {
  const {
    cursors,
    firstPage,
    hasItems,
    allReported,
    idsByCursor,
    tailPending,
    tailDone,
    loadMore,
    reportIds,
  } = usePagedList(useAuthorizedRequests);

  if (firstPage === undefined) {
    return (
      <p role="status" className="student-portal__loading">
        Cargando tus tomadas…
      </p>
    );
  }

  return (
    <>
      {!hasItems && allReported && tailDone ? (
        <div className="student-portal__empty">
          <p className="student-portal__empty-title">No tienes solicitudes tomadas.</p>
          <p>Las solicitudes que tomes para revisión aparecerán aquí.</p>
        </div>
      ) : null}
      <ul className="student-portal__list">
        <PagedItems
          cursors={cursors}
          usePage={useAuthorizedRequests}
          renderItem={(request) => (
            <RequestRow key={request._id} request={request} clickable={true} />
          )}
          onIds={reportIds}
          idsByCursor={idsByCursor}
        />
      </ul>
      {tailDone ? null : (
        <div className="student-portal__cta">
          <button
            type="button"
            className="student-portal__btn student-portal__btn--primary"
            disabled={tailPending}
            onClick={loadMore}
            aria-busy={tailPending}
          >
            {tailPending ? "Cargando…" : "Cargar más"}
          </button>
          {tailPending && (
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
 * Detalle de una solicitud tomada (TI2-91).
 *
 * La fila completa —incluidas las necesidades de acceso— solo llega por
 * `getRequest`, que el Backend deniega sin toma activa y sin filtrar
 * existencia. Ante denegación se muestra el aviso genérico del límite.
 */
export function ProfessionalRequestDetailPage({ requestId }: { requestId: string }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="professional-request-detail-title">
      <h1 id="professional-request-detail-title" ref={headingRef} tabIndex={-1}>
        Detalle de la solicitud
      </h1>
      <p>
        <Link
          to="/profesional/solicitudes"
          className={`${GESTION_ROW} no-underline ${GESTION_FOCUS_VISIBLE}`}
        >
          Volver a solicitudes
        </Link>
      </p>
      <StudentPanelErrorBoundary
        key={requestId}
        subject="el detalle de la solicitud"
        level="section"
      >
        <RequestDetailBody requestId={requestId} />
      </StudentPanelErrorBoundary>
    </section>
  );
}

function RequestDetailBody({ requestId }: { requestId: string }) {
  const request = useRequestDetail(requestId);

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
