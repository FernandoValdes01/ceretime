// Puerto de lectura de los acompañamientos asignados al Practicante.
import type { InternAccompaniment } from "../domain/intern-accompaniment-models";

/** Lector reemplazable para la lista autorizada del Practicante. */
export interface InternAccompanimentReader {
  readAssignedAccompaniments(internId: string): Promise<readonly InternAccompaniment[]>;
  readAssignedAccompaniment(
    internId: string,
    accompanimentId: string,
  ): Promise<InternAccompaniment>;
}
