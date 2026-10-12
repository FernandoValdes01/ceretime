import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { formatPanelDate } from "../routes/student-panel-labels.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import type { Id } from "../../../../../convex/_generated/dataModel";
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
/**
 * Textarea del modal (TI2-92, migrado por TI2-130): el anillo de foco usa la
 * variable de compatibilidad --ct-ring (igual que antes); no se cambia al
 * token del tema para no alterar el color vigente.
 */
const GESTION_TEXTAREA =
  "w-full min-h-32 resize-y rounded-[0.5rem] border border-(--ct-line) bg-(--ct-card) px-4 py-3 text-base leading-normal text-(--ct-ink) transition-[border-color,box-shadow] duration-150 focus-visible:border-(--ct-primary) focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-(--ct-ring) focus-visible:outline-offset-[2px]";
const GESTION_TEXTAREA_ERROR =
  "border-(--ct-danger) focus-visible:shadow-[0_0_0_3px_var(--ct-danger-bg)]";
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

function RequestRow({
  request,
  clickable = true,
  take,
}: {
  request: RequestListItem;
  clickable?: boolean;
  /** Solo bandeja: tomar sin pasar por el detalle (denegado sin toma). */
  take?: { disabled: boolean; busy: boolean; onTake: () => void };
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
        {take && (
          <button
            type="button"
            className="student-portal__btn student-portal__btn--ghost disabled:cursor-not-allowed disabled:opacity-60"
            disabled={take.disabled || take.busy}
            onClick={take.onTake}
            aria-busy={take.busy}
          >
            {take.busy ? "Tomando…" : "Tomar"}
          </button>
        )}
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
 * Se exporta para probar la reactividad por página de forma aislada.
 */
export function PagedItems<Item extends RequestListItem>({
  cursors,
  usePage,
  renderItem,
  onCount,
}: {
  cursors: ReadonlyArray<string | null>;
  usePage: (cursor: string | null) => RequestListPage<Item> | undefined;
  renderItem: (item: Item) => ReactNode;
  onCount: (cursor: string | null, count: number) => void;
}) {
  return (
    <>
      {cursors.map((cursor) => (
        <PageItems
          key={cursor ?? "first"}
          cursor={cursor}
          usePage={usePage}
          renderItem={renderItem}
          onCount={onCount}
        />
      ))}
    </>
  );
}

function PageItems<Item extends RequestListItem>({
  cursor,
  usePage,
  renderItem,
  onCount,
}: {
  cursor: string | null;
  usePage: (cursor: string | null) => RequestListPage<Item> | undefined;
  renderItem: (item: Item) => ReactNode;
  onCount: (cursor: string | null, count: number) => void;
}) {
  const page = usePage(cursor);
  onCount(cursor, page === undefined ? 0 : page.page.length);
  if (page === undefined) {
    return null;
  }
  return <>{page.page.map((item) => renderItem(item))}</>;
}

function OpenInboxBody() {
  const {
    cursors,
    firstPage,
    hasItems,
    allReported,
    tailPending,
    tailDone,
    loadMore,
    reportCount,
  } = usePagedList(useOpenRequests);
  const takeRequest = useTakeRequest();
  const [takingId, setTakingId] = useState<string | null>(null);
  const [takeError, setTakeError] = useState<string | null>(null);

  // La toma vive en la bandeja porque el detalle exige toma activa
  // (getRequest deniega sin ella): sin este botón la acción sería inalcanzable.
  async function handleTake(requestId: string) {
    if (takingId !== null) {
      return;
    }
    setTakeError(null);
    setTakingId(requestId);
    try {
      await takeRequest({ requestId: requestId as Id<"requests"> });
      // Las queries reactivas mueven la solicitud a "Mis tomadas" solas.
    } catch (err) {
      setTakeError(err instanceof Error ? err.message : "No se pudo tomar la solicitud");
    } finally {
      setTakingId(null);
    }
  }

  if (firstPage === undefined) {
    return (
      <p role="status" className="student-portal__loading">
        Cargando la bandeja…
      </p>
    );
  }

  return (
    <>
      {takeError && (
        <p role="alert" className="student-portal__error">
          {takeError}
        </p>
      )}
      {!hasItems && allReported ? (
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
            <RequestRow
              key={request._id}
              request={request}
              clickable={false}
              take={{
                disabled: takingId !== null,
                busy: takingId === request._id,
                onTake: () => handleTake(request._id),
              }}
            />
          )}
          onCount={reportCount}
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
    tailPending,
    tailDone,
    loadMore,
    reportCount,
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
      {!hasItems && allReported ? (
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
          onCount={reportCount}
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
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  // El estado es lo único estable del detalle ante cualquier transición.
  const statusRef = useRef<HTMLElement>(null);

  // Foco del modal (TI2-92): al abrir va al motivo; al cerrar vuelve al botón
  // que lo abrió. El cierre se resuelve en efecto tras el commit (y no en el
  // handler): al cerrar tras un envío el botón sigue deshabilitado hasta que
  // se vacía isActionPending, y focus() sobre un botón deshabilitado no hace
  // nada. Solo DOM, sin setState.
  const prevShowInfoModal = useRef(showInfoModal);
  useEffect(() => {
    if (showInfoModal) {
      reasonRef.current?.focus();
    } else if (prevShowInfoModal.current) {
      // Al cerrar vuelve al botón que abrió; si la transición tras un éxito
      // ya lo desmontó, cae al estado (estable en todo el detalle).
      if (openButtonRef.current) {
        openButtonRef.current.focus();
      } else {
        statusRef.current?.focus();
      }
    }
    prevShowInfoModal.current = showInfoModal;
  }, [showInfoModal]);

  function closeInfoModal() {
    setShowInfoModal(false);
  }

  // Trampa de Tab dentro del diálogo y cierre con Escape.
  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeInfoModal();
      return;
    }
    if (event.key !== "Tab" || dialogRef.current === null) {
      return;
    }
    const focusables = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusables.length === 0) {
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

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
      closeInfoModal();
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
          ref={openButtonRef}
          className="student-portal__btn student-portal__btn--primary"
          disabled={isActionPending}
          onClick={handleRequestInfoOpen}
          aria-busy={isActionPending}
          aria-haspopup="dialog"
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
          <dd ref={statusRef} tabIndex={-1}>
            {requestStatusLabel(request.status)}
          </dd>
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
          ref={dialogRef}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="info-modal-title"
          onKeyDown={handleDialogKeyDown}
        >
          <div className="w-full max-w-[28rem] rounded-lg border border-(--ct-line) bg-(--ct-card) p-6 shadow-[0_10px_25px_-5px_rgb(0_0_0/0.1),0_8px_10px_-6px_rgb(0_0_0/0.1)]">
            <h2 id="info-modal-title" className="mb-2 text-xl font-semibold text-(--ct-ink)">
              Pedir información adicional
            </h2>
            <p className="mb-6 text-base leading-normal text-(--ct-muted)">
              El estudiante recibirá este motivo para completar su solicitud.
            </p>
            <form onSubmit={handleRequestInfoSubmit}>
              <div className="mb-6">
                <label
                  htmlFor="info-reason"
                  className="mb-2 block text-sm font-semibold text-(--ct-ink)"
                >
                  Motivo <span aria-hidden="true">*</span>
                </label>
                <textarea
                  id="info-reason"
                  ref={reasonRef}
                  className={`${GESTION_TEXTAREA} ${infoReasonError ? GESTION_TEXTAREA_ERROR : ""}`}
                  value={infoReason}
                  onChange={(e) => setInfoReason(e.target.value)}
                  maxLength={2000}
                  rows={4}
                  aria-describedby={infoReasonError ? "info-reason-error" : "info-reason-hint"}
                  aria-invalid={infoReasonError ? "true" : "false"}
                  disabled={isActionPending}
                />
                {infoReasonError && (
                  <p
                    id="info-reason-error"
                    className="mt-2 text-sm font-semibold text-(--ct-danger)"
                    role="alert"
                  >
                    {infoReasonError}
                  </p>
                )}
                <p id="info-reason-hint" className="student-portal__hint mt-2">
                  Máximo 2000 caracteres ({infoReason.length}/2000)
                </p>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  className="student-portal__btn student-portal__btn--ghost disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={closeInfoModal}
                  disabled={isActionPending}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="student-portal__btn student-portal__btn--primary disabled:cursor-not-allowed disabled:opacity-60"
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
