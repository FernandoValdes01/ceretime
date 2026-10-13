import { useCallback, useState } from "react";

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
 * congelada cuando Convex empuja cambios.
 *
 * Rangos contiguos: los cursores son posiciones fijas; si la primera página
 * cambia su contenido (p. ej. una toma insertada antes del límite desplaza
 * filas) con más páginas cargadas, las ventanas fijas dejarían huecos. Ante
 * ese cambio se reancla a ventana única ([null], dato fresco del servidor);
 * "Cargar más" regenera cursores vigentes. Solo la primera página dispara el
 * reanclaje: cambios en páginas posteriores no desplazan a las anteriores.
 * Las lecturas (hasItems) se acotan siempre a los cursores vigentes, nunca a
 * entradas huérfanas de ciclos anteriores.
 *
 * Cada página reporta sus IDs vía onIds desde un efecto del hijo con
 * dependencias ([cursor, page]): reportar en render dispara el aviso de React
 * ("Cannot update ... while rendering a different component", verificado en
 * consola de tests), el setState directo en efectos lo prohíbe el lint del
 * repo, y el reporte pasivo llegaría después del paint. La dep es el objeto
 * página (identidad estable por dato) y el updater funcional con guarda por
 * contenido solo re-renderiza cuando los IDs cambian de verdad.
 *
 * El registro (idsByCursor) decide el vacío (todas reportadas, sin filas y
 * sin más por cargar) y la desduplicación: los cursores son posiciones
 * fijas, así que un corrimiento por cambios concurrentes puede repetir una
 * fila en dos páginas; la posterior la omite y cada solicitud se muestra una
 * sola vez. Una fila que no cae en ninguna ventana cargada reaparece con el
 * siguiente push reactivo o al cargar más: todas siguen suscritas.
 */
export function usePagedList<Item extends RequestListItem>(
  usePage: (cursor: string | null) => RequestListPage<Item> | undefined,
) {
  const [cursors, setCursors] = useState<readonly (string | null)[]>([null]);
  const [idsByCursor, setIdsByCursor] = useState<ReadonlyMap<string, ReadonlyArray<string>>>(
    new Map(),
  );
  const [firstKey, setFirstKey] = useState<string | null>(null);
  const firstPage = usePage(null);
  const tailPage = usePage(cursors[cursors.length - 1] ?? null);

  // Reanclaje ante cambio en la primera ventana con más cargadas: ajuste en
  // render del mismo componente con condición de salida (clave igual y una
  // sola ventana), sin loops y sin aviso de React.
  const key = firstPage === undefined ? null : firstPage.page.map((item) => item._id).join(",");
  if (key !== null && key !== firstKey) {
    setFirstKey(key);
    if (cursors.length > 1) {
      setCursors([null]);
    }
  }

  const reportIds = useCallback((cursor: string | null, ids: ReadonlyArray<string>) => {
    const key = cursor ?? "first";
    setIdsByCursor((prev) => {
      const prevIds = prev.get(key);
      if (
        prevIds !== undefined &&
        prevIds.length === ids.length &&
        prevIds.every((id, i) => id === ids[i])
      ) {
        return prev;
      }
      return new Map(prev).set(key, ids);
    });
  }, []);

  const allReported = cursors.every((cursor) => idsByCursor.has(cursor ?? "first"));
  const hasItems = cursors.some((cursor) => (idsByCursor.get(cursor ?? "first") ?? []).length > 0);

  return {
    cursors,
    firstPage,
    hasItems,
    allReported,
    idsByCursor,
    tailPending: tailPage === undefined,
    tailDone: tailPage?.isDone ?? false,
    reportIds,
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
