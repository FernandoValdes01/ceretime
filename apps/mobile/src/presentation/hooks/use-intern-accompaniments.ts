import { useCallback } from "react";

import type { InternAccompaniment } from "../../domain/intern-accompaniment-models";
import type { InternAccompanimentReader } from "../../application/intern-accompaniment-port";

import { useAsyncResource } from "./use-async-resource";
import { toMobileOperationError } from "../to-mobile-operation-error";

export type InternAccompanimentsLoadStatus = "loading" | "success" | "empty" | "error";

export interface InternAccompanimentsState {
  readonly status: InternAccompanimentsLoadStatus;
  readonly data: readonly InternAccompaniment[];
  readonly error: unknown | null;
  readonly reload: () => void;
}

export function useInternAccompaniments(
  reader: InternAccompanimentReader,
  internId: string | null,
): InternAccompanimentsState {
  const read = useCallback(
    () => (internId ? reader.readAssignedAccompaniments(internId) : Promise.resolve([])),
    [reader, internId],
  );
  const resource = useAsyncResource(read, Boolean(internId));
  const data = resource.data ?? [];
  return {
    status:
      !internId || (resource.status === "success" && data.length === 0) ? "empty" : resource.status,
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
