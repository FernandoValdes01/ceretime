import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  PRIVACY_REQUEST_KIND_LABELS,
  PRIVACY_REQUEST_STATUS_LABELS,
  SUBMITTABLE_PRIVACY_REQUEST_KINDS,
  type PrivacyRequestKind,
} from "../../../../../convex/domain/index.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import { isAuthorizationDenial } from "../shared/authorization-denial.ts";
import { formatCivilDateWithYear } from "../shared/date-format.ts";
import { DeniedState, EmptyState, LoadingState } from "../shared/view-states.tsx";
import {
  FOCUS_CLASS,
  LINK_CLASS,
  PAGE_CLASS,
  PAGE_TITLE_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  SECTION_TITLE_CLASS,
} from "../estudiante/student-page-classes.ts";
import {
  PRIVACY_PAGE_SIZE,
  useOwnPrivacyRequests,
  usePrivacyRequest,
  useSubmitPrivacyRequest,
  type PrivacyRequestView,
} from "./privacy-data.ts";
import { privacyActionErrorMessage } from "./privacy-errors.ts";
import { PRIVACY_PENDING_KINDS_NOTICE, privacyKindDescription } from "./privacy-notice.ts";
import { PrivacyRequestSummary } from "./privacy-request-summary.tsx";

/**
 * Solicitudes de derechos de privacidad del Estudiante (TI2-171).
 *
 * Presenta y consulta solo solicitudes propias con `submitPrivacyRequest`,
 * `listOwnPrivacyRequests` y `getPrivacyRequest`. Ofrece únicamente los
 * derechos que el Backend recibe (`SUBMITTABLE_PRIVACY_REQUEST_KINDS`); el
 * acuse de recibo, los plazos y la prórroga llegan del Backend. Otra cuenta
 * o una solicitud ajena reciben la denegación genérica.
 */
export function StudentPrivacyPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="student-privacy-title" className={PAGE_CLASS}>
      <div className="flex flex-col gap-2">
        <h1
          id="student-privacy-title"
          ref={headingRef}
          tabIndex={-1}
          className={`${PAGE_TITLE_CLASS} ${FOCUS_CLASS}`}
        >
          Privacidad
        </h1>
        <p className="m-0 text-base text-on-surface-variant">
          Ejerce tus derechos sobre tus datos personales y sigue cada solicitud. Antes de presentar,
          puedes leer el aviso de privacidad.
        </p>
        <Link to="/privacidad" className={LINK_CLASS}>
          Leer el aviso de privacidad
        </Link>
      </div>
      <SubmitPrivacyRequestForm />
      <StudentPanelErrorBoundary subject="tus solicitudes de privacidad" level="section">
        <OwnPrivacyRequests />
      </StudentPanelErrorBoundary>
    </section>
  );
}

function SubmitPrivacyRequestForm() {
  const submit = useSubmitPrivacyRequest();
  const [kind, setKind] = useState<PrivacyRequestKind | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<PrivacyRequestView | null>(null);
  const [pending, setPending] = useState(false);
  const firstKindRef = useRef<HTMLInputElement>(null);

  async function onSubmit() {
    if (pending) return;
    if (kind === null) {
      setFieldError("Elige el derecho que quieres ejercer.");
      firstKindRef.current?.focus();
      return;
    }
    setPending(true);
    setFieldError(null);
    setError(null);
    setReceipt(null);
    try {
      setReceipt(await submit(kind));
      setKind(null);
    } catch (caught) {
      setError(privacyActionErrorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="student-privacy-submit-title"
      className="flex flex-col gap-4 rounded-lg border border-border-low bg-surface-container-lowest p-6"
    >
      <h2 id="student-privacy-submit-title" className={SECTION_TITLE_CLASS}>
        Presentar una solicitud
      </h2>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit();
        }}
      >
        <fieldset
          className="m-0 flex flex-col gap-3 border-0 p-0"
          aria-describedby={fieldError === null ? undefined : "student-privacy-kind-error"}
        >
          <legend className="mb-1 p-0 text-base font-semibold text-on-surface">
            ¿Qué derecho quieres ejercer?
          </legend>
          {SUBMITTABLE_PRIVACY_REQUEST_KINDS.map((option, index) => (
            <label
              key={option}
              className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border border-border-low p-3"
            >
              <input
                ref={index === 0 ? firstKindRef : undefined}
                type="radio"
                name="privacy-kind"
                value={option}
                checked={kind === option}
                onChange={() => setKind(option)}
                className="mt-1 size-5 shrink-0"
              />
              <span className="flex flex-col gap-1">
                <span className="font-semibold text-on-surface">
                  {PRIVACY_REQUEST_KIND_LABELS[option]}
                </span>
                <span className="text-base text-on-surface-variant">
                  {privacyKindDescription(option)}
                </span>
              </span>
            </label>
          ))}
          {PRIVACY_PENDING_KINDS_NOTICE === null ? null : (
            <p className="m-0 text-base text-on-surface-variant">{PRIVACY_PENDING_KINDS_NOTICE}</p>
          )}
          {fieldError === null ? null : (
            <p
              id="student-privacy-kind-error"
              role="alert"
              className="m-0 font-semibold text-error"
            >
              {fieldError}
            </p>
          )}
        </fieldset>
        {error === null ? null : (
          <p role="alert" className="m-0 font-semibold text-error">
            {error}
          </p>
        )}
        <button
          type="submit"
          className={`${PRIMARY_BUTTON_CLASS} w-fit`}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? "Enviando…" : "Presentar la solicitud"}
        </button>
      </form>
      {receipt === null ? null : (
        <div role="status" className="flex flex-col gap-2 rounded-lg bg-primary-fixed/40 p-4">
          <p className="m-0 font-semibold text-on-surface">
            Recibimos tu solicitud de {PRIVACY_REQUEST_KIND_LABELS[receipt.kind].toLowerCase()}.
          </p>
          <p className="m-0 text-base text-on-surface">
            Te responderemos hasta el {formatCivilDateWithYear(receipt.initialDueDate)}.
          </p>
          <Link
            to="/estudiante/privacidad/$requestId"
            params={{ requestId: receipt.id }}
            className={LINK_CLASS}
          >
            Ver la solicitud
          </Link>
        </div>
      )}
    </section>
  );
}

function OwnPrivacyRequests() {
  const { results, status, loadMore } = useOwnPrivacyRequests();
  const loadingMore = status === "LoadingMore";
  const canLoadMore = status === "CanLoadMore" || loadingMore;

  if (status === "LoadingFirstPage") {
    return <LoadingState label="Cargando tus solicitudes de privacidad…" />;
  }

  return (
    <section aria-labelledby="student-privacy-list-title" className="flex flex-col gap-3">
      <h2 id="student-privacy-list-title" className={SECTION_TITLE_CLASS}>
        Mis solicitudes de privacidad
      </h2>
      {results.length === 0 && !canLoadMore ? (
        <EmptyState title="Todavía no presentas solicitudes de privacidad.">
          <p>Cuando presentes una, aparecerá aquí con su estado y su plazo de respuesta.</p>
        </EmptyState>
      ) : (
        <ul role="list" className="m-0 grid list-none gap-3 p-0">
          {results.map((request) => (
            <li key={request.id}>
              <Link
                to="/estudiante/privacidad/$requestId"
                params={{ requestId: request.id }}
                className={`flex flex-col gap-1 rounded-lg border border-border-low bg-surface-container-lowest p-5 text-on-surface no-underline hover:bg-surface-container-low ${FOCUS_CLASS}`}
              >
                <span className="font-semibold">
                  {PRIVACY_REQUEST_KIND_LABELS[request.kind]} ·{" "}
                  {PRIVACY_REQUEST_STATUS_LABELS[request.status]}
                </span>
                <span className="text-sm text-on-surface-variant">
                  Plazo hasta el{" "}
                  {formatCivilDateWithYear(
                    request.extension?.extendedUntilDate ?? request.initialDueDate,
                  )}
                </span>
                <span className="font-semibold text-primary">Ver detalle ›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canLoadMore ? (
        <button
          type="button"
          className={`${SECONDARY_BUTTON_CLASS} w-fit`}
          disabled={loadingMore}
          aria-busy={loadingMore}
          onClick={() => loadMore(PRIVACY_PAGE_SIZE)}
        >
          {loadingMore ? "Cargando…" : "Cargar más"}
        </button>
      ) : null}
    </section>
  );
}

/** Detalle de una solicitud propia, con sus fechas, respuesta y plazo de reclamo. */
export function StudentPrivacyRequestDetailPage({ requestId }: { requestId: string }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="student-privacy-detail-title" className={PAGE_CLASS}>
      <h1
        id="student-privacy-detail-title"
        ref={headingRef}
        tabIndex={-1}
        className={`${PAGE_TITLE_CLASS} ${FOCUS_CLASS}`}
      >
        Solicitud de privacidad
      </h1>
      <p className="m-0">
        <Link to="/estudiante/privacidad" className={LINK_CLASS}>
          Volver a privacidad
        </Link>
      </p>
      <StudentPanelErrorBoundary subject="la solicitud de privacidad" level="section">
        <OwnPrivacyRequestBody requestId={requestId} />
      </StudentPanelErrorBoundary>
    </section>
  );
}

function OwnPrivacyRequestBody({ requestId }: { requestId: string }) {
  let request: PrivacyRequestView | undefined;
  try {
    // Hook primero y en todos los renders: el try solo clasifica el error.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    request = usePrivacyRequest(requestId);
  } catch (error) {
    if (isAuthorizationDenial(error)) {
      return <DeniedState title="No tienes acceso a esta solicitud de privacidad." />;
    }
    throw error;
  }
  if (request === undefined) return <LoadingState label="Cargando la solicitud…" />;
  return <PrivacyRequestSummary request={request} />;
}
