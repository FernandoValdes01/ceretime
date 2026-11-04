import { useCallback } from "react";

import type { PractitionerAccompaniment } from "../../application/practitioner-accompaniment-models";
import {
  isPractitionerAccompanimentAccessDeniedError,
  type PractitionerAccompanimentReader,
} from "../../application/practitioner-accompaniment-port";

import { useAsyncResource } from "./use-async-resource";
import { isMobileAccessDenied, toMobileOperationError } from "../to-mobile-operation-error";

export type PractitionerAccompanimentLoadStatus = "loading" | "success" | "error" | "access-denied";

export interface PractitionerAccompanimentState {
  readonly status: PractitionerAccompanimentLoadStatus;
  readonly data: PractitionerAccompaniment | null;
  readonly error: unknown | null;
  readonly reload: () => void;
}

export function usePractitionerAccompaniment(
  reader: PractitionerAccompanimentReader,
  practitionerId: string | null,
  accompanimentId: string | null,
): PractitionerAccompanimentState {
  const read = useCallback(
    () =>
      practitionerId && accompanimentId
        ? reader.readAssignedAccompaniment(practitionerId, accompanimentId)
        : Promise.reject(new Error("Identificador ausente")),
    [reader, practitionerId, accompanimentId],
  );
  const resource = useAsyncResource(read, Boolean(practitionerId && accompanimentId));
  const denied =
    !(practitionerId && accompanimentId) ||
    (resource.status === "error" &&
      (isPractitionerAccompanimentAccessDeniedError(resource.error) ||
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
