import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  PRIVACY_CONTROL_REFERENCE_MAX_LENGTH,
  PRIVACY_REQUEST_KIND_LABELS,
  PRIVACY_REQUEST_REASON_MAX_LENGTH,
  PRIVACY_REQUEST_STATUS_LABELS,
  PRIVACY_REQUEST_STATUS_VALUES,
  PRIVACY_RESPONSE_DELIVERY_CHANNEL_LABELS,
  PRIVACY_RESPONSE_DELIVERY_CHANNEL_VALUES,
  PRIVACY_RESPONSE_EXTENSION_CALENDAR_DAYS,
  PRIVACY_RESPONSE_OUTCOME_LABELS,
  PRIVACY_RESPONSE_OUTCOME_VALUES,
  isPrivacyRequestStatus,
  isTerminalPrivacyRequestStatus,
  type PrivacyRequestStatus,
  type PrivacyResponseDeliveryChannel,
  type PrivacyResponseOutcome,
} from "../../../../../convex/domain/index.ts";
import type { Id } from "../../../../../convex/_generated/dataModel";
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
  fieldClass,
} from "../estudiante/student-page-classes.ts";
import {
  PRIVACY_PAGE_SIZE,
  useExtendPrivacyRequestDeadline,
  usePrivacyRequest,
  usePrivacyRequestQueue,
  useRecordPrivacyResponseDelivery,
  useResolvePrivacyRequest,
  useStartPrivacyRequestReview,
  type PrivacyRequestView,
} from "./privacy-data.ts";
import { adminLoadFallback } from "../gestion/admin-load-fallback.tsx";
import { privacyActionErrorMessage } from "./privacy-errors.ts";
import { PrivacyRequestSummary } from "./privacy-request-summary.tsx";

/**
 * Revisión de solicitudes de privacidad por el Administrador (TI2-171).
 *
 * El Administrador es el responsable provisional del procedimiento: revisa,
 * resuelve con respuesta fundada, prorroga una vez y deja constancia del
 * envío. Cada acción aparece en el estado en que el contrato la admite, pero
 * la decide el Backend: si la solicitud cambió, responde `conflict` con su
 * mensaje público. Otro rol recibe la denegación genérica en la cola y en el
 * detalle, así que no ve solicitudes ajenas ni puede resolverlas.
 */

const DENIED_HINT = "Solo el responsable de privacidad revisa estas solicitudes.";

export function AdminPrivacyPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [status, setStatus] = useState<PrivacyRequestStatus | undefined>(undefined);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="admin-privacy-title" className={PAGE_CLASS}>
      <div className="flex flex-col gap-2">
        <h1
          id="admin-privacy-title"
          ref={headingRef}
          tabIndex={-1}
          className={`${PAGE_TITLE_CLASS} ${FOCUS_CLASS}`}
        >
          Solicitudes de privacidad
        </h1>
        <p className="m-0 text-base text-on-surface-variant">
          Ordenadas por vencimiento: primero las que vencen antes. El procedimiento opera con datos
          ficticios y no es una política aprobada por la UCT.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="admin-privacy-status" className="text-base font-semibold text-on-surface">
          Estado
        </label>
        <select
          id="admin-privacy-status"
          className={`${fieldClass(false)} max-w-xs`}
          value={status ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            setStatus(isPrivacyRequestStatus(value) ? value : undefined);
          }}
        >
          <option value="">Todos</option>
          {PRIVACY_REQUEST_STATUS_VALUES.map((value) => (
            <option key={value} value={value}>
              {PRIVACY_REQUEST_STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </div>
      <StudentPanelErrorBoundary
        subject="las solicitudes de privacidad"
        level="section"
        fallback={adminLoadFallback}
      >
        {/* La clave vuelve a la primera página al cambiar el filtro. */}
        <PrivacyQueue key={status ?? "all"} status={status} />
      </StudentPanelErrorBoundary>
    </section>
  );
}

function PrivacyQueue({ status }: { status: PrivacyRequestStatus | undefined }) {
  let queue: ReturnType<typeof usePrivacyRequestQueue>;
  try {
    // Hook primero y en todos los renders: el try solo clasifica el error.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    queue = usePrivacyRequestQueue(status);
  } catch (error) {
    if (isAuthorizationDenial(error)) return <DeniedState description={DENIED_HINT} />;
    throw error;
  }
  const { results, status: pageStatus, loadMore } = queue;
  const loadingMore = pageStatus === "LoadingMore";
  const canLoadMore = pageStatus === "CanLoadMore" || loadingMore;

  if (pageStatus === "LoadingFirstPage") {
    return <LoadingState label="Cargando las solicitudes…" />;
  }
  if (results.length === 0 && !canLoadMore) {
    return (
      <EmptyState title="No hay solicitudes de privacidad con este filtro.">
        <p>Las solicitudes que presenten los estudiantes aparecerán aquí.</p>
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <ul role="list" className="m-0 grid list-none gap-3 p-0">
        {results.map((request) => (
          <li key={request.id}>
            <Link
              to="/administrador/privacidad/$requestId"
              params={{ requestId: request.id }}
              className={`flex flex-col gap-1 rounded-lg border border-border-low bg-surface-container-lowest p-5 text-on-surface no-underline hover:bg-surface-container-low ${FOCUS_CLASS}`}
            >
              <span className="font-semibold">
                {PRIVACY_REQUEST_KIND_LABELS[request.kind]} ·{" "}
                {PRIVACY_REQUEST_STATUS_LABELS[request.status]}
              </span>
              <span className="text-sm text-on-surface-variant">
                Vence el{" "}
                {formatCivilDateWithYear(
                  request.extension?.extendedUntilDate ?? request.initialDueDate,
                )}
                {request.extension === undefined ? "" : " (con prórroga)"}
              </span>
              <span className="font-semibold text-primary">Revisar ›</span>
            </Link>
          </li>
        ))}
      </ul>
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
    </div>
  );
}

export function AdminPrivacyRequestDetailPage({ requestId }: { requestId: string }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="admin-privacy-detail-title" className={PAGE_CLASS}>
      <h1
        id="admin-privacy-detail-title"
        ref={headingRef}
        tabIndex={-1}
        className={`${PAGE_TITLE_CLASS} ${FOCUS_CLASS}`}
      >
        Revisar solicitud de privacidad
      </h1>
      <p className="m-0">
        <Link to="/administrador/privacidad" className={LINK_CLASS}>
          Volver a las solicitudes
        </Link>
      </p>
      <StudentPanelErrorBoundary
        subject="la solicitud de privacidad"
        level="section"
        fallback={adminLoadFallback}
      >
        <ReviewBody requestId={requestId} />
      </StudentPanelErrorBoundary>
    </section>
  );
}

function ReviewBody({ requestId }: { requestId: string }) {
  let request: PrivacyRequestView | undefined;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    request = usePrivacyRequest(requestId);
  } catch (error) {
    if (isAuthorizationDenial(error)) {
      return (
        <DeniedState
          title="No tienes acceso a esta solicitud de privacidad."
          description={DENIED_HINT}
        />
      );
    }
    throw error;
  }
  if (request === undefined) return <LoadingState label="Cargando la solicitud…" />;
  // El titular solo recibe la vista `own`: sin la vista del responsable no hay acciones.
  if (request.view !== "review") {
    return <DeniedState title="No tienes acceso a esta solicitud de privacidad." />;
  }
  return (
    <div className="flex flex-col gap-6">
      <PrivacyRequestSummary request={request} />
      <ReviewActions request={request} />
    </div>
  );
}

type ActionState = {
  readonly pending: boolean;
  readonly notice: string | null;
  readonly error: string | null;
};

/** Ejecuta una acción con un solo envío a la vez y su aviso de éxito o error. */
function useAction() {
  const [state, setState] = useState<ActionState>({ pending: false, notice: null, error: null });
  async function run(action: () => Promise<unknown>, done: string): Promise<boolean> {
    if (state.pending) return false;
    setState({ pending: true, notice: null, error: null });
    try {
      await action();
      setState({ pending: false, notice: done, error: null });
      return true;
    } catch (caught) {
      setState({ pending: false, notice: null, error: privacyActionErrorMessage(caught) });
      return false;
    }
  }
  return { ...state, run };
}

function ReviewActions({ request }: { request: Extract<PrivacyRequestView, { view: "review" }> }) {
  const action = useAction();
  const startReview = useStartPrivacyRequestReview();

  return (
    <div className="flex flex-col gap-6">
      {action.notice === null ? null : (
        <p role="status" className="m-0 font-semibold text-on-surface">
          {action.notice}
        </p>
      )}
      {action.error === null ? null : (
        <p role="alert" className="m-0 font-semibold text-error">
          {action.error}
        </p>
      )}
      {request.status === "received" ? (
        <ActionPanel title="Tomar para revisión">
          <p className="m-0 text-base text-on-surface-variant">
            Al tomarla quedas como responsable y la solicitud pasa a «En revisión».
          </p>
          <button
            type="button"
            className={`${PRIMARY_BUTTON_CLASS} w-fit`}
            disabled={action.pending}
            aria-busy={action.pending}
            onClick={() =>
              void action.run(() => startReview(request.id), "La solicitud quedó en revisión.")
            }
          >
            Tomar para revisión
          </button>
        </ActionPanel>
      ) : null}
      {request.status === "in_review" ? (
        <ResolveForm requestId={request.id} action={action} />
      ) : null}
      {request.extension === undefined && !isTerminalPrivacyRequestStatus(request.status) ? (
        <ExtendForm requestId={request.id} action={action} />
      ) : null}
      {request.status === "resolved" && request.deliveryReceipt === undefined ? (
        <DeliveryForm requestId={request.id} action={action} />
      ) : null}
    </div>
  );
}

type ActionHandle = ReturnType<typeof useAction>;

function ActionPanel({ title, children }: { title: string; children: ReactNode }) {
  const id = `admin-privacy-action-${title.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-4 rounded-lg border border-border-low bg-surface-container-lowest p-6"
    >
      <h2 id={id} className={SECTION_TITLE_CLASS}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function FieldError({ id, message }: { id: string; message: string | null }) {
  if (message === null) return null;
  return (
    <p id={id} className="m-0 font-semibold text-error">
      {message}
    </p>
  );
}

function ResolveForm({
  requestId,
  action,
}: {
  requestId: Id<"privacyRequests">;
  action: ActionHandle;
}) {
  const resolve = useResolvePrivacyRequest();
  const [outcome, setOutcome] = useState<PrivacyResponseOutcome | null>(null);
  const [reasons, setReasons] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  return (
    <ActionPanel title="Resolver">
      <p className="m-0 text-base text-on-surface-variant">
        La respuesta debe explicar la decisión en lenguaje comprensible para el titular. Una
        denegación conserva los datos.
      </p>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (outcome === null) {
            setFieldError("Elige el resultado de la respuesta.");
            return;
          }
          if (reasons.trim() === "") {
            setFieldError("Escribe el fundamento de la respuesta.");
            return;
          }
          setFieldError(null);
          void action.run(
            () => resolve({ requestId, outcome, reasons: reasons.trim() }),
            "La solicitud quedó resuelta. Registra el envío de la respuesta.",
          );
        }}
      >
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-base font-semibold text-on-surface">Resultado</legend>
          {PRIVACY_RESPONSE_OUTCOME_VALUES.map((value) => (
            <label key={value} className="flex min-h-[44px] items-center gap-3">
              <input
                type="radio"
                name="privacy-outcome"
                value={value}
                checked={outcome === value}
                onChange={() => setOutcome(value)}
                className="size-5"
              />
              {PRIVACY_RESPONSE_OUTCOME_LABELS[value]}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-col gap-2">
          <label htmlFor="privacy-reasons" className="text-base font-semibold text-on-surface">
            Fundamento
          </label>
          <textarea
            id="privacy-reasons"
            className={`${fieldClass(false)} min-h-32`}
            maxLength={PRIVACY_REQUEST_REASON_MAX_LENGTH}
            value={reasons}
            onChange={(event) => setReasons(event.target.value)}
            aria-describedby={fieldError === null ? undefined : "privacy-resolve-error"}
          />
        </div>
        <FieldError id="privacy-resolve-error" message={fieldError} />
        <button
          type="submit"
          className={`${PRIMARY_BUTTON_CLASS} w-fit`}
          disabled={action.pending}
          aria-busy={action.pending}
        >
          Resolver la solicitud
        </button>
      </form>
    </ActionPanel>
  );
}

function ExtendForm({
  requestId,
  action,
}: {
  requestId: Id<"privacyRequests">;
  action: ActionHandle;
}) {
  const extend = useExtendPrivacyRequestDeadline();
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  return (
    <ActionPanel title="Prorrogar el plazo">
      <p className="m-0 text-base text-on-surface-variant">
        {`Se admite una sola prórroga, de hasta ${PRIVACY_RESPONSE_EXTENSION_CALENDAR_DAYS} días corridos, con su motivo.`}
      </p>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number(days);
          if (days.trim() === "" || !Number.isInteger(value)) {
            setFieldError("Indica los días de prórroga como un número entero.");
            return;
          }
          if (reason.trim() === "") {
            setFieldError("Escribe el motivo de la prórroga.");
            return;
          }
          setFieldError(null);
          void action.run(
            () => extend({ requestId, days: value, reason: reason.trim() }),
            "Se aplicó la prórroga y se actualizó el plazo.",
          );
        }}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="privacy-extension-days" className="text-base font-semibold">
            Días de prórroga
          </label>
          <input
            id="privacy-extension-days"
            type="number"
            inputMode="numeric"
            min={1}
            max={PRIVACY_RESPONSE_EXTENSION_CALENDAR_DAYS}
            className={`${fieldClass(false)} max-w-40`}
            value={days}
            onChange={(event) => setDays(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="privacy-extension-reason" className="text-base font-semibold">
            Motivo
          </label>
          <textarea
            id="privacy-extension-reason"
            className={`${fieldClass(false)} min-h-24`}
            maxLength={PRIVACY_REQUEST_REASON_MAX_LENGTH}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-describedby={fieldError === null ? undefined : "privacy-extend-error"}
          />
        </div>
        <FieldError id="privacy-extend-error" message={fieldError} />
        <button
          type="submit"
          className={`${SECONDARY_BUTTON_CLASS} w-fit`}
          disabled={action.pending}
          aria-busy={action.pending}
        >
          Aplicar la prórroga
        </button>
      </form>
    </ActionPanel>
  );
}

function DeliveryForm({
  requestId,
  action,
}: {
  requestId: Id<"privacyRequests">;
  action: ActionHandle;
}) {
  const record = useRecordPrivacyResponseDelivery();
  const [channel, setChannel] = useState<PrivacyResponseDeliveryChannel>("student_app");
  const [reference, setReference] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  return (
    <ActionPanel title="Registrar el envío de la respuesta">
      <p className="m-0 text-base text-on-surface-variant">
        La constancia no se puede modificar después. Desde el envío corre el plazo del titular para
        reclamar ante la Agencia.
      </p>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (reference.trim() === "") {
            setFieldError("Escribe el folio o la referencia del envío.");
            return;
          }
          setFieldError(null);
          void action.run(
            () => record({ requestId, channel, reference: reference.trim() }),
            "Quedó registrada la constancia de envío.",
          );
        }}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="privacy-delivery-channel" className="text-base font-semibold">
            Canal
          </label>
          <select
            id="privacy-delivery-channel"
            className={`${fieldClass(false)} max-w-xs`}
            value={channel}
            onChange={(event) => {
              const value = PRIVACY_RESPONSE_DELIVERY_CHANNEL_VALUES.find(
                (option) => option === event.target.value,
              );
              if (value !== undefined) setChannel(value);
            }}
          >
            {PRIVACY_RESPONSE_DELIVERY_CHANNEL_VALUES.map((value) => (
              <option key={value} value={value}>
                {PRIVACY_RESPONSE_DELIVERY_CHANNEL_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="privacy-delivery-reference" className="text-base font-semibold">
            Folio o referencia
          </label>
          <input
            id="privacy-delivery-reference"
            className={fieldClass(false)}
            maxLength={PRIVACY_CONTROL_REFERENCE_MAX_LENGTH}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            aria-describedby="privacy-delivery-hint"
          />
          <p id="privacy-delivery-hint" className="m-0 text-sm text-on-surface-variant">
            Un identificador opaco, sin datos personales ni contenido sensible.
          </p>
        </div>
        <FieldError id="privacy-delivery-error" message={fieldError} />
        <button
          type="submit"
          className={`${PRIMARY_BUTTON_CLASS} w-fit`}
          disabled={action.pending}
          aria-busy={action.pending}
        >
          Registrar el envío
        </button>
      </form>
    </ActionPanel>
  );
}
