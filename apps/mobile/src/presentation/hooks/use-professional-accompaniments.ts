import { useCallback } from "react";

import type { ProfessionalAccompaniment } from "../../application/professional-accompaniment-models";
import type { ProfessionalAccompanimentReader } from "../../application/professional-accompaniment-port";

import { useAsyncResource } from "./use-async-resource";
import { toMobileOperationError } from "../to-mobile-operation-error";

export type ProfessionalAccompanimentsLoadStatus = "loading" | "success" | "empty" | "error";

export interface ProfessionalAccompanimentsState {
  readonly status: ProfessionalAccompanimentsLoadStatus;
  readonly data: readonly ProfessionalAccompaniment[];
  readonly error: unknown | null;
  readonly reload: () => void;
}

export function useProfessionalAccompaniments(
  reader: ProfessionalAccompanimentReader,
): ProfessionalAccompanimentsState {
  const read = useCallback(() => reader.readAccompaniments(), [reader]);
  const resource = useAsyncResource(read);
  const data = resource.data ?? [];
  return {
    status: resource.status === "success" && data.length === 0 ? "empty" : resource.status,
    data,
    error:
      resource.status === "error"
        ? toMobileOperationError(
            resource.error,
            "No pudimos cargar los acompañamientos. Intenta nuevamente.",
          )
        : null,
    reload: resource.reload,
  };
}
