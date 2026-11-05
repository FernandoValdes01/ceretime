import { useCallback } from "react";

import type { InternAccompaniment } from "../../domain/intern-accompaniment-models";
import { isInternAccompanimentAccessDeniedError } from "../../domain/intern-accompaniment-models";
import type { InternAccompanimentReader } from "../../application/intern-accompaniment-port";

import { useAsyncResource } from "./use-async-resource";
import { isMobileAccessDenied, toMobileOperationError } from "../to-mobile-operation-error";

export type InternAccompanimentLoadStatus = "loading" | "success" | "error" | "access-denied";

export interface InternAccompanimentState {
  readonly status: InternAccompanimentLoadStatus;
  readonly data: InternAccompaniment | null;
  readonly error: unknown | null;
  readonly reload: () => void;
}

export function useInternAccompaniment(
  reader: InternAccompanimentReader,
  internId: string | null,
  accompanimentId: string | null,
): InternAccompanimentState {
  const read = useCallback(
    () =>
      internId && accompanimentId
        ? reader.readAssignedAccompaniment(internId, accompanimentId)
        : Promise.reject(new Error("Identificador ausente")),
    [reader, internId, accompanimentId],
  );
  const resource = useAsyncResource(read, Boolean(internId && accompanimentId));
  const denied =
    !(internId && accompanimentId) ||
    (resource.status === "error" &&
      (isInternAccompanimentAccessDeniedError(resource.error) ||
        isMobileAccessDenied(resource.error)));
  return {
    status: denied ? "access-denied" : resource.status,
    data: denied ? null : resource.data,
    error:
      resource.status === "error"
        ? toMobileOperationError(
            resource.error,
            "No pudimos cargar el acompañamiento. Intenta nuevamente.",
          )
        : null,
    reload: resource.reload,
  };
}
