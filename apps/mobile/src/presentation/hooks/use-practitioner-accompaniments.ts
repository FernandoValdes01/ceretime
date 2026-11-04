import { useCallback } from "react";

import type { PractitionerAccompaniment } from "../../application/practitioner-accompaniment-models";
import type { PractitionerAccompanimentReader } from "../../application/practitioner-accompaniment-port";

import { useAsyncResource } from "./use-async-resource";
import { toMobileOperationError } from "../to-mobile-operation-error";

export type PractitionerAccompanimentsLoadStatus = "loading" | "success" | "empty" | "error";

export interface PractitionerAccompanimentsState {
  readonly status: PractitionerAccompanimentsLoadStatus;
  readonly data: readonly PractitionerAccompaniment[];
  readonly error: unknown | null;
  readonly reload: () => void;
}

export function usePractitionerAccompaniments(
  reader: PractitionerAccompanimentReader,
  practitionerId: string | null,
): PractitionerAccompanimentsState {
  const read = useCallback(
    () =>
      practitionerId ? reader.readAssignedAccompaniments(practitionerId) : Promise.resolve([]),
    [reader, practitionerId],
  );
  const resource = useAsyncResource(read, Boolean(practitionerId));
  const data = resource.data ?? [];
  return {
    status:
      !practitionerId || (resource.status === "success" && data.length === 0)
        ? "empty"
        : resource.status,
    data,
    error:
      resource.status === "error"
        ? toMobileOperationError(
            resource.error,
            "No pudimos cargar tus acompañamientos asignados. Intenta nuevamente.",
          )
        : null,
    reload: resource.reload,
  };
}
