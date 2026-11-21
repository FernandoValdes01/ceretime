import type { FunctionReturnType } from "convex/server";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { ProfessionalAccompanimentReader } from "../application/professional-accompaniment-port";
import type { ProfessionalAccompaniment } from "../domain/professional-accompaniment-models";
import type { MobileConvexClient } from "./convex-client";
import { MAX_PAGES, PAGE_SIZE, tooManyPagesMessage } from "./read-all-pages";

type BackendAccompanimentView = FunctionReturnType<
  typeof api.presentation.accompaniments.getAccompaniment
>;

// El backend no publica el nombre del estudiante en esta vista; se muestra el código de referencia,
// que es el identificador que el personal usa al coordinar por canal oficial.
function mapAccompaniment(view: BackendAccompanimentView): ProfessionalAccompaniment {
  return {
    id: view._id,
    studentName: view.view === "full" ? `Estudiante ${view.referenceCode}` : "Estudiante",
    objective: view.objective,
    status: view.status,
  };
}

/** Acompañamientos asignados al Profesional y su detalle, leídos de Convex (TI2-24, TI2-183). */
export function createConvexProfessionalAccompanimentReader(
  client: Pick<MobileConvexClient, "query">,
): ProfessionalAccompanimentReader {
  return {
    async readAccompaniments() {
      const accompaniments: ProfessionalAccompaniment[] = [];
      let after: Id<"accompaniments"> | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const { items, hasMore, lastId } = await client.query(
          api.presentation.accompaniments.listAssignedAccompaniments,
          { limit: PAGE_SIZE, after },
        );
        accompaniments.push(...items.map(mapAccompaniment));
        if (!hasMore || !lastId) return accompaniments;
        after = lastId;
      }
      throw new Error(tooManyPagesMessage);
    },
    async readAccompaniment(accompanimentId) {
      // La app solo reenvía IDs recibidos de Convex; el servidor valida el formato y el permiso.
      const view = await client.query(api.presentation.accompaniments.getAccompaniment, {
        accompanimentId: accompanimentId as Id<"accompaniments">,
      });
      return mapAccompaniment(view);
    },
  };
}
