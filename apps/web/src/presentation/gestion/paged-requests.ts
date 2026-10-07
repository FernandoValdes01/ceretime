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
 * Acumula páginas con cursor sin duplicar y refleja actualizaciones
 * reactivas (TI2-91).
 *
 * Guarda cada página una sola vez durante el render (patrón documentado de
 * React para ajustar estado en render): evita setState en efectos sin
 * perder páginas al avanzar el cursor. La clave es el cursor pedido.
 * Además, si Convex devuelve una página distinta para el mismo cursor
 * (actualización reactiva), se reemplaza ese segmento y se reconstruye
 * la lista completa en orden de cursor.
 */
export function usePagedItems<Item extends RequestListItem>(
  usePage: (cursor: string | null) => RequestListPage<Item> | undefined,
) {
  const [cursor, setCursor] = useState<string | null>(null);
  const page = usePage(cursor);
  const [pages, setPages] = useState<Map<string, { items: ReadonlyArray<Item>; hash: string }>>(
    new Map(),
  );
  const [done, setDone] = useState(false);

  if (page !== undefined) {
    // Hash incluye _id y status para detectar cambios de datos con mismo ID.
    const currentHash = page.page.map((item) => `${item._id}:${item.status}`).join(",");
    const existing = pages.get(cursor ?? "first");

    if (!existing || existing.hash !== currentHash) {
      setPages((prev) => {
        const next = new Map(prev);
        next.set(cursor ?? "first", { items: page.page, hash: currentHash });
        return next;
      });
    }
    // Los metadatos de paginación se sincronizan aunque las filas no cambien:
    // si isDone pasa a false, "Cargar más" debe aparecer. La comparación con
    // el estado actual evita el set en cada render (sin ella, loop infinito).
    if (done !== page.isDone) {
      setDone(page.isDone);
    }
  }

  // Reconstruye la lista concatenando páginas en orden de cursor:
  // "first" (null) primero, luego el resto en orden de inserción.
  const items = Array.from(pages.entries())
    .sort(([a], [b]) => (a === "first" ? -1 : b === "first" ? 1 : 0))
    .flatMap(([, v]) => v.items);

  return {
    items,
    done,
    pending: page === undefined,
    // Sin página vigente o sin más páginas no hay a dónde avanzar: no toca
    // el cursor (la UI además oculta el botón con done y lo deshabilita con
    // pending; esto blinda la primitiva aunque se invoque programáticamente).
    loadMore: () => {
      if (done || page === undefined) {
        return;
      }
      setCursor(page.continueCursor);
    },
  };
}
