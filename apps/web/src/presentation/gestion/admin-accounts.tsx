import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ConvexError } from "convex/values";
import { UNAUTHORIZED_ERROR_MESSAGE } from "../../../../../convex/domain/index.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import "../routes/student-portal.css";
import { publicErrorOf } from "../../infrastructure/convex/public-error.ts";
import {
  canEnableStaffAccount,
  canRevokeStaffAccount,
  staffAccountStatusLabel,
  staffInstitutionalStatusLabel,
  staffRoleLabel,
  useEnableStaffAccount,
  useRevokeStaffAccount,
  useStaffAccounts,
  type StaffAccountItem,
  type StaffAccountsPage,
  type StaffAccountsRole,
} from "./admin-accounts-data.ts";
import {
  ACCESS_DENIED_MESSAGE,
  DeniedState,
  EmptyState,
  LoadingState,
} from "../shared/view-states.tsx";

/**
 * Cuentas de personal para Administración (TI2-169).
 *
 * Lista paginada por rol (profesional y administración) con habilitación y
 * revocación contra la API real de TI2-137. La autorización vive en Convex:
 * sin permiso la lectura muestra acceso denegado y cada acción denegada
 * avisa sin revelar motivo. Habilitar permite operar según el rol y jamás
 * concede acompañamientos ni notas internas.
 *
 * Diseño propio de Web (listas de gestión con filas de texto y acciones),
 * distinto de las tarjetas con avatar de Mobile: misma información, otro
 * lenguaje visual.
 */

const GESTION_ROW = "flex flex-wrap items-center gap-2 min-h-[44px] min-w-0 px-3 py-2 text-inherit";
const GESTION_FOCUS_VISIBLE =
  "focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-[2px]";

/**
 * El valor canónico viaja en `error.data`: el SDK decora `error.message` con
 * su contexto, así que comparar el mensaje falla contra el Backend real.
 */
function isAuthorizationDenial(error: unknown): boolean {
  return error instanceof ConvexError && error.data === UNAUTHORIZED_ERROR_MESSAGE;
}

const ACCOUNTS_DENIED_HINT =
  "Si crees que deberías verlas, pide acceso por el canal oficial si corresponde.";

export function AdminAccountsPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="admin-accounts-title">
      <h1 id="admin-accounts-title" ref={headingRef} tabIndex={-1}>
        Cuentas de personal
      </h1>
      <p>
        Consulta, habilita y revoca cuentas profesionales y administrativas. Los cambios se guardan
        en el sistema y persisten al recargar.
      </p>
      <p className="student-portal__item-meta">
        Habilitar una cuenta permite operar según su rol. No concede acceso a acompañamientos ni a
        notas internas.
      </p>
      <StudentPanelErrorBoundary subject="las cuentas de personal" level="section">
        <StaffAccountsSection role="professional" />
      </StudentPanelErrorBoundary>
      <StudentPanelErrorBoundary subject="las cuentas de administración" level="section">
        <StaffAccountsSection role="admin" />
      </StudentPanelErrorBoundary>
    </section>
  );
}

/** Estado de la última página encadenada: decide el botón "Cargar más". */
type TailState = { readonly pending: boolean; readonly hasMore: boolean };

function StaffAccountsSection({ role }: { role: StaffAccountsRole }) {
  const [pageCount, setPageCount] = useState(1);
  const [tail, setTail] = useState<TailState>({ pending: false, hasMore: false });
  const listRef = useRef<HTMLUListElement>(null);
  const rowsBeforeLoad = useRef<number | null>(null);
  const title = role === "professional" ? "Cuentas profesionales" : "Cuentas administrativas";
  const headingId = role === "professional" ? "staff-professional-title" : "staff-admin-title";
  const description =
    role === "professional"
      ? "Cuentas del equipo profesional que coordina atenciones."
      : "Cuentas del equipo de administración que gestiona el sistema.";

  // Al terminar "Cargar más" el foco pasa a la primera fila nueva. Si la carga
  // no trajo filas y el botón desaparece, queda en la última para no perderlo.
  useLayoutEffect(() => {
    if (tail.pending || rowsBeforeLoad.current === null) {
      return;
    }
    const items = listRef.current?.querySelectorAll("li");
    const target =
      items?.[rowsBeforeLoad.current] ?? (tail.hasMore ? undefined : items?.[items.length - 1]);
    rowsBeforeLoad.current = null;
    (target as HTMLElement | undefined)?.querySelector("button")?.focus();
    if (target !== undefined && (target as HTMLElement).querySelector("button") === null) {
      (target as HTMLElement).focus();
    }
  }, [tail]);

  let firstPage: StaffAccountsPage | undefined;
  try {
    // El hook se invoca primero y en todos los renders: el orden es estable
    // y el try solo clasifica el error ya lanzado, no condiciona la llamada.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    firstPage = useStaffAccounts(role, null);
  } catch (error) {
    if (isAuthorizationDenial(error)) {
      return (
        <section aria-labelledby={headingId} className="student-portal__section">
          <div className="student-portal__section-head">
            <h2 id={headingId}>{title}</h2>
          </div>
          <DeniedState description={ACCOUNTS_DENIED_HINT} />
        </section>
      );
    }
    throw error;
  }

  if (firstPage === undefined) {
    return (
      <section aria-labelledby={headingId} className="student-portal__section">
        <div className="student-portal__section-head">
          <h2 id={headingId}>{title}</h2>
        </div>
        <LoadingState
          label={`Cargando las ${role === "professional" ? "cuentas profesionales" : "cuentas administrativas"}…`}
        />
      </section>
    );
  }

  if (firstPage.page.length === 0 && firstPage.isDone) {
    return (
      <section aria-labelledby={headingId} className="student-portal__section">
        <div className="student-portal__section-head">
          <h2 id={headingId}>{title}</h2>
        </div>
        <p>{description}</p>
        <EmptyState
          title={
            role === "professional"
              ? "No hay cuentas profesionales."
              : "No hay cuentas administrativas."
          }
        >
          <p>Cuando se registren cuentas de este rol, aparecerán aquí.</p>
        </EmptyState>
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId} className="student-portal__section">
      <div className="student-portal__section-head">
        <h2 id={headingId}>{title}</h2>
      </div>
      <p>{description}</p>
      <ul ref={listRef} className="student-portal__list">
        <StaffAccountsPageLevel
          role={role}
          page={firstPage}
          index={0}
          pageCount={pageCount}
          onTail={setTail}
        />
      </ul>
      {tail.hasMore ? (
        <div className="student-portal__cta">
          <button
            type="button"
            className="student-portal__btn student-portal__btn--primary aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            aria-disabled={tail.pending}
            aria-busy={tail.pending}
            onClick={() => {
              if (tail.pending) {
                return;
              }
              rowsBeforeLoad.current = listRef.current?.querySelectorAll("li").length ?? 0;
              setPageCount((count) => count + 1);
            }}
          >
            {tail.pending ? "Cargando…" : "Cargar más"}
          </button>
          {tail.pending && (
            <span role="status" aria-live="polite" className="sr-only">
              Cargando más cuentas…
            </span>
          )}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Páginas encadenadas por cursor: cada siguiente se pide con el
 * `continueCursor` vigente de la anterior, así el listado sigue contiguo si
 * una cuenta cambia entre páginas.
 */
function StaffAccountsPageLevel({
  role,
  page,
  index,
  pageCount,
  onTail,
}: {
  role: StaffAccountsRole;
  page: StaffAccountsPage;
  index: number;
  pageCount: number;
  onTail: (tail: TailState) => void;
}) {
  const canContinue = !page.isDone;
  const expanded = canContinue && index + 1 < pageCount;

  useLayoutEffect(() => {
    if (!expanded) {
      onTail({ pending: false, hasMore: canContinue });
    }
  }, [expanded, canContinue, onTail]);

  return (
    <>
      {page.page.map((account) => (
        <StaffAccountRow key={account._id} account={account} />
      ))}
      {expanded ? (
        <StaffAccountsPageFetcher
          role={role}
          cursor={page.continueCursor}
          index={index + 1}
          pageCount={pageCount}
          onTail={onTail}
        />
      ) : null}
    </>
  );
}

function StaffAccountsPageFetcher({
  role,
  cursor,
  index,
  pageCount,
  onTail,
}: {
  role: StaffAccountsRole;
  cursor: string;
  index: number;
  pageCount: number;
  onTail: (tail: TailState) => void;
}) {
  const page = useStaffAccounts(role, cursor);

  useLayoutEffect(() => {
    if (page === undefined) {
      onTail({ pending: true, hasMore: true });
    }
  }, [page, onTail]);

  if (page === undefined) {
    return null;
  }
  return (
    <StaffAccountsPageLevel
      role={role}
      page={page}
      index={index}
      pageCount={pageCount}
      onTail={onTail}
    />
  );
}

function StaffAccountRow({ account }: { account: StaffAccountItem }) {
  const enableAccount = useEnableStaffAccount();
  const revokeAccount = useRevokeStaffAccount();
  const [pendingAction, setPendingAction] = useState<"enable" | "revoke" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const pendingRef = useRef(false);

  const institutionalLabel = staffInstitutionalStatusLabel(account.institutionalStatus);
  const vigenteLabel = staffAccountStatusLabel(account.accountStatus);
  const roleLabel = staffRoleLabel(account.role);

  async function runAction(action: "enable" | "revoke") {
    if (pendingRef.current) {
      return;
    }
    pendingRef.current = true;
    setPendingAction(action);
    setActionError(null);
    setConfirmation(null);
    try {
      if (action === "enable") {
        await enableAccount({ userId: account._id });
        setConfirmation(`Cuenta de ${account.fullName} habilitada.`);
      } else {
        await revokeAccount({ userId: account._id });
        setConfirmation(`Cuenta de ${account.fullName} revocada.`);
      }
      // La query reactiva actualiza el estado sola.
    } catch (error) {
      const publicError = publicErrorOf(error);
      if (publicError?.code === "unauthorized" || isAuthorizationDenial(error)) {
        setActionError(ACCESS_DENIED_MESSAGE);
      } else if (publicError !== null) {
        setActionError(publicError.message);
      } else {
        setActionError(
          action === "enable"
            ? "No pudimos habilitar la cuenta. Inténtalo de nuevo."
            : "No pudimos revocar la cuenta. Inténtalo de nuevo.",
        );
      }
    } finally {
      pendingRef.current = false;
      setPendingAction(null);
    }
  }

  const busy = pendingAction !== null;

  return (
    <li className="student-portal__item" tabIndex={-1}>
      <span className={GESTION_ROW}>
        <span className="min-w-0">
          <strong>{account.fullName}</strong> · {account.email}
        </span>
      </span>
      <p className="student-portal__item-meta">
        Rol: {roleLabel} · Estado: {institutionalLabel} · Cuenta: {vigenteLabel}
      </p>
      {confirmation !== null ? (
        <p role="status" className="student-portal__item-meta">
          {confirmation}
        </p>
      ) : null}
      {actionError !== null ? (
        <p role="alert" className="student-portal__error">
          {actionError}
        </p>
      ) : null}
      <div className="student-portal__cta">
        {canEnableStaffAccount(account.institutionalStatus) ? (
          <button
            type="button"
            className={`student-portal__btn student-portal__btn--primary ${GESTION_FOCUS_VISIBLE}`}
            disabled={busy}
            aria-busy={busy && pendingAction === "enable"}
            onClick={() => void runAction("enable")}
          >
            {pendingAction === "enable"
              ? "Habilitando…"
              : `Habilitar cuenta de ${account.fullName}`}
          </button>
        ) : null}
        {canRevokeStaffAccount(account.institutionalStatus) ? (
          <button
            type="button"
            className={`student-portal__btn student-portal__btn--ghost ${GESTION_FOCUS_VISIBLE}`}
            disabled={busy}
            aria-busy={busy && pendingAction === "revoke"}
            onClick={() => void runAction("revoke")}
          >
            {pendingAction === "revoke" ? "Revocando…" : `Revocar cuenta de ${account.fullName}`}
          </button>
        ) : null}
      </div>
    </li>
  );
}
