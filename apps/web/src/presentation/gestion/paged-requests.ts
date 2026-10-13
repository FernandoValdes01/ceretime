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
 * Rangos contiguos: los cursores son posiciones fijas; si el conjunto visible
 * cambia (p. ej. una toma insertada en cualquier página desplaza filas) con
 * más de una ventana cargada, las ventanas fijas dejarían huecos. Ante ese
 * cambio se reancla a ventana única ([null], dato fresco del servidor);
 * "Cargar más" regenera cursores vigentes (y limpia la referencia para no
 * colapsar por el propio avance). Las lecturas (hasItems) se acotan siempre
 * a los cursores vigentes, nunca a entradas huérfanas de ciclos anteriores.
 * La firma es el multiconjunto ordenado: detecta cambios de pertenencia, no
 * reordenamientos. Ajuste en render del mismo componente con condición de
 * salida, sin loops ni aviso de React.
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
  // Firma del conjunto visible (multiconjunto ordenado) la última vez que
  // estuvo completo. Sin baseline no hay referencia: solo se memoriza.
  const [baseline, setBaseline] = useState<string | null>(null);
  const firstPage = usePage(null);
  const tailPage = usePage(cursors[cursors.length - 1] ?? null);

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

  // Firma del conjunto visible (multiconjunto ordenado: detecta cambios de
  // pertenencia, no reordenamientos). Si cambia con más de una ventana
  // cargada, los cursores fijos ya no son contiguos: se reancla a ventana
  // única fresca y "Cargar más" regenera cursores vigentes. Ajuste en render
  // del mismo componente con condición de salida, sin loops ni aviso.
  const signature = [...idsByCursor.values()].flat().sort().join(",");
  if (allReported) {
    if (baseline === null) {
      setBaseline(signature);
    } else if (signature !== baseline) {
      setBaseline(signature);
      if (cursors.length > 1) {
        setCursors([null]);
      }
    }
  }

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
      if (!next || cursors.includes(next)) {
        return;
      }
      // Nueva ventana = nueva referencia: se limpia el baseline para
      // memorizarlo de nuevo al completarse el reporte, sin colapsar por el
      // propio avance. Idempotente ante doble clic (mismo resultado).
      setBaseline(null);
      setCursors([...cursors, next]);
    },
  };
}
