import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
// Fuente canónica del contrato de errores (TI2-23, TI2-88): el Backend
// responde toda denegación con este código genérico, sin motivo ni
// existencia del recurso. Se importa del barrel, no se duplica el literal.
import { isOpenRequestState, UNAUTHORIZED_ERROR_CODE } from "../../../../../convex/domain/index.ts";
import { publicErrorOf } from "../../infrastructure/convex/public-error.ts";
import { formatPanelDate, requestStatusLabel } from "../routes/student-panel-labels.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import {
  PAGE_SIZE,
  useOwnRequestDetail,
  useOwnRequestsPaginated,
  type OwnRequestDetail,
  type OwnRequestItem,
} from "./student-requests-data.ts";
import { REQUEST_PROCESS_STEPS } from "./request-process.ts";
import {
  FOCUS_CLASS,
  PAGE_CLASS,
  PAGE_TITLE_CLASS,
  PRIMARY_LINK_CLASS,
  SECTION_TITLE_CLASS,
} from "./student-page-classes.ts";

/**
 * Listado y detalle de solicitudes propias del Estudiante (TI2-89).
 *
 * Primera pantalla web en utilidades Tailwind (TI2-130): usa solo tokens del
 * `@theme` de `index.css`, sin CSS propio. Lee solo queries públicas ya
 * existentes; la autorización vive en Convex. `listOwnRequests` devuelve solo
 * filas propias y `getRequest` detalla la solicitud del titular. Otra cuenta,
 * otro rol o una cuenta pendiente de habilitación reciben la denegación
 * genérica del Backend sin filtrar existencia ni titularidad. El envío vive
 * en `student-request-form.tsx` (TI2-149); operar una solicitud es de otras
 * entregas.
 */
export function StudentRequestsPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="student-requests-page-title" className={PAGE_CLASS}>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1
            id="student-requests-page-title"
            ref={headingRef}
            tabIndex={-1}
            className={PAGE_TITLE_CLASS}
          >
            Mis solicitudes
          </h1>
          <p className="m-0 text-base text-on-surface-variant">
            Consulta en qué estado está cada solicitud que enviaste a CERETI.
          </p>
        </div>
        <Link to="/estudiante/solicitudes/nueva" className={`${PRIMARY_LINK_CLASS} shrink-0`}>
          Nueva solicitud
        </Link>
      </header>
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
      return <NoRequestsYet />;
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

  const open = results.filter((request) => isOpenRequestState(request.status));
  const finished = results.filter((request) => !isOpenRequestState(request.status));

  return (
    <div className="flex flex-col gap-8">
      <RequestGroup
        id="open"
        title="En curso"
        emptyText="No tienes solicitudes en curso."
        requests={open}
      />
      {finished.length > 0 ? (
        <RequestGroup id="finished" title="Finalizadas" requests={finished} />
      ) : null}
      {canLoadMore ? (
        <div className="flex flex-col gap-4">
          <LoadMoreButton pending={loadingMore} onLoadMore={() => loadMore(PAGE_SIZE)} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Sin solicitudes: explica el proceso con los mismos pasos de Inicio y
 * ofrece empezar, en vez de dejar la página vacía.
 */
function NoRequestsYet() {
  return (
    <div className="flex flex-col gap-5 rounded-lg border border-border-low border-t-4 border-t-secondary-container bg-surface-container-lowest p-6">
      <div className="flex flex-col gap-1">
        <h2 className={SECTION_TITLE_CLASS}>Aún no tienes solicitudes</h2>
        <p className="m-0 text-base text-on-surface-variant">
          Cuando envíes una, aparecerá aquí con su estado. Así funciona:
        </p>
      </div>
      <ol className="m-0 grid list-none gap-4 p-0 sm:grid-cols-3">
        {REQUEST_PROCESS_STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-fixed font-bold text-on-primary-fixed"
            >
              {index + 1}
            </span>
            <div className="flex flex-col gap-1">
              <h3 className="m-0 text-base font-semibold text-on-surface">{step.title}</h3>
              <p className="m-0 text-base text-on-surface-variant">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <Link to="/estudiante/solicitudes/nueva" className={PRIMARY_LINK_CLASS}>
        Enviar mi primera solicitud
      </Link>
    </div>
  );
}

function RequestGroup({
  id,
  title,
  emptyText,
  requests,
}: {
  id: string;
  title: string;
  emptyText?: string;
  requests: readonly OwnRequestItem[];
}) {
  const titleId = `student-requests-${id}-title`;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h2 id={titleId} className={SECTION_TITLE_CLASS}>
        {title} <span className="font-normal text-on-surface-variant">({requests.length})</span>
      </h2>
      {requests.length === 0 ? (
        <p className="m-0 text-base text-on-surface-variant">{emptyText}</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {requests.map((request) => (
            <li key={request._id}>
              <RequestCard request={request} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Máximo de necesidades visibles en la tarjeta; el detalle muestra todas. */
const VISIBLE_ACCESS_NEEDS = 3;

/**
 * Tarjeta enlazada de una solicitud: toda la tarjeta lleva al detalle. El
 * estado se lee en texto e ícono; el color del borde solo lo refuerza.
 */
function RequestCard({ request }: { request: OwnRequestItem }) {
  const toneName = requestStatusTone(request.status);
  const tone = REQUEST_STATUS_TONES[toneName];
  // El Backend une las necesidades seleccionadas y el texto libre con saltos de línea.
  const needs = request.accessNeeds
    .split("\n")
    .map((need) => need.trim())
    .filter((need) => need !== "");
  const hiddenNeeds = needs.length - VISIBLE_ACCESS_NEEDS;
  return (
    <Link
      to="/estudiante/solicitudes/$requestId"
      params={{ requestId: request._id }}
      className={`group flex flex-col gap-3 rounded-lg border border-border-low border-t-4 bg-surface-container-lowest p-5 text-on-surface no-underline hover:bg-surface-container-low ${tone.border} ${FOCUS_CLASS}`}
    >
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold ${tone.chip}`}
        >
          <StatusIcon tone={toneName} />
          {requestStatusLabel(request.status)}
        </span>
        <span className="text-sm text-on-surface-variant">
          Enviada el {formatPanelDate(request.createdAt)}
        </span>
      </span>
      {needs.length > 0 ? (
        <span className="flex flex-wrap gap-2">
          <span className="sr-only">Necesidades de acceso:</span>
          {needs.slice(0, VISIBLE_ACCESS_NEEDS).map((need) => (
            <span
              key={need}
              className="max-w-full truncate rounded-full bg-surface-container px-3 py-1 text-sm text-on-surface"
            >
              {need}
            </span>
          ))}
          {hiddenNeeds > 0 ? (
            <span className="py-1 text-sm text-on-surface-variant">y {hiddenNeeds} más</span>
          ) : null}
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1 font-semibold text-primary group-hover:underline">
        Ver detalle
        <span aria-hidden="true">›</span>
      </span>
    </Link>
  );
}

type RequestStatusTone = "pending" | "inReview" | "attention" | "success" | "referred" | "closed";

/** Presentación de cada estado: solo refuerza la etiqueta, que es la fuente del significado. */
function requestStatusTone(status: string): RequestStatusTone {
  switch (status) {
    case "received":
      return "pending";
    case "under_review":
      return "inReview";
    case "awaiting_information_or_acceptance":
      return "attention";
    case "accepted":
      return "success";
    case "referred":
      return "referred";
    default:
      return "closed";
  }
}

const REQUEST_STATUS_TONES: Record<RequestStatusTone, { border: string; chip: string }> = {
  pending: {
    border: "border-t-secondary-container",
    chip: "bg-secondary-fixed text-on-secondary-fixed",
  },
  inReview: { border: "border-t-calm-blue", chip: "bg-surface-container text-on-surface" },
  attention: { border: "border-t-tertiary", chip: "bg-tertiary-fixed text-on-tertiary-fixed" },
  success: { border: "border-t-support-green", chip: "bg-primary-fixed text-on-primary-fixed" },
  referred: { border: "border-t-calm-blue", chip: "bg-surface-container text-on-surface" },
  closed: {
    border: "border-t-outline-variant",
    chip: "bg-surface-container-high text-on-surface-variant",
  },
};

const STATUS_ICON_PATHS: Record<RequestStatusTone, string> = {
  pending: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
  inReview: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 4 4",
  attention: "M12 8v5m0 3h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
  success: "m8 12 3 3 5-6M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
  referred: "M5 12h12m-4-4 4 4-4 4",
  closed: "m9 9 6 6m0-6-6 6M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
};

/** Ícono decorativo del estado; la etiqueta de texto ya dice el estado. */
function StatusIcon({ tone }: { tone: RequestStatusTone }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={STATUS_ICON_PATHS[tone]} />
    </svg>
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
 * La denegación del Backend es el código genérico documentado: no revela
 * si la solicitud existe ni de quién es. También cubre la sesión expirada,
 * que se recupera desde el acceso (el layout enlaza la sesión).
 *
 * El valor canónico viaja en `error.data`: el SDK del cliente decora
 * `error.message` con su contexto (query y request ID), así que comparar el
 * mensaje falla contra el Backend real. Desde TI2-181 `getRequest` responde
 * `{ code: "unauthorized" }`; el texto de Sprint 1 se sigue aceptando mientras
 * Web y Convex se despliegan por separado.
 */
function isAuthorizationDenial(error: unknown): boolean {
  return publicErrorOf(error)?.code === UNAUTHORIZED_ERROR_CODE;
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
