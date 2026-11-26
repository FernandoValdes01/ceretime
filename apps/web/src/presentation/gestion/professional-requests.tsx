import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  INITIAL_REQUEST_STATE,
  isOpenRequestState,
  isRequestState,
  findRequestTransition,
  REFERRAL_REASON_MAX_LENGTH,
  REFERRAL_UNIT_MAX_LENGTH,
  referralAllowsAccompaniment,
  REQUEST_STATES,
  type RequestState,
} from "../../../../../convex/domain/index.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import { formatAgendaShortDate } from "../shared/date-format.ts";
import { DeniedState, EmptyState, ErrorState, LoadingState } from "../shared/view-states.tsx";
import type { Id } from "../../../../../convex/_generated/dataModel";
// Reutiliza el lenguaje visual del panel (listas, fichas, botones): una sola
// fuente para no duplicar el sistema de diseño entre portales.
import "../routes/student-portal.css";
import { requestStatusLabel } from "./gestion-labels.ts";
import { DetailRow } from "./detail-row.tsx";
import {
  usePagedList,
  type RequestListItem,
  type RequestListPage,
  type RequestListSearch,
} from "./paged-requests.ts";
import {
  useAcceptRequest,
  useAuthorizedRequests,
  useCloseRequestWithoutAccompaniment,
  useOpenRequests,
  useRecordReferralAcceptance,
  useRecordReferralContact,
  useReferRequest,
  useRequestAdditionalInformation,
  useRequestDetail,
  useTakeRequest,
  type RequestDetail,
} from "./professional-requests-data.ts";
import {
  isRequestAccessDenied,
  requestActionFailureOf,
  type RequestAction,
  type RequestActionFailure,
} from "./request-review-errors.ts";

/**
 * Clases Tailwind de las filas de gestión (TI2-91, migrado de
 * professional-requests.css por TI2-130): 44px de alto táctil mínimo y foco
 * visible de 3px según DESIGN.md. El anillo usa el token --color-focus-ring
 * del tema; el resto del lenguaje (listas, fichas, botones) sigue en
 * student-portal.css hasta que su responsable lo migre.
 */
const GESTION_ROW = "flex items-center gap-2 min-h-[44px] px-3 py-2 text-inherit";
const GESTION_FOCUS_VISIBLE =
  "focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-[2px]";

/**
 * Enlaces de la gestión (retorno y registro por canal oficial): verdes y
 * subrayados como el de la agenda. El subrayado es
 * lo que lo distingue del texto normal, porque el color solo no alcanza a
 * separarlo con visión borrosa o bajo contraste. Mide lo que su contenido y
 * mantiene 44px de alto táctil mínimo.
 */
const GESTION_LINK = `flex min-h-[44px] w-fit items-center gap-1 rounded-[0.5rem] text-base font-semibold text-primary underline ${GESTION_FOCUS_VISIBLE}`;
/**
 * Campos de texto de los diálogos (TI2-92, migrado por TI2-130): el anillo de
 * foco usa la variable de compatibilidad --ct-ring (igual que antes); no se
 * cambia al token del tema para no alterar el color vigente.
 */
const GESTION_TEXTAREA =
  "w-full min-h-32 resize-y rounded-[0.5rem] border border-(--ct-line) bg-(--ct-card) px-4 py-3 text-base leading-normal text-(--ct-ink) transition-[border-color,box-shadow] duration-150 focus-visible:border-(--ct-primary) focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-(--ct-ring) focus-visible:outline-offset-[2px]";
const GESTION_TEXTAREA_ERROR =
  "border-(--ct-danger) focus-visible:shadow-[0_0_0_3px_var(--ct-danger-bg)]";
/** Selector del filtro: 44px de alto táctil, etiqueta visible y foco de 3px. */
const GESTION_SELECT = `min-h-[44px] rounded-[0.5rem] border border-(--ct-line) bg-(--ct-card) px-3 text-base text-(--ct-ink) ${GESTION_FOCUS_VISIBLE}`;
const GESTION_BUTTON_DISABLED = "disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Bandeja y tomadas del Profesional (TI2-91, TI2-157).
 *
 * Lee solo queries públicas ya existentes; la autorización vive en Convex.
 * La bandeja trae filas minimizadas (sin `accessNeeds` por diseño) y el
 * detalle completo solo llega vía `getRequest`, que el Backend deniega sin
 * toma activa. «Mis tomadas» muestra todos los estados y se filtra por
 * estado con `?estado=`, que el detalle conserva para volver al mismo filtro.
 */
export function ProfessionalRequestsPage({ search }: { search: RequestListSearch }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="professional-requests-title">
      <h1 id="professional-requests-title" ref={headingRef} tabIndex={-1}>
        Solicitudes
      </h1>
      <p>
        <Link to="/profesional/solicitudes/registrar" className={GESTION_LINK}>
          Registrar solicitud por canal oficial
        </Link>
      </p>
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
        <StatusFilter selected={search.estado} />
        <StudentPanelErrorBoundary subject="tus solicitudes tomadas" level="section">
          <AuthorizedRequestsBody search={search} />
        </StudentPanelErrorBoundary>
      </section>
    </section>
  );
}

/**
 * Filtro por estado de «Mis tomadas» (TI2-157). Vive en la URL: reemplaza la
 * entrada del historial para que «Atrás» no recorra cada cambio de filtro.
 */
function StatusFilter({ selected }: { selected: RequestState | undefined }) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="authorized-status-filter" className="font-semibold">
        Filtrar por estado
      </label>
      <select
        id="authorized-status-filter"
        className={GESTION_SELECT}
        value={selected ?? ""}
        onChange={(event) => {
          const value = event.target.value;
          void navigate({
            to: "/profesional/solicitudes",
            search: isRequestState(value) ? { estado: value } : {},
            replace: true,
          });
        }}
      >
        <option value="">Todos los estados</option>
        {REQUEST_STATES.map((state) => (
          <option key={state} value={state}>
            {requestStatusLabel(state)}
          </option>
        ))}
      </select>
    </div>
  );
}

function RequestRow({
  request,
  listSearch,
  take,
}: {
  request: RequestListItem;
  /** Solo tomadas: el detalle recibe el filtro vigente para volver con él. */
  listSearch?: RequestListSearch;
  /** Solo bandeja: tomar sin pasar por el detalle (denegado sin toma). */
  take?: { disabled: boolean; busy: boolean; onTake: () => void };
}) {
  // Cada «Tomar» de la bandeja nombra su fila para el lector de pantalla.
  const rowId = useId();
  const content = (
    <>
      <span className="student-portal__chip">{requestStatusLabel(request.status)}</span>
      <span className="student-portal__item-meta">
        Registrada el {formatAgendaShortDate(request.createdAt)}
      </span>
    </>
  );

  if (listSearch === undefined) {
    return (
      <li className="student-portal__item">
        <span id={rowId} className={GESTION_ROW}>
          {content}
        </span>
        {take && (
          <button
            type="button"
            className={`student-portal__btn student-portal__btn--ghost ${GESTION_BUTTON_DISABLED}`}
            disabled={take.disabled || take.busy}
            onClick={take.onTake}
            aria-busy={take.busy}
            aria-describedby={rowId}
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
        search={listSearch}
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
 * Filas repetidas: los cursores son posiciones fijas y un corrimiento por
 * cambios concurrentes puede repetir una fila en dos páginas; cada página
 * omite los IDs que ya mostraron las anteriores (registro idsByCursor del
 * hook). Se exporta para probar la lectura reactiva por página de forma aislada.
 *
 * `status` (TI2-157) muestra solo las filas en ese estado y reporta solo sus
 * IDs: así el vacío y las filas omitidas hablan de lo que se ve.
 */
export function PagedItems<Item extends RequestListItem>({
  cursors,
  usePage,
  renderItem,
  onIds,
  idsByCursor,
  status,
}: {
  cursors: ReadonlyArray<string | null>;
  usePage: (cursor: string | null) => RequestListPage<Item> | undefined;
  renderItem: (item: Item) => ReactNode;
  onIds: (cursor: string | null, ids: ReadonlyArray<string> | undefined) => void;
  idsByCursor: ReadonlyMap<string, ReadonlyArray<string> | undefined>;
  status?: string;
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
            status={status}
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
  status,
}: {
  cursor: string | null;
  usePage: (cursor: string | null) => RequestListPage<Item> | undefined;
  renderItem: (item: Item) => ReactNode;
  onIds: (cursor: string | null, ids: ReadonlyArray<string> | undefined) => void;
  exclude: ReadonlySet<string>;
  status: string | undefined;
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
    onIds(
      cursor,
      page === undefined
        ? undefined
        : page.page
            .filter((item) => status === undefined || item.status === status)
            .map((item) => item._id),
    );
  }, [cursor, page, onIds, status]);
  if (page === undefined) {
    return null;
  }
  return (
    <>
      {page.page
        .filter((item) => status === undefined || item.status === status)
        .filter((item) => !exclude.has(item._id))
        .map((item) => renderItem(item))}
    </>
  );
}

/** Botón «Cargar más» de una lista paginada, con anuncio de la carga. */
function LoadMore({ pending, onLoadMore }: { pending: boolean; onLoadMore: () => void }) {
  return (
    <div className="student-portal__cta">
      <button
        type="button"
        className="student-portal__btn student-portal__btn--primary"
        disabled={pending}
        onClick={onLoadMore}
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
  );
}

/**
 * Aviso de una acción fallida (TI2-157): la denegación usa el estado común de
 * acceso denegado; el resto, el mensaje comprensible ya traducido.
 */
function ActionFailureNotice({ failure }: { failure: RequestActionFailure }) {
  return failure.status === "denied" ? <DeniedState /> : <ErrorState message={failure.message} />;
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
  const takeRequest = useTakeRequest();
  const [takingId, setTakingId] = useState<string | null>(null);
  const [takeFailure, setTakeFailure] = useState<RequestActionFailure | null>(null);

  // La toma vive en la bandeja porque el detalle exige toma activa
  // (getRequest deniega sin ella): sin este botón la acción sería inalcanzable.
  async function handleTake(requestId: string) {
    if (takingId !== null) {
      return;
    }
    setTakeFailure(null);
    setTakingId(requestId);
    try {
      await takeRequest({ requestId: requestId as Id<"requests"> });
      // Las queries reactivas mueven la solicitud a "Mis tomadas" solas.
    } catch (error) {
      setTakeFailure(requestActionFailureOf(error, "take"));
    } finally {
      setTakingId(null);
    }
  }

  if (firstPage === undefined) {
    return <LoadingState label="Cargando la bandeja…" />;
  }

  return (
    <>
      {takeFailure && <ActionFailureNotice failure={takeFailure} />}
      {!hasItems && allReported && tailDone ? (
        <EmptyState title="No hay solicitudes por revisar.">
          <p>Cuando un estudiante registre una solicitud, aparecerá aquí.</p>
        </EmptyState>
      ) : null}
      <ul className="student-portal__list">
        <PagedItems
          cursors={cursors}
          usePage={useOpenRequests}
          renderItem={(request) => (
            <RequestRow
              key={request._id}
              request={request}
              take={{
                disabled: takingId !== null,
                busy: takingId === request._id,
                onTake: () => handleTake(request._id),
              }}
            />
          )}
          onIds={reportIds}
          idsByCursor={idsByCursor}
        />
      </ul>
      {tailDone ? null : <LoadMore pending={tailPending} onLoadMore={loadMore} />}
    </>
  );
}

function AuthorizedRequestsBody({ search }: { search: RequestListSearch }) {
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
  const { estado } = search;

  if (firstPage === undefined) {
    return <LoadingState label="Cargando tus tomadas…" />;
  }

  const noVisibleRows = !hasItems && allReported;

  return (
    <>
      {noVisibleRows && tailDone && estado === undefined ? (
        <EmptyState title="No tienes solicitudes tomadas.">
          <p>Las solicitudes que tomes para revisión aparecerán aquí.</p>
        </EmptyState>
      ) : null}
      {noVisibleRows && tailDone && estado !== undefined ? (
        <EmptyState
          title={`No tienes solicitudes tomadas en estado «${requestStatusLabel(estado)}».`}
        >
          <p>Elige «Todos los estados» en el filtro para ver el resto.</p>
        </EmptyState>
      ) : null}
      {noVisibleRows && !tailDone && estado !== undefined ? (
        <EmptyState
          title={`Ninguna de las solicitudes cargadas está en estado «${requestStatusLabel(estado)}».`}
        >
          <p>Carga más solicitudes para seguir buscando.</p>
        </EmptyState>
      ) : null}
      <ul className="student-portal__list">
        <PagedItems
          cursors={cursors}
          usePage={useAuthorizedRequests}
          renderItem={(request) => (
            <RequestRow key={request._id} request={request} listSearch={search} />
          )}
          onIds={reportIds}
          idsByCursor={idsByCursor}
          status={estado}
        />
      </ul>
      {tailDone ? null : <LoadMore pending={tailPending} onLoadMore={loadMore} />}
    </>
  );
}

/**
 * Detalle de una solicitud tomada (TI2-91, TI2-157).
 *
 * La fila completa —incluidas las necesidades de acceso— solo llega por
 * `getRequest`, que el Backend deniega sin toma activa y sin filtrar
 * existencia. La denegación muestra el estado común de acceso denegado; los
 * demás fallos de lectura van al límite, que ofrece reintento. El enlace de
 * retorno conserva el filtro con el que se llegó.
 */
export function ProfessionalRequestDetailPage({
  requestId,
  listSearch,
}: {
  requestId: string;
  listSearch: RequestListSearch;
}) {
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
        <Link to="/profesional/solicitudes" search={listSearch} className={GESTION_LINK}>
          <span aria-hidden="true">←</span> Volver a solicitudes
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
  let request: RequestDetail | undefined;
  try {
    // El hook se invoca primero y en todos los renders: el orden es estable
    // y el try solo clasifica el error ya lanzado, no condiciona la llamada.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    request = useRequestDetail(requestId);
  } catch (error) {
    if (isRequestAccessDenied(error)) {
      return <DeniedState />;
    }
    throw error;
  }

  if (request === undefined) {
    return <LoadingState label="Cargando el detalle…" />;
  }

  return <RequestDetailView request={request} />;
}

/**
 * Acciones del Profesional sobre una solicitud tomada (TI2-92, TI2-157, TI2-158).
 *
 * Cada acción declara el estado al que lleva y se ofrece solo si la tabla
 * canónica de transiciones del Dominio la admite desde el estado vigente:
 * la Web no copia reglas. Tomar sale solo del estado inicial, porque volver a
 * revisión desde la espera es la respuesta del Estudiante. Quién puede
 * intentar cada paso y sus demás condiciones las sigue exigiendo el Backend.
 */
const REVIEW_ACTIONS: ReadonlyArray<{
  readonly action: RequestAction;
  readonly to: RequestState;
  readonly from?: RequestState;
}> = [
  { action: "take", to: "under_review", from: INITIAL_REQUEST_STATE },
  { action: "accept", to: "accepted" },
  { action: "requestInformation", to: "awaiting_information_or_acceptance" },
  { action: "close", to: "closed_without_accompaniment" },
  { action: "refer", to: "referred" },
];

function availableActions(status: string): ReadonlySet<RequestAction> {
  return new Set(
    REVIEW_ACTIONS.filter(
      ({ to, from }) =>
        (from === undefined || from === status) &&
        isRequestState(status) &&
        findRequestTransition(status, to) !== undefined,
    ).map(({ action }) => action),
  );
}

/**
 * Quién resolvió (TI2-157). El detalle solo llega con toma activa y cada
 * solicitud se toma una sola vez, así que quien lo lee es el Profesional a
 * cargo; la cancelación es siempre del Estudiante.
 */
function responsibleRow(status: string): { term: string; value: string } {
  if (status === "cancelled") {
    return { term: "Resuelta por", value: "El estudiante, al cancelarla" };
  }
  if (!isOpenRequestState(status)) {
    return { term: "Resuelta por", value: "Tú, como profesional a cargo" };
  }
  return { term: "A cargo de", value: "Tú, como profesional que la tomó" };
}

/** Procedencia legible (TI2-158); una solicitud anterior sin dato no muestra fila. */
function provenanceLabel(channel: RequestDetail["provenanceChannel"]): string | null {
  switch (channel) {
    case "official_channel":
      return "Registrada por CERETI desde un canal oficial";
    case "student":
      return "Enviada por el estudiante";
    default:
      return null;
  }
}

/** Fecha registrada de un paso de la derivación de entrada, o «Pendiente». */
function referralStepLabel(at: number | undefined): string {
  return at === undefined ? "Pendiente" : `Registrado el ${formatAgendaShortDate(at)}`;
}

type OpenDialog = "requestInformation" | "accept" | "close" | "refer";
type InlineAction = "take" | "recordReferralContact" | "recordReferralAcceptance";

function RequestDetailView({ request }: { request: RequestDetail }) {
  const requestId = request._id;
  const takeRequest = useTakeRequest();
  const requestAdditionalInformation = useRequestAdditionalInformation();
  const acceptRequest = useAcceptRequest();
  const closeRequest = useCloseRequestWithoutAccompaniment();
  const recordReferralContact = useRecordReferralContact();
  const recordReferralAcceptance = useRecordReferralAcceptance();
  const referRequest = useReferRequest();

  // Acciones sin diálogo (tomar y los pasos de la derivación de entrada).
  const [inlineFailure, setInlineFailure] = useState<RequestActionFailure | null>(null);
  const [inlinePending, setInlinePending] = useState<InlineAction | null>(null);
  const [openDialog, setOpenDialog] = useState<OpenDialog | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  // Botón que abrió el diálogo: recibe el foco al cancelar.
  const openerRef = useRef<HTMLButtonElement | null>(null);
  // El estado es lo único estable del detalle ante cualquier transición.
  const statusRef = useRef<HTMLElement>(null);

  // Foco al cerrar un diálogo (TI2-92): tras un éxito va al estado, porque el
  // éxito cambia el estado y el botón que lo abrió puede desmontarse en
  // cualquier momento después; al cancelar vuelve al botón que lo abrió, y si
  // ya no está, al estado. Se resuelve en efecto tras el commit: focus()
  // sobre un botón deshabilitado no hace nada.
  const prevOpenDialog = useRef(openDialog);
  const focusStatusOnClose = useRef(false);
  useEffect(() => {
    if (openDialog === null && prevOpenDialog.current !== null) {
      const opener = openerRef.current;
      if (!focusStatusOnClose.current && opener !== null && opener.isConnected) {
        opener.focus();
      } else {
        statusRef.current?.focus();
      }
      focusStatusOnClose.current = false;
    }
    prevOpenDialog.current = openDialog;
  }, [openDialog]);

  const actions = availableActions(request.status);
  const responsible = responsibleRow(request.status);
  const provenance = provenanceLabel(request.provenanceChannel);
  const incomingReferral = request.incomingReferral;
  const outgoingReferral = request.outgoingReferral;
  // Una derivación de entrada no abre acompañamiento sin el contacto y la
  // aceptación del estudiante (regla del Dominio): sin ellos no se ofrece.
  const acceptanceAllowed = referralAllowsAccompaniment(incomingReferral);
  // Los dos registros caben mientras la solicitud todavía puede aceptarse.
  const referralStepsOpen = incomingReferral !== undefined && actions.has("accept");
  const canRecordContact = referralStepsOpen && incomingReferral.contactedAt === undefined;
  const canRecordAcceptance =
    referralStepsOpen &&
    incomingReferral.contactedAt !== undefined &&
    incomingReferral.acceptedAt === undefined;

  // La query reactiva (useRequestDetail) trae el estado nuevo tras cada éxito.
  async function runInline(action: InlineAction, run: () => Promise<unknown>, success?: string) {
    if (inlinePending !== null) return;
    setInlineFailure(null);
    setSuccessNotice(null);
    setInlinePending(action);
    try {
      await run();
      if (success !== undefined) {
        setSuccessNotice(success);
        // El botón usado desaparece con el éxito: el foco pasa al estado.
        statusRef.current?.focus();
      }
    } catch (error) {
      setInlineFailure(requestActionFailureOf(error, action));
    } finally {
      setInlinePending(null);
    }
  }

  function handleOpen(event: React.MouseEvent<HTMLButtonElement>, dialog: OpenDialog) {
    openerRef.current = event.currentTarget;
    setSuccessNotice(null);
    setOpenDialog(dialog);
  }

  function closeDialog(success: string | null) {
    focusStatusOnClose.current = success !== null;
    setSuccessNotice(success);
    setOpenDialog(null);
  }

  // Ejecuta la mutación y traduce el fallo; `null` es éxito.
  async function attempt(
    action: RequestAction,
    run: () => Promise<unknown>,
  ): Promise<RequestActionFailure | null> {
    try {
      await run();
      return null;
    } catch (error) {
      return requestActionFailureOf(error, action);
    }
  }

  const dialogBusy = openDialog !== null;

  // `#root` centra el texto de toda la Web: el detalle se alinea a la
  // izquierda como el del acompañamiento.
  return (
    <div className="text-left">
      <dl className="m-0 divide-y divide-(--ct-line)">
        <DetailRow label="Estado" valueRef={statusRef}>
          {requestStatusLabel(request.status)}
        </DetailRow>
        <DetailRow label={responsible.term}>{responsible.value}</DetailRow>
        <DetailRow label="Registrada">{formatAgendaShortDate(request.createdAt)}</DetailRow>
        <DetailRow label="Necesidades de acceso">{request.accessNeeds}</DetailRow>
        {request.informationRequest === undefined ? null : (
          <DetailRow label="Información pedida al estudiante">
            {request.informationRequest}
          </DetailRow>
        )}
        {request.informationResponse === undefined ? null : (
          <DetailRow label="Respuesta del estudiante">{request.informationResponse}</DetailRow>
        )}
        {request.closureReason === undefined ? null : (
          <DetailRow label="Razón del cierre">{request.closureReason}</DetailRow>
        )}
        {outgoingReferral === undefined ? null : (
          <>
            <DetailRow label="Derivada a">
              {outgoingReferral.destinationUnit}, el{" "}
              {formatAgendaShortDate(outgoingReferral.referredAt)}
            </DetailRow>
            <DetailRow label="Razón de la derivación">{outgoingReferral.reason}</DetailRow>
          </>
        )}
        {provenance === null ? null : <DetailRow label="Procedencia">{provenance}</DetailRow>}
        {request.accompanimentId === undefined ? null : (
          <DetailRow label="Acompañamiento">Abierto a partir de esta solicitud</DetailRow>
        )}
      </dl>

      {successNotice === null ? null : (
        <p role="status" className="student-portal__hint">
          {successNotice}
        </p>
      )}

      {incomingReferral === undefined ? null : (
        <section aria-labelledby="incoming-referral-title" className="student-portal__section">
          <h2 id="incoming-referral-title">Derivación de entrada</h2>
          <dl className="m-0 divide-y divide-(--ct-line)">
            <DetailRow label="Unidad que derivó">
              {incomingReferral.originUnit}, el {formatAgendaShortDate(incomingReferral.referredAt)}
            </DetailRow>
            <DetailRow label="Contacto con el estudiante">
              {referralStepLabel(incomingReferral.contactedAt)}
            </DetailRow>
            <DetailRow label="Aceptación del estudiante">
              {referralStepLabel(incomingReferral.acceptedAt)}
            </DetailRow>
          </dl>
          {referralStepsOpen && !acceptanceAllowed ? (
            <p className="student-portal__hint">
              Para abrir el acompañamiento, registra primero el contacto con el estudiante y luego
              su aceptación. Ambos ocurren fuera de la aplicación; aquí solo quedan registrados.
            </p>
          ) : null}
          {canRecordContact || canRecordAcceptance ? (
            <div className="student-portal__cta flex flex-wrap gap-3">
              {canRecordContact && (
                <button
                  type="button"
                  className={`student-portal__btn student-portal__btn--primary ${GESTION_BUTTON_DISABLED}`}
                  disabled={inlinePending !== null || dialogBusy}
                  aria-busy={inlinePending === "recordReferralContact"}
                  onClick={() =>
                    runInline(
                      "recordReferralContact",
                      () => recordReferralContact({ requestId }),
                      "Registraste el contacto con el estudiante.",
                    )
                  }
                >
                  {inlinePending === "recordReferralContact"
                    ? "Registrando…"
                    : "Registrar contacto con el estudiante"}
                </button>
              )}
              {canRecordAcceptance && (
                <button
                  type="button"
                  className={`student-portal__btn student-portal__btn--primary ${GESTION_BUTTON_DISABLED}`}
                  disabled={inlinePending !== null || dialogBusy}
                  aria-busy={inlinePending === "recordReferralAcceptance"}
                  onClick={() =>
                    runInline(
                      "recordReferralAcceptance",
                      () => recordReferralAcceptance({ requestId }),
                      "Registraste la aceptación del estudiante. Ya puedes abrir el acompañamiento.",
                    )
                  }
                >
                  {inlinePending === "recordReferralAcceptance"
                    ? "Registrando…"
                    : "Registrar aceptación del estudiante"}
                </button>
              )}
            </div>
          ) : null}
        </section>
      )}

      {inlineFailure && <ActionFailureNotice failure={inlineFailure} />}

      {actions.size === 0 ? null : (
        <div className="student-portal__cta flex flex-wrap gap-3">
          {actions.has("take") && (
            <button
              type="button"
              className={`student-portal__btn student-portal__btn--primary ${GESTION_BUTTON_DISABLED}`}
              disabled={inlinePending !== null}
              onClick={() => runInline("take", () => takeRequest({ requestId }))}
              aria-busy={inlinePending === "take"}
            >
              {inlinePending === "take" ? "Tomando…" : "Tomar solicitud"}
            </button>
          )}
          {actions.has("accept") && acceptanceAllowed && (
            <button
              type="button"
              className={`student-portal__btn student-portal__btn--primary ${GESTION_BUTTON_DISABLED}`}
              disabled={dialogBusy}
              onClick={(event) => handleOpen(event, "accept")}
              aria-haspopup="dialog"
            >
              Aceptar y abrir acompañamiento
            </button>
          )}
          {actions.has("requestInformation") && (
            <button
              type="button"
              className={`student-portal__btn student-portal__btn--ghost ${GESTION_BUTTON_DISABLED}`}
              disabled={dialogBusy}
              onClick={(event) => handleOpen(event, "requestInformation")}
              aria-haspopup="dialog"
            >
              Pedir información
            </button>
          )}
          {actions.has("close") && (
            <button
              type="button"
              className={`student-portal__btn student-portal__btn--ghost ${GESTION_BUTTON_DISABLED}`}
              disabled={dialogBusy}
              onClick={(event) => handleOpen(event, "close")}
              aria-haspopup="dialog"
            >
              Cerrar sin acompañamiento
            </button>
          )}
          {actions.has("refer") && (
            <button
              type="button"
              className={`student-portal__btn student-portal__btn--ghost ${GESTION_BUTTON_DISABLED}`}
              disabled={dialogBusy}
              onClick={(event) => handleOpen(event, "refer")}
              aria-haspopup="dialog"
            >
              Derivar a otra unidad
            </button>
          )}
        </div>
      )}

      {openDialog === "requestInformation" && (
        <ReviewTextDialog
          id="info"
          title="Pedir información adicional"
          description="El estudiante recibirá este motivo para completar su solicitud."
          fieldLabel="Motivo"
          requiredMessage="Escribe el motivo."
          submitLabel="Enviar"
          onCancel={() => closeDialog(null)}
          onSubmit={async (reason) => {
            const failure = await attempt("requestInformation", () =>
              requestAdditionalInformation({ requestId, reason }),
            );
            if (failure === null) {
              closeDialog("Pediste información al estudiante.");
            }
            return failure;
          }}
        />
      )}

      {openDialog === "accept" && (
        <ReviewTextDialog
          id="accept"
          title="Aceptar y abrir acompañamiento"
          description="Al aceptar se abre un único acompañamiento para el estudiante."
          fieldLabel="Objetivo del acompañamiento"
          requiredMessage="Escribe el objetivo del acompañamiento."
          submitLabel="Aceptar"
          onCancel={() => closeDialog(null)}
          onSubmit={async (objective) => {
            const failure = await attempt("accept", () => acceptRequest({ requestId, objective }));
            if (failure === null) {
              closeDialog("Aceptaste la solicitud y se abrió su acompañamiento.");
            }
            return failure;
          }}
        >
          <dl className="mb-6">
            <div className="mb-3">
              <dt className="text-sm font-semibold text-(--ct-ink)">
                Necesidades que pasan al acompañamiento
              </dt>
              <dd className="m-0 whitespace-pre-line text-(--ct-ink)">{request.accessNeeds}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-(--ct-ink)">Profesional asignado</dt>
              <dd className="m-0 text-(--ct-ink)">Tú, como profesional responsable</dd>
            </div>
          </dl>
        </ReviewTextDialog>
      )}

      {openDialog === "close" && (
        <ReviewTextDialog
          id="close"
          title="Cerrar sin acompañamiento"
          description="El estudiante leerá esta razón. No incluyas diagnósticos ni etiquetas clínicas."
          fieldLabel="Razón del cierre"
          requiredMessage="Escribe la razón del cierre."
          submitLabel="Cerrar solicitud"
          onCancel={() => closeDialog(null)}
          onSubmit={async (reason) => {
            const failure = await attempt("close", () => closeRequest({ requestId, reason }));
            if (failure === null) {
              closeDialog("Cerraste la solicitud sin acompañamiento.");
            }
            return failure;
          }}
        />
      )}

      {openDialog === "refer" && (
        <ReviewTextDialog
          id="refer"
          title="Derivar a otra unidad"
          description="La comunicación con la unidad de destino ocurre fuera de la aplicación: aquí no se eligen destinatarios ni se envían antecedentes. El estudiante leerá la unidad y la razón, y la solicitud queda Derivada, sin acompañamiento."
          unitField={{
            label: "Unidad de destino",
            hint: "Nombre de la unidad de la Universidad a la que derivas al estudiante.",
            requiredMessage: "Indica la unidad de destino.",
          }}
          fieldLabel="Razón de la derivación"
          requiredMessage="Escribe la razón de la derivación."
          maxLength={{
            value: REFERRAL_REASON_MAX_LENGTH,
            message: `La razón no puede exceder ${REFERRAL_REASON_MAX_LENGTH} caracteres.`,
          }}
          submitLabel="Derivar"
          onCancel={() => closeDialog(null)}
          onSubmit={async (reason, destinationUnit = "") => {
            const failure = await attempt("refer", () =>
              referRequest({ requestId, destinationUnit, reason }),
            );
            if (failure === null) {
              closeDialog(
                "Derivaste la solicitud. Comunícate con la unidad de destino por el canal oficial.",
              );
            }
            return failure;
          }}
        />
      )}
    </div>
  );
}

/** Marca visible de campo obligatorio, igual que en el registro por canal oficial. */
function RequiredMark() {
  return <span className="font-normal text-(--ct-muted)">(obligatorio)</span>;
}

/**
 * Diálogo con un texto obligatorio (TI2-92, generalizado en TI2-157 para
 * pedir información, aceptar y cerrar). TI2-158 suma `unitField`, un nombre
 * de unidad obligatorio antes del texto, para la derivación de salida.
 *
 * Al abrir, el foco va al campo; Tab queda atrapado y Escape cancela. El
 * error del envío vive dentro del diálogo: con `aria-modal` el lector no
 * percibe lo que queda detrás. Un segundo envío mientras el primero sigue en
 * curso se ignora, así una aceptación no se repite por doble clic.
 */
function ReviewTextDialog({
  id,
  title,
  description,
  fieldLabel,
  requiredMessage,
  maxLength,
  submitLabel,
  onCancel,
  onSubmit,
  unitField,
  children,
}: {
  id: string;
  title: string;
  description: string;
  fieldLabel: string;
  requiredMessage: string;
  /**
   * Solo cuando el Backend fija un largo máximo para el texto: la Web no
   * inventa topes que el contrato no tiene.
   */
  maxLength?: { readonly value: number; readonly message: string };
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (text: string, unit?: string) => Promise<RequestActionFailure | null>;
  unitField?: { label: string; hint: string; requiredMessage: string };
  children?: ReactNode;
}) {
  const [text, setText] = useState("");
  const [unit, setUnit] = useState("");
  const [unitError, setUnitError] = useState<string | null>(null);
  const unitRef = useRef<HTMLInputElement>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitFailure, setSubmitFailure] = useState<RequestActionFailure | null>(null);
  const [pending, setPending] = useState(false);
  // Guarda inmediata: el estado `pending` aún no se ve en un segundo clic seguido.
  const pendingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const titleId = `${id}-modal-title`;
  const fieldId = `${id}-text`;
  const errorId = `${id}-text-error`;
  const hintId = `${id}-text-hint`;
  const describedBy =
    [fieldError ? errorId : null, maxLength === undefined ? null : hintId]
      .filter((value) => value !== null)
      .join(" ") || undefined;

  const unitId = `${id}-unit`;
  const unitErrorId = `${id}-unit-error`;
  const unitHintId = `${id}-unit-hint`;
  const hasUnitField = unitField !== undefined;

  // El foco va al primer campo del diálogo.
  useEffect(() => {
    (hasUnitField ? unitRef.current : fieldRef.current)?.focus();
  }, [hasUnitField]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!pendingRef.current) onCancel();
      return;
    }
    if (event.key !== "Tab" || dialogRef.current === null) {
      return;
    }
    const focusableElements = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusableElements.length === 0) {
      return;
    }
    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pendingRef.current) return;

    const trimmedUnit = unit.trim();
    const nextUnitError = hasUnitField && !trimmedUnit ? unitField.requiredMessage : null;
    const trimmed = text.trim();
    const nextFieldError = !trimmed
      ? requiredMessage
      : maxLength !== undefined && trimmed.length > maxLength.value
        ? maxLength.message
        : null;
    setUnitError(nextUnitError);
    setFieldError(nextFieldError);
    if (nextUnitError !== null) {
      unitRef.current?.focus();
      return;
    }
    if (nextFieldError !== null) {
      fieldRef.current?.focus();
      return;
    }

    setSubmitFailure(null);
    pendingRef.current = true;
    setPending(true);
    const failure = await onSubmit(trimmed, hasUnitField ? trimmedUnit : undefined);
    pendingRef.current = false;
    // Con éxito el diálogo ya se cerró: no queda estado que actualizar.
    if (failure !== null) {
      setPending(false);
      setSubmitFailure(failure);
    }
  }

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={handleKeyDown}
    >
      <div className="max-h-full w-full max-w-[32rem] overflow-y-auto rounded-lg border border-(--ct-line) bg-(--ct-card) p-6 text-left shadow-[0_4px_12px_rgb(0_0_0/0.05)]">
        <h2 id={titleId} className="mb-2 text-xl font-semibold text-(--ct-ink)">
          {title}
        </h2>
        <p className="mb-6! text-base leading-normal text-(--ct-muted)">{description}</p>
        {children}
        <form onSubmit={handleSubmit} noValidate>
          {unitField === undefined ? null : (
            <div className="mb-6">
              <label htmlFor={unitId} className="mb-2 block text-sm font-semibold text-(--ct-ink)">
                {unitField.label} <RequiredMark />
              </label>
              <p id={unitHintId} className="student-portal__hint mb-2!">
                {unitField.hint}
              </p>
              <input
                id={unitId}
                ref={unitRef}
                type="text"
                className={`${GESTION_TEXTAREA} min-h-[44px] ${unitError ? GESTION_TEXTAREA_ERROR : ""}`}
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                maxLength={REFERRAL_UNIT_MAX_LENGTH}
                aria-required="true"
                aria-describedby={unitError ? `${unitErrorId} ${unitHintId}` : unitHintId}
                aria-invalid={unitError ? "true" : "false"}
                disabled={pending}
              />
              {unitError && (
                <p
                  id={unitErrorId}
                  className="mt-2! text-sm font-semibold text-(--ct-danger)"
                  role="alert"
                >
                  {unitError}
                </p>
              )}
            </div>
          )}
          <div className="mb-6">
            <label htmlFor={fieldId} className="mb-2 block text-sm font-semibold text-(--ct-ink)">
              {fieldLabel} <RequiredMark />
            </label>
            <textarea
              id={fieldId}
              ref={fieldRef}
              className={`${GESTION_TEXTAREA} ${fieldError ? GESTION_TEXTAREA_ERROR : ""}`}
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={maxLength?.value}
              rows={4}
              aria-required="true"
              aria-describedby={describedBy}
              aria-invalid={fieldError ? "true" : "false"}
              disabled={pending}
            />
            {fieldError && (
              <p
                id={errorId}
                className="mt-2! text-sm font-semibold text-(--ct-danger)"
                role="alert"
              >
                {fieldError}
              </p>
            )}
            {maxLength === undefined ? null : (
              <p id={hintId} className="student-portal__hint mt-2!">
                Máximo {maxLength.value} caracteres ({text.length}/{maxLength.value})
              </p>
            )}
          </div>
          {submitFailure && <ActionFailureNotice failure={submitFailure} />}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              className={`student-portal__btn student-portal__btn--ghost ${GESTION_BUTTON_DISABLED}`}
              onClick={onCancel}
              disabled={pending}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={`student-portal__btn student-portal__btn--primary ${GESTION_BUTTON_DISABLED}`}
              disabled={pending}
              aria-busy={pending}
            >
              {pending ? "Enviando…" : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
