import { useCallback } from "react";

import type { ProfessionalAccompaniment } from "@/domain/professional-accompaniment-models";
import { isAccompanimentAccessDeniedError } from "@/domain/accompaniment-access-denied-error";
import type { ProfessionalAccompanimentReader } from "@/application/professional-accompaniment-port";

import { useAsyncResource } from "./use-async-resource";
import { isMobileAccessDenied, toMobileOperationError } from "../to-mobile-operation-error";

export type ProfessionalAccompanimentLoadStatus = "loading" | "success" | "error" | "access-denied";

export interface ProfessionalAccompanimentState {
  readonly status: ProfessionalAccompanimentLoadStatus;
  readonly data: ProfessionalAccompaniment | null;
  readonly error: unknown | null;
  readonly reload: () => void;
}

export function useProfessionalAccompaniment(
  reader: ProfessionalAccompanimentReader,
  accompanimentId: string | null,
): ProfessionalAccompanimentState {
  const read = useCallback(
    () =>
      accompanimentId
        ? reader.readAccompaniment(accompanimentId)
        : Promise.reject(new Error("Identificador ausente")),
    [reader, accompanimentId],
  );
  const resource = useAsyncResource(read, Boolean(accompanimentId));
  const denied =
    !accompanimentId ||
    (resource.status === "error" &&
      (isAccompanimentAccessDeniedError(resource.error) || isMobileAccessDenied(resource.error)));
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
