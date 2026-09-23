import type { PractitionerAccompaniment } from "./practitioner-accompaniment-models";

/** Lector reemplazable para la lista autorizada del Practicante. */
export interface PractitionerAccompanimentReader {
  readAssignedAccompaniments(practitionerId: string): Promise<readonly PractitionerAccompaniment[]>;
}
