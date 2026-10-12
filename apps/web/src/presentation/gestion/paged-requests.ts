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
 * congelada cuando Convex empuja cambios (p. ej. una toma que saca una
 * solicitud de la bandeja o cambia su estado en "Mis tomadas").
 *
 * La primera página decide los estados de carga y vacío; la última (cola),
 * el botón "Cargar más". Sin setState en render: todo el estado vive en
 * useState y cambia solo desde el evento del botón.
 */
export function usePagedList<Item extends RequestListItem>(
  usePage: (cursor: string | null) => RequestListPage<Item> | undefined,
) {
  const [cursors, setCursors] = useState<readonly (string | null)[]>([null]);
  const firstPage = usePage(null);
  const tailPage = usePage(cursors[cursors.length - 1] ?? null);

  return {
    cursors,
    firstPage,
    tailPending: tailPage === undefined,
    tailDone: tailPage?.isDone ?? false,
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
