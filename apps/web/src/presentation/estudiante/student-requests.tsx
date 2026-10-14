import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { ConvexError } from "convex/values";
// Fuente canónica del contrato de errores (TI2-23, TI2-88): el Backend
// responde toda denegación con este mensaje genérico, sin motivo ni
// existencia del recurso. Se importa del barrel, no se duplica el literal.
import { UNAUTHORIZED_ERROR_MESSAGE } from "../../../../../convex/domain/index.ts";
import { formatPanelDate, requestStatusLabel } from "../routes/student-panel-labels.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import {
  PAGE_SIZE,
  useOwnRequestDetail,
  useOwnRequestsPaginated,
  type OwnRequestDetail,
} from "./student-requests-data.ts";

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

/**
 * Lista propia con la paginación reactiva de Convex (TI2-89).
 *
 * Sin caché local: lo mostrado es siempre lo último recibido, así los
 * cambios de estado se reflejan aunque lleguen después de avanzar de
 * página. Una página vacía no termina el listado: mientras el estado no
 * sea `Exhausted` se ofrece seguir cargando y el vacío definitivo aparece
 * solo al agotar las páginas. Los errores se lanzan al límite que envuelve
 * la vista, con reintento acotado.
 */
function OwnRequestsBody() {
  const { results, status, loadMore } = useOwnRequestsPaginated();
  const loadingMore = status === "LoadingMore";
  const canLoadMore = status === "CanLoadMore" || loadingMore;
  const exhausted = status === "Exhausted";

  if (results.length === 0) {
    if (exhausted) {
      return (
        <div className="rounded-lg border-t-4 border-secondary-container bg-surface-container-low p-6 text-on-surface-variant">
          <p className="mb-2 font-semibold text-on-surface">
            Aún no tienes solicitudes registradas.
          </p>
          <p>Cuando envíes tu primera solicitud, aparecerá aquí con su estado.</p>
        </div>
      );
    }
    if (canLoadMore) {
      return (
        <div className="flex flex-col gap-4">
          <p role="status" className="text-base text-on-surface-variant">
            Todavía no se cargaron solicitudes.
          </p>
          <LoadMoreButton pending={loadingMore} onLoadMore={() => loadMore(PAGE_SIZE)} />
        </div>
      );
    }
    return (
      <p
        role="status"
        className="rounded-lg bg-surface-container-low p-6 text-lg text-on-surface-variant"
      >
        Cargando tus solicitudes…
      </p>
    );
  }

  return (
    <>
      <ul className="grid gap-3 p-0">
        {results.map((request) => (
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
      {canLoadMore ? (
        <div className="mt-6 flex flex-col gap-4">
          <LoadMoreButton pending={loadingMore} onLoadMore={() => loadMore(PAGE_SIZE)} />
        </div>
      ) : null}
    </>
  );
}

function LoadMoreButton({ pending, onLoadMore }: { pending: boolean; onLoadMore: () => void }) {
  return (
    <>
      <button
        type="button"
        className="inline-flex min-h-12 min-w-11 items-center justify-center gap-3 rounded-[0.5rem] bg-primary px-6 py-2.5 text-base font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-60 not-disabled:hover:bg-on-primary-fixed-variant focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        disabled={pending}
        onClick={onLoadMore}
        aria-busy={pending}
      >
        {pending ? "Cargando…" : "Cargar más"}
      </button>
      {pending ? (
        <span role="status" aria-live="polite" className="sr-only">
          Cargando más solicitudes…
        </span>
      ) : null}
    </>
  );
}

/**
 * La denegación del Backend es el mensaje genérico documentado: no revela
 * si la solicitud existe ni de quién es. También cubre la sesión expirada,
 * que se recupera desde el acceso (el layout enlaza la sesión).
 */
function isAuthorizationDenial(error: unknown): boolean {
  return error instanceof ConvexError && error.message === UNAUTHORIZED_ERROR_MESSAGE;
}

/**
 * Detalle de una solicitud propia (TI2-89).
 *
 * La fila completa —incluidas las necesidades de acceso— solo llega por
 * `getRequest`, que el Backend deniega sin filtrar existencia cuando la
 * solicitud es ajena o inexistente. La denegación muestra un estado
 * permanente sin reintento; los errores recuperables se lanzan al límite,
 * que ofrece reintento acotado.
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
  let request: OwnRequestDetail | undefined;
  try {
    // El hook se invoca primero y en todos los renders: el orden es estable
    // y el try solo clasifica el error ya lanzado, no condiciona la llamada.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    request = useOwnRequestDetail(requestId);
  } catch (error) {
    if (isAuthorizationDenial(error)) {
      return (
        <div className="rounded-lg border-t-4 border-secondary-container bg-surface-container-low p-6 text-on-surface-variant">
          <p role="alert" className="mb-2 font-semibold text-on-surface">
            No tienes acceso a esta solicitud.
          </p>
          <p>Si crees que deberías verla, contáctanos por los canales oficiales.</p>
        </div>
      );
    }
    throw error;
  }

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
