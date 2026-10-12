import { useState } from "react";

/** Fila mínima que muestran las listas: coincide con ambas vistas. */
export type RequestListItem = {
  readonly _id: string;
  readonly status: string;
  readonly createdAt: number;
};

/** Página tal como la devuelve el Backend: claves `page`, `isDone` y cursor. */
export type RequestListPage<Item extends RequestListItem> = {
  readonly page: ReadonlyArray<Item>;
  readonly isDone: boolean;
  readonly continueCursor: string;
};

/**
 * Paginación con lectura reactiva de todas las páginas cargadas (TI2-91).
 *
 * Guarda la lista de cursores pedidos (solo crece). Cada cursor lo suscribe
 * por separado el componente <PagedItems>: así ninguna página cargada queda
 * congelada cuando Convex empuja cambios (p. ej. una toma que vacía la
 * primera página mientras una posterior aún tiene filas, o un cambio de
 * estado en "Mis tomadas").
 *
 * Cada página reporta su conteo (onCount) con guarda por valor: sin el
 * conteo, una primera página vacía ocultaría filas que aún existen en
 * páginas posteriores. La primera página decide la carga inicial; el vacío
 * exige todas las páginas reportadas y sin filas; la última (cola), el botón
 * "Cargar más". Sin setState en efectos: los ajustes en render tienen
 * condición de salida y terminan.
 */
export function usePagedList<Item extends RequestListItem>(
  usePage: (cursor: string | null) => RequestListPage<Item> | undefined,
) {
  const [cursors, setCursors] = useState<readonly (string | null)[]>([null]);
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(new Map());
  const firstPage = usePage(null);
  const tailPage = usePage(cursors[cursors.length - 1] ?? null);

  const reportCount = (cursor: string | null, count: number) => {
    const key = cursor ?? "first";
    if (counts.get(key) !== count) {
      setCounts((prev) => new Map(prev).set(key, count));
    }
  };

  const allReported = cursors.every((cursor) => counts.has(cursor ?? "first"));
  const hasItems = cursors.some((cursor) => (counts.get(cursor ?? "first") ?? 0) > 0);

  return {
    cursors,
    firstPage,
    hasItems,
    allReported,
    tailPending: tailPage === undefined,
    tailDone: tailPage?.isDone ?? false,
    reportCount,
    loadMore: () => {
      if (tailPage === undefined || tailPage.isDone) {
        return;
      }
      const next = tailPage.continueCursor;
      if (!next) {
        return;
      }
      setCursors((prev) => (prev.includes(next) ? prev : [...prev, next]));
    },
  };
}
