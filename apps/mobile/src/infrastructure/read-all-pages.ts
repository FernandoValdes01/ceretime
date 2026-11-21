import type { PaginationOptions, PaginationResult } from "convex/server";

const PAGE_SIZE = 50;
// Tope de seguridad: una bandeja más grande que esto indica un problema de datos, no un caso de uso.
const MAX_PAGES = 20;

/** Recorre una consulta paginada de Convex hasta el final para pantallas que muestran el conjunto completo. */
export async function readAllPages<Item>(
  readPage: (paginationOpts: PaginationOptions) => Promise<PaginationResult<Item>>,
): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await readPage({ numItems: PAGE_SIZE, cursor });
    items.push(...result.page);
    if (result.isDone) return items;
    cursor = result.continueCursor;
  }
  throw new Error("La consulta devolvió más páginas de las esperadas.");
}
