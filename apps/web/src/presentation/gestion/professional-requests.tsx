import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { formatPanelDate } from "../routes/student-panel-labels.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
// Reutiliza el lenguaje visual del panel (listas, fichas, errores): una sola
// fuente para no duplicar el sistema de diseño entre portales.
import "../routes/student-portal.css";
import "./professional-requests.css";
import { requestStatusLabel } from "./gestion-labels.ts";
import { usePagedItems, type RequestListItem } from "./paged-requests.ts";
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
        <span className="gestion-request-row">{content}</span>
      </li>
    );
  }

  return (
    <li className="student-portal__item">
      <Link
        to="/profesional/solicitudes/$requestId"
        params={{ requestId: request._id }}
        className="gestion-request-link"
      >
        {content}
      </Link>
    </li>
  );
}

function OpenInboxBody() {
  const { items, done, pending, loadMore } = usePagedItems(useOpenRequests);

  if (pending && items.length === 0) {
    return (
      <p role="status" className="student-portal__loading">
        Cargando la bandeja…
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="student-portal__empty">
        <p className="student-portal__empty-title">No hay solicitudes por revisar.</p>
        <p>Cuando un estudiante registre una solicitud, aparecerá aquí.</p>
      </div>
    );
  }

  return (
    <>
      <ul className="student-portal__list">
        {items.map((request) => (
          <RequestRow key={request._id} request={request} clickable={false} />
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

function AuthorizedRequestsBody() {
  const { items, done, pending, loadMore } = usePagedItems(useAuthorizedRequests);

  if (pending && items.length === 0) {
    return (
      <p role="status" className="student-portal__loading">
        Cargando tus tomadas…
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="student-portal__empty">
        <p className="student-portal__empty-title">No tienes solicitudes tomadas.</p>
        <p>Las solicitudes que tomes para revisión aparecerán aquí.</p>
      </div>
    );
  }

  return (
    <>
      <ul className="student-portal__list">
        {items.map((request) => (
          <RequestRow key={request._id} request={request} clickable={true} />
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
        <Link to="/profesional/solicitudes" className="gestion-request-link">
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
