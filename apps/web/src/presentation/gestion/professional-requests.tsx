import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { formatPanelDate } from "../routes/student-panel-labels.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import type { Id } from "../../../../../convex/_generated/dataModel";
// Reutiliza el lenguaje visual del panel (listas, fichas, errores): una sola
// fuente para no duplicar el sistema de diseño entre portales.
import "../routes/student-portal.css";
import "./professional-requests.css";
import { requestStatusLabel } from "./gestion-labels.ts";
import {
  useAuthorizedRequests,
  useOpenRequests,
  useRequestAdditionalInformation,
  useRequestDetail,
  useTakeRequest,
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

/** Fila mínima que muestran las listas: coincide con ambas vistas. */
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
 * reactivas (TI2-91).
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
      <StudentPanelErrorBoundary subject="el detalle de la solicitud" level="section">
        <RequestDetailBody requestId={requestId} />
      </StudentPanelErrorBoundary>
    </section>
  );
}

/** Acciones disponibles según el estado de la solicitud (TI2-92). */
type RequestAction = { type: "take" } | { type: "requestInfo" } | { type: "none" };

function getAvailableAction(status: string): RequestAction {
  switch (status) {
    case "received":
      return { type: "take" };
    case "under_review":
      return { type: "requestInfo" };
    default:
      return { type: "none" };
  }
}

function RequestDetailBody({ requestId }: { requestId: string }) {
  const request = useRequestDetail(requestId);
  const takeRequest = useTakeRequest();
  const requestAdditionalInformation = useRequestAdditionalInformation();

  // Estado local para la UI de acciones (TI2-92)
  const [actionError, setActionError] = useState<string | null>(null);
  const [isActionPending, setIsActionPending] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [infoReason, setInfoReason] = useState("");
  const [infoReasonError, setInfoReasonError] = useState<string | null>(null);

  if (request === undefined) {
    return (
      <p role="status" className="student-portal__loading">
        Cargando el detalle…
      </p>
    );
  }

  const availableAction = getAvailableAction(request.status);

  const handleTake = async () => {
    if (isActionPending) return;
    setActionError(null);
    setIsActionPending(true);
    try {
      await takeRequest({ requestId: requestId as Id<"requests"> });
      // La query reactiva (useRequestDetail) actualizará el estado automáticamente
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo tomar la solicitud");
    } finally {
      setIsActionPending(false);
    }
  };

  const handleRequestInfoOpen = () => {
    setShowInfoModal(true);
    setInfoReason("");
    setInfoReasonError(null);
  };

  const handleRequestInfoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isActionPending) return;

    const trimmed = infoReason.trim();
    if (!trimmed) {
      setInfoReasonError("El motivo es obligatorio");
      return;
    }
    if (trimmed.length > 2000) {
      setInfoReasonError("El motivo no puede exceder 2000 caracteres");
      return;
    }

    setInfoReasonError(null);
    setIsActionPending(true);
    try {
      await requestAdditionalInformation({
        requestId: requestId as Id<"requests">,
        reason: trimmed,
      });
      setShowInfoModal(false);
      // La query reactiva actualizará el estado automáticamente
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo pedir información");
    } finally {
      setIsActionPending(false);
    }
  };

  const actionButton = (() => {
    if (availableAction.type === "take") {
      return (
        <button
          type="button"
          className="student-portal__btn student-portal__btn--primary"
          disabled={isActionPending}
          onClick={handleTake}
          aria-busy={isActionPending}
        >
          {isActionPending ? "Tomando…" : "Tomar solicitud"}
        </button>
      );
    }
    if (availableAction.type === "requestInfo") {
      return (
        <button
          type="button"
          className="student-portal__btn student-portal__btn--primary"
          disabled={isActionPending}
          onClick={handleRequestInfoOpen}
          aria-busy={isActionPending}
        >
          {isActionPending ? "Enviando…" : "Pedir información"}
        </button>
      );
    }
    return null;
  })();

  return (
    <>
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

      {actionError && (
        <div className="student-portal__error" role="alert" aria-live="assertive">
          {actionError}
        </div>
      )}

      {actionButton && <div className="student-portal__cta">{actionButton}</div>}

      {/* Modal para pedir información (TI2-92) */}
      {showInfoModal && (
        <div
          className="student-portal__modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="info-modal-title"
        >
          <div className="student-portal__modal">
            <h2 id="info-modal-title" className="student-portal__modal-title">
              Pedir información adicional
            </h2>
            <p className="student-portal__modal-text">
              El estudiante recibirá este motivo para completar su solicitud.
            </p>
            <form onSubmit={handleRequestInfoSubmit}>
              <div className="student-portal__form-field">
                <label htmlFor="info-reason" className="student-portal__label">
                  Motivo <span aria-hidden="true">*</span>
                </label>
                <textarea
                  id="info-reason"
                  className={`student-portal__textarea ${infoReasonError ? "student-portal__textarea--error" : ""}`}
                  value={infoReason}
                  onChange={(e) => setInfoReason(e.target.value)}
                  maxLength={2000}
                  rows={4}
                  aria-describedby={infoReasonError ? "info-reason-error" : "info-reason-hint"}
                  aria-invalid={infoReasonError ? "true" : "false"}
                  disabled={isActionPending}
                />
                {infoReasonError && (
                  <p id="info-reason-error" className="student-portal__field-error" role="alert">
                    {infoReasonError}
                  </p>
                )}
                <p id="info-reason-hint" className="student-portal__hint">
                  Máximo 2000 caracteres ({infoReason.length}/2000)
                </p>
              </div>
              <div className="student-portal__modal-actions">
                <button
                  type="button"
                  className="student-portal__btn student-portal__btn--ghost"
                  onClick={() => setShowInfoModal(false)}
                  disabled={isActionPending}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="student-portal__btn student-portal__btn--primary"
                  disabled={isActionPending}
                  aria-busy={isActionPending}
                >
                  {isActionPending ? "Enviando…" : "Enviar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
