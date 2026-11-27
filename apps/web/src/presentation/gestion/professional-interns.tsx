import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { UNAUTHORIZED_ERROR_CODE } from "../../../../../convex/domain/index.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import "../routes/student-portal.css";
import "./admin-lists.css";
import { publicErrorOf } from "../../infrastructure/convex/public-error.ts";
import {
  canEnableIntern,
  useEnableIntern,
  useInternAccounts,
  type InternAccountItem,
  type InternAccountsPage,
} from "./professional-interns-data.ts";
import { RowMenu } from "./row-menu.tsx";
import { useToast } from "./use-toast.ts";
import {
  ACCESS_DENIED_MESSAGE,
  DeniedState,
  EmptyState,
  LoadingState,
} from "../shared/view-states.tsx";
import { adminLoadFallback } from "./admin-load-fallback.tsx";
import { staffAccountStatusLabel, staffInstitutionalStatusLabel } from "./admin-accounts-data.ts";

/**
 * Practicantes para el Profesional (TI2-170).
 *
 * Lista las cuentas practicantes con su habilitación y permite habilitar las
 * pendientes con `enableIntern` de TI2-140. La autorización vive en Convex:
 * sin permiso la lectura muestra acceso denegado y cada acción denegada avisa
 * sin revelar motivo. Habilitar no concede acompañamientos: la asignación se
 * hace por acompañamiento, en el detalle del Profesional.
 */

const PRACTICANTES_DENIED_HINT = "Si crees que deberías verlas, consulta con CERETI.";

export function ProfessionalInternsPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { toast, showToast } = useToast();

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="professional-interns-title">
      <h1 id="professional-interns-title" ref={headingRef} tabIndex={-1}>
        Practicantes
      </h1>
      <p>
        Habilita cuentas practicantes y después asigna acompañamientos por cada caso. Los cambios se
        guardan en el sistema y persisten al recargar.
      </p>
      <p className="student-portal__item-meta">
        Habilitar una cuenta permite operar según su rol. No concede acceso a acompañamientos ni a
        notas internas.
      </p>
      <StudentPanelErrorBoundary
        subject="los practicantes"
        level="section"
        fallback={adminLoadFallback}
      >
        <InternAccountsSection notify={showToast} />
      </StudentPanelErrorBoundary>
      {toast !== null ? (
        <p role="status" className="toast">
          {toast}
        </p>
      ) : null}
    </section>
  );
}

/** Estado de la última página encadenada: decide el botón "Cargar más". */
type TailState = { readonly pending: boolean; readonly hasMore: boolean };

function InternAccountsSection({ notify }: { notify: (message: string) => void }) {
  const [pageCount, setPageCount] = useState(1);
  const [tail, setTail] = useState<TailState>({ pending: false, hasMore: false });
  const listRef = useRef<HTMLUListElement>(null);
  const rowsBeforeLoad = useRef<number | null>(null);
  const headingId = "professional-interns-list-title";

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

  let firstPage: InternAccountsPage | undefined;
  try {
    // El hook se invoca primero y en todos los renders: el orden es estable
    // y el try solo clasifica el error ya lanzado, no condiciona la llamada.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    firstPage = useInternAccounts(null);
  } catch (error) {
    if (publicErrorOf(error)?.code === UNAUTHORIZED_ERROR_CODE) {
      return (
        <section aria-labelledby={headingId} className="student-portal__section admin-section">
          <div className="student-portal__section-head">
            <h2 id={headingId}>Cuentas practicantes</h2>
          </div>
          <DeniedState description={PRACTICANTES_DENIED_HINT} />
        </section>
      );
    }
    throw error;
  }

  if (firstPage === undefined) {
    return (
      <section aria-labelledby={headingId} className="student-portal__section admin-section">
        <div className="student-portal__section-head">
          <h2 id={headingId}>Cuentas practicantes</h2>
        </div>
        <LoadingState label="Cargando los practicantes…" />
      </section>
    );
  }

  if (firstPage.page.length === 0 && firstPage.isDone) {
    return (
      <section aria-labelledby={headingId} className="student-portal__section admin-section">
        <div className="student-portal__section-head">
          <h2 id={headingId}>Cuentas practicantes</h2>
        </div>
        <p>Cuentas con rol practicante, pendientes o habilitadas.</p>
        <EmptyState title="No hay cuentas practicantes.">
          <p>Cuando se registren practicantes, aparecerán aquí.</p>
        </EmptyState>
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId} className="student-portal__section admin-section">
      <div className="student-portal__section-head">
        <h2 id={headingId}>Cuentas practicantes</h2>
      </div>
      <p>Cuentas con rol practicante, pendientes o habilitadas.</p>
      <ul ref={listRef} className="admin-list">
        <li className="admin-list__head admin-list__head--interns" aria-hidden="true">
          <span>Cuenta</span>
          <span>Estado</span>
          <span />
        </li>
        <InternAccountsPageLevel
          page={firstPage}
          index={0}
          pageCount={pageCount}
          onTail={setTail}
          notify={notify}
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
              rowsBeforeLoad.current =
                listRef.current?.querySelectorAll("li:not(.admin-list__head)").length ?? 0;
              setPageCount((count) => count + 1);
            }}
          >
            {tail.pending ? "Cargando…" : "Cargar más"}
          </button>
          {tail.pending && (
            <span role="status" aria-live="polite" className="sr-only">
              Cargando más practicantes…
            </span>
          )}
        </div>
      ) : null}
    </section>
  );
}

function InternAccountsPageLevel({
  page,
  index,
  pageCount,
  onTail,
  notify,
}: {
  page: InternAccountsPage;
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
        <InternAccountRow key={account._id} account={account} notify={notify} />
      ))}
      {expanded ? (
        <InternAccountsPageFetcher
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

function InternAccountsPageFetcher({
  cursor,
  index,
  pageCount,
  onTail,
  notify,
}: {
  cursor: string;
  index: number;
  pageCount: number;
  onTail: (tail: TailState) => void;
  notify: (message: string) => void;
}) {
  const page = useInternAccounts(cursor);

  useLayoutEffect(() => {
    if (page === undefined) {
      onTail({ pending: true, hasMore: true });
    }
  }, [page, onTail]);

  if (page === undefined) {
    return null;
  }
  return (
    <InternAccountsPageLevel
      page={page}
      index={index}
      pageCount={pageCount}
      onTail={onTail}
      notify={notify}
    />
  );
}

function InternAccountRow({
  account,
  notify,
}: {
  account: InternAccountItem;
  notify: (message: string) => void;
}) {
  const enableAccount = useEnableIntern();
  const [pendingAction, setPendingAction] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const pendingRef = useRef(false);

  const institutionalLabel = staffInstitutionalStatusLabel(account.institutionalStatus);
  const vigenteLabel = staffAccountStatusLabel(account.accountStatus);

  async function runEnable() {
    if (pendingRef.current) {
      return;
    }
    pendingRef.current = true;
    setPendingAction(true);
    setActionError(null);
    try {
      await enableAccount({ userId: account._id });
      notify(`Cuenta de ${account.fullName} habilitada.`);
    } catch (error) {
      const publicError = publicErrorOf(error);
      if (publicError !== null) {
        setActionError(
          publicError.code === UNAUTHORIZED_ERROR_CODE
            ? ACCESS_DENIED_MESSAGE
            : publicError.message,
        );
      } else {
        setActionError("No pudimos habilitar la cuenta. Inténtalo de nuevo.");
      }
    } finally {
      pendingRef.current = false;
      setPendingAction(false);
    }
  }

  const busy = pendingAction;
  const canEnable = canEnableIntern(account.institutionalStatus);

  return (
    <li tabIndex={-1}>
      <div className="admin-list__row admin-list__row--interns">
        <div className="admin-list__cell--main">
          <p className="admin-list__name">{account.fullName}</p>
          <p className="admin-list__sub">{account.email}</p>
        </div>
        <p className="admin-list__text">
          Estado: {institutionalLabel} · Cuenta: {vigenteLabel}
        </p>
        <div className="admin-list__actions">
          {canEnable ? (
            <RowMenu
              label={`Acciones para ${account.fullName}`}
              disabled={busy}
              items={[
                {
                  label: pendingAction ? "Habilitando…" : "Habilitar cuenta",
                  onSelect: () => void runEnable(),
                },
              ]}
            />
          ) : null}
        </div>
        {actionError !== null ? (
          <p role="alert" className="admin-list__feedback student-portal__error">
            {actionError}
          </p>
        ) : null}
      </div>
    </li>
  );
}
