import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { accompanimentStatusLabel } from "../routes/student-panel-labels.ts";
// Reutiliza el lenguaje visual del panel (listas, tarjetas, errores): una sola
// fuente para no duplicar el sistema de diseño entre portales.
import "../routes/student-portal.css";
import {
  toMinimizedAccompaniment,
  useAssignedAccompaniments,
  type AssignedAccompanimentsPage,
  type MinimizedAccompaniment,
} from "./practitioner-accompaniments-data.ts";
import { DeniedState, EmptyState, LoadingState } from "../shared/view-states.tsx";
import { isAuthorizationDenial } from "../shared/authorization-denial.ts";

/**
 * Listado paginado de los acompañamientos asignados (TI2-116, TI2-165).
 *
 * Lo comparten el Practicante y el Profesional, que leen la misma query
 * `listAssignedAccompaniments`: el Backend decide qué acompañamientos entran
 * y con qué vista. La fila muestra solo el objetivo y el estado, aunque el
 * Profesional reciba la vista completa, para que el listado no exponga las
 * necesidades de acceso. Cada fila enlaza al detalle del portal que la
 * muestra, así los acompañamientos se recorren uno por uno sin mezclarse.
 */

/** Foco visible de 3px según DESIGN.md, compartido por enlaces y filas. */
export const GESTION_FOCUS_VISIBLE =
  "focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-[2px]";

/**
 * Mismo lenguaje que la agenda del Profesional (TI2-115). El título fija su
 * interlineado porque el heredado de `:root` superpone dos líneas; el enlace
 * de retorno se reconoce por el subrayado, sin depender solo del color; la
 * fila es un enlace completo con el objetivo como dato principal, el estado
 * como etiqueta de texto y "Ver detalle" como acción visible.
 */
export const ACCOMPANIMENT_TITLE = "leading-[1.2]";
export const ACCOMPANIMENT_BACK_LINK = `flex min-h-[44px] w-fit items-center gap-1 rounded-[0.5rem] text-base font-semibold text-primary underline ${GESTION_FOCUS_VISIBLE}`;
const ACCOMPANIMENT_ITEM =
  "rounded-lg border border-border-low bg-surface-container-lowest transition-colors hover:border-outline";
const ACCOMPANIMENT_ITEM_LINK = `flex min-h-[44px] flex-col gap-2 rounded-lg px-5 py-4 text-left text-on-surface no-underline ${GESTION_FOCUS_VISIBLE}`;

/** Portal que muestra el listado: decide a qué detalle enlaza cada fila. */
export type AssignedAccompanimentsArea = "practitioner" | "professional";

/** Textos del listado que cambian según el portal. */
export type AssignedAccompanimentsTexts = {
  readonly loading: string;
  readonly deniedTitle: string;
  readonly deniedHint: string;
  readonly emptyTitle: string;
  readonly emptyHint: string;
};

/** Estado de la última página encadenada: decide el botón "Cargar más". */
type TailState = { readonly pending: boolean; readonly hasMore: boolean };

export function AssignedAccompanimentsList({
  area,
  texts,
}: {
  area: AssignedAccompanimentsArea;
  texts: AssignedAccompanimentsTexts;
}) {
  // Páginas pedidas; solo crece con "Cargar más".
  const [pageCount, setPageCount] = useState(1);
  const [tail, setTail] = useState<TailState>({ pending: false, hasMore: false });
  const listRef = useRef<HTMLUListElement>(null);
  // Filas visibles al pedir otra página; `null` sin una carga pedida con el botón.
  const rowsBeforeLoad = useRef<number | null>(null);

  // Al terminar "Cargar más" el foco pasa a la primera fila nueva. Si la carga
  // no trajo filas y el botón desaparece, queda en la última para no perderlo.
  useLayoutEffect(() => {
    if (tail.pending || rowsBeforeLoad.current === null) {
      return;
    }
    const links = listRef.current?.querySelectorAll("a");
    const target =
      links?.[rowsBeforeLoad.current] ?? (tail.hasMore ? undefined : links?.[links.length - 1]);
    rowsBeforeLoad.current = null;
    target?.focus();
  }, [tail]);

  let firstPage: AssignedAccompanimentsPage | undefined;
  try {
    // El hook se invoca primero y en todos los renders: el orden es estable
    // y el try solo clasifica el error ya lanzado, no condiciona la llamada.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    firstPage = useAssignedAccompaniments(undefined);
  } catch (error) {
    if (isAuthorizationDenial(error)) {
      return <DeniedState title={texts.deniedTitle} description={texts.deniedHint} />;
    }
    throw error;
  }

  if (firstPage === undefined) {
    return <LoadingState label={texts.loading} />;
  }

  if (firstPage.items.length === 0 && !firstPage.hasMore) {
    return (
      <EmptyState title={texts.emptyTitle}>
        <p>{texts.emptyHint}</p>
      </EmptyState>
    );
  }

  return (
    <>
      <ul ref={listRef} className="mt-4 grid list-none gap-3 p-0">
        <AssignedPageLevel
          area={area}
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
            // `aria-disabled` y no `disabled`: un botón deshabilitado pierde el
            // foco del teclado mientras carga la página siguiente.
            aria-disabled={tail.pending}
            aria-busy={tail.pending}
            onClick={() => {
              if (tail.pending) {
                return;
              }
              rowsBeforeLoad.current = listRef.current?.querySelectorAll("a").length ?? 0;
              setPageCount((count) => count + 1);
            }}
          >
            {tail.pending ? "Cargando…" : "Cargar más"}
          </button>
          {tail.pending && (
            <span role="status" aria-live="polite" className="sr-only">
              Cargando más acompañamientos…
            </span>
          )}
        </div>
      ) : null}
    </>
  );
}

/**
 * Páginas encadenadas por cursor keyset (TI2-116).
 *
 * Cada página siguiente se suscribe con el `lastId` vigente de la anterior,
 * no con uno congelado: si una asignación se concede o se revoca en una
 * página ya cargada, las siguientes se vuelven a pedir desde el nuevo borde y el
 * listado sigue contiguo, sin huecos ni filas repetidas. La página donde
 * termina la cadena reporta su estado en layout effect (antes del paint)
 * para que el botón no parpadee.
 */
function AssignedPageLevel({
  area,
  page,
  index,
  pageCount,
  onTail,
}: {
  area: AssignedAccompanimentsArea;
  page: AssignedAccompanimentsPage;
  index: number;
  pageCount: number;
  onTail: (tail: TailState) => void;
}) {
  const canContinue = page.hasMore && page.lastId !== null;
  const expanded = canContinue && index + 1 < pageCount;

  useLayoutEffect(() => {
    if (!expanded) {
      onTail({ pending: false, hasMore: canContinue });
    }
  }, [expanded, canContinue, onTail]);

  return (
    <>
      {page.items.map((item) => (
        <AssignedAccompanimentRow
          key={item._id}
          area={area}
          accompaniment={toMinimizedAccompaniment(item)}
        />
      ))}
      {expanded && page.lastId !== null ? (
        <AssignedPageFetcher
          area={area}
          after={page.lastId}
          index={index + 1}
          pageCount={pageCount}
          onTail={onTail}
        />
      ) : null}
    </>
  );
}

function AssignedPageFetcher({
  area,
  after,
  index,
  pageCount,
  onTail,
}: {
  area: AssignedAccompanimentsArea;
  after: string;
  index: number;
  pageCount: number;
  onTail: (tail: TailState) => void;
}) {
  const page = useAssignedAccompaniments(after);

  useLayoutEffect(() => {
    if (page === undefined) {
      onTail({ pending: true, hasMore: true });
    }
  }, [page, onTail]);

  if (page === undefined) {
    return null;
  }
  return (
    <AssignedPageLevel
      area={area}
      page={page}
      index={index}
      pageCount={pageCount}
      onTail={onTail}
    />
  );
}

function AssignedAccompanimentRow({
  area,
  accompaniment,
}: {
  area: AssignedAccompanimentsArea;
  accompaniment: MinimizedAccompaniment;
}) {
  const content = (
    <>
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-lg font-semibold wrap-anywhere">
          {accompaniment.objective}
        </span>
        <span className="inline-flex w-fit items-center rounded-full bg-surface-container-low px-3 py-1 text-sm font-bold">
          {accompanimentStatusLabel(accompaniment.status)}
        </span>
      </span>
      <span className="text-base font-semibold text-primary underline">
        Ver detalle<span aria-hidden="true"> →</span>
      </span>
    </>
  );
  return (
    <li className={ACCOMPANIMENT_ITEM}>
      {area === "professional" ? (
        <Link
          to="/profesional/acompanamientos/$accompanimentId"
          params={{ accompanimentId: accompaniment._id }}
          className={ACCOMPANIMENT_ITEM_LINK}
        >
          {content}
        </Link>
      ) : (
        <Link
          to="/practicante/acompanamientos/$accompanimentId"
          params={{ accompanimentId: accompaniment._id }}
          className={ACCOMPANIMENT_ITEM_LINK}
        >
          {content}
        </Link>
      )}
    </li>
  );
}
