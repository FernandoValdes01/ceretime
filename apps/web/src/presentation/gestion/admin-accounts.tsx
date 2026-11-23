import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { UNAUTHORIZED_ERROR_CODE } from "../../../../../convex/domain/index.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import "../routes/student-portal.css";
import "./admin-lists.css";
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
import { RowMenu } from "./row-menu.tsx";
import { useToast } from "./use-toast.ts";
import { ModalDialog } from "../shared/modal-dialog.tsx";
import {
  ACCESS_DENIED_MESSAGE,
  DeniedState,
  EmptyState,
  LoadingState,
} from "../shared/view-states.tsx";
import { adminLoadFallback } from "./admin-load-fallback.tsx";

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
      <StudentPanelErrorBoundary
        subject="las cuentas de personal"
        level="section"
        fallback={adminLoadFallback}
      >
        <StaffAccountsSection role="professional" />
      </StudentPanelErrorBoundary>
      <StudentPanelErrorBoundary
        subject="las cuentas de administración"
        level="section"
        fallback={adminLoadFallback}
      >
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
  const { toast, showToast } = useToast();
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
  // El encabezado de columnas no cuenta como fila.
  useLayoutEffect(() => {
    if (tail.pending || rowsBeforeLoad.current === null) {
      return;
    }
    const items = listRef.current?.querySelectorAll("li:not(.admin-list__head)");
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
    // La denegación llega como error público con código: `publicErrorOf`
    // reconoce también la forma anterior (`ConvexError("No autorizado")`), así
    // que no se compara el texto en ningún caso.
    if (publicErrorOf(error)?.code === UNAUTHORIZED_ERROR_CODE) {
      return (
        <section aria-labelledby={headingId} className="student-portal__section admin-section">
          <div className="student-portal__section-head">
            <h2 id={headingId}>{title}</h2>
          </div>
          <DeniedState tone="admin" description={ACCOUNTS_DENIED_HINT} />
        </section>
      );
    }
    throw error;
  }

  if (firstPage === undefined) {
    return (
      <section aria-labelledby={headingId} className="student-portal__section admin-section">
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
      <section aria-labelledby={headingId} className="student-portal__section admin-section">
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
    <section aria-labelledby={headingId} className="student-portal__section admin-section">
      <div className="student-portal__section-head">
        <h2 id={headingId}>{title}</h2>
      </div>
      <p>{description}</p>
      <ul ref={listRef} className="admin-list">
        <li className="admin-list__head admin-list__head--accounts" aria-hidden="true">
          <span>Cuenta</span>
          <span>Rol</span>
          <span>Estado</span>
          <span />
        </li>
        <StaffAccountsPageLevel
          role={role}
          page={firstPage}
          index={0}
          pageCount={pageCount}
          onTail={setTail}
          notify={showToast}
        />
      </ul>
      {toast !== null ? (
        <p role="status" className="toast">
          {toast}
        </p>
      ) : null}
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
              rowsBeforeLoad.current =
                listRef.current?.querySelectorAll("li:not(.admin-list__head)").length ?? 0;
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
  notify,
}: {
  role: StaffAccountsRole;
  page: StaffAccountsPage;
  index: number;
  pageCount: number;
  onTail: (tail: TailState) => void;
  notify: (message: string) => void;
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
        <StaffAccountRow key={account._id} account={account} notify={notify} />
      ))}
      {expanded ? (
        <StaffAccountsPageFetcher
          role={role}
          cursor={page.continueCursor}
          index={index + 1}
          pageCount={pageCount}
          onTail={onTail}
          notify={notify}
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
  notify,
}: {
  role: StaffAccountsRole;
  cursor: string;
  index: number;
  pageCount: number;
  onTail: (tail: TailState) => void;
  notify: (message: string) => void;
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
      notify={notify}
    />
  );
}

function StaffAccountRow({
  account,
  notify,
}: {
  account: StaffAccountItem;
  notify: (message: string) => void;
}) {
  const enableAccount = useEnableStaffAccount();
  const revokeAccount = useRevokeStaffAccount();
  const [pendingAction, setPendingAction] = useState<"enable" | "revoke" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
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
    try {
      if (action === "enable") {
        await enableAccount({ userId: account._id });
        notify(`Cuenta de ${account.fullName} habilitada.`);
      } else {
        await revokeAccount({ userId: account._id });
        notify(`Cuenta de ${account.fullName} revocada.`);
      }
      // La query reactiva actualiza el estado sola.
    } catch (error) {
      const publicError = publicErrorOf(error);
      if (publicError !== null) {
        // Los errores quedan fijos junto a la acción con `role="alert"`;
        // el aviso flotante es solo para confirmar éxitos. La denegación
        // conserva el aviso habitual de la Web (con el canal oficial).
        setActionError(
          publicError.code === UNAUTHORIZED_ERROR_CODE
            ? ACCESS_DENIED_MESSAGE
            : publicError.message,
        );
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
    <li tabIndex={-1}>
      <div className="admin-list__row admin-list__row--accounts">
        <div className="admin-list__cell--main">
          <p className="admin-list__name">{account.fullName}</p>
          <p className="admin-list__sub">{account.email}</p>
        </div>
        <p className="admin-list__text">
          <span className="sr-only">Rol: </span>
          {roleLabel}
        </p>
        <p className="admin-list__text">
          Estado: {institutionalLabel} · Cuenta: {vigenteLabel}
        </p>
        <div className="admin-list__actions">
          <RowMenu
            label={`Acciones para ${account.fullName}`}
            disabled={busy}
            items={[
              ...(canEnableStaffAccount(account.institutionalStatus)
                ? [
                    {
                      label: pendingAction === "enable" ? "Habilitando…" : "Habilitar cuenta",
                      onSelect: () => void runAction("enable"),
                    },
                  ]
                : []),
              ...(canRevokeStaffAccount(account.institutionalStatus)
                ? [
                    {
                      label: pendingAction === "revoke" ? "Revocando…" : "Revocar cuenta",
                      onSelect: () => setConfirmRevoke(true),
                      hasPopup: true,
                    },
                  ]
                : []),
            ]}
          />
        </div>
        {actionError !== null ? (
          <p role="alert" className="admin-list__feedback student-portal__error">
            {actionError}
          </p>
        ) : null}
        {confirmRevoke ? (
          <ModalDialog
            title="Revocar cuenta"
            description="Esta cuenta perderá acceso a CERETI en su próximo ingreso."
            onClose={() => setConfirmRevoke(false)}
            className="admin-confirm"
          >
            <div className="admin-confirm__actions">
              <button
                type="button"
                className="student-portal__btn student-portal__btn--ghost"
                onClick={() => setConfirmRevoke(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="student-portal__btn student-portal__btn--primary"
                onClick={() => {
                  setConfirmRevoke(false);
                  void runAction("revoke");
                }}
              >
                Revocar cuenta
              </button>
            </div>
          </ModalDialog>
        ) : null}
      </div>
    </li>
  );
}
