import { useCallback, useEffect, useRef, useState } from "react";

import type { PractitionerAccompaniment } from "../../application/practitioner-accompaniment-models";
import type { PractitionerAccompanimentReader } from "../../application/practitioner-accompaniment-port";

export type PractitionerAccompanimentsLoadStatus = "loading" | "success" | "empty" | "error";

export interface PractitionerAccompanimentsState {
  readonly status: PractitionerAccompanimentsLoadStatus;
  readonly data: readonly PractitionerAccompaniment[];
  readonly error: unknown | null;
  readonly reload: () => void;
}

interface AccompanimentLoad {
  readonly reader: PractitionerAccompanimentReader;
  readonly practitionerId: string | null;
  readonly status: Exclude<PractitionerAccompanimentsLoadStatus, "empty">;
  readonly data: readonly PractitionerAccompaniment[];
  readonly error: unknown | null;
}

function loadingLoad(
  reader: PractitionerAccompanimentReader,
  practitionerId: string | null,
): AccompanimentLoad {
  return { reader, practitionerId, status: "loading", data: [], error: null };
}

function errorLoad(
  reader: PractitionerAccompanimentReader,
  practitionerId: string | null,
  error: unknown,
): AccompanimentLoad {
  return { reader, practitionerId, status: "error", data: [], error };
}

function successLoad(
  reader: PractitionerAccompanimentReader,
  practitionerId: string | null,
  data: readonly PractitionerAccompaniment[],
): AccompanimentLoad {
  return { reader, practitionerId, status: "success", data, error: null };
}

export function usePractitionerAccompaniments(
  reader: PractitionerAccompanimentReader,
  practitionerId: string | null,
): PractitionerAccompanimentsState {
  const [load, setLoad] = useState<AccompanimentLoad>(() => loadingLoad(reader, practitionerId));
  const [reloadVersion, setReloadVersion] = useState(0);
  const requestId = useRef(0);

  const reload = useCallback(() => {
    requestId.current += 1;
    setLoad(loadingLoad(reader, practitionerId));
    setReloadVersion((version) => version + 1);
  }, [practitionerId, reader]);

  useEffect(() => {
    let disposed = false;
    const currentRequestId = ++requestId.current;
    const isCurrent = () => !disposed && requestId.current === currentRequestId;

    if (!practitionerId) {
      return () => {
        disposed = true;
      };
    }

    let pending: Promise<readonly PractitionerAccompaniment[]>;
    try {
      pending = reader.readAssignedAccompaniments(practitionerId);
    } catch (error) {
      if (isCurrent()) {
        setLoad(errorLoad(reader, practitionerId, error));
      }
      return () => {
        disposed = true;
      };
    }

    Promise.resolve(pending).then(
      (data) => {
        if (isCurrent()) {
          setLoad(successLoad(reader, practitionerId, data));
        }
      },
      (error: unknown) => {
        if (isCurrent()) {
          setLoad(errorLoad(reader, practitionerId, error));
        }
      },
    );

    return () => {
      disposed = true;
    };
  }, [practitionerId, reader, reloadVersion]);

  const visibleLoad =
    load.reader === reader && load.practitionerId === practitionerId
      ? load
      : loadingLoad(reader, practitionerId);

  if (!practitionerId) {
    return { status: "empty", data: [], error: null, reload };
  }

  return {
    status:
      visibleLoad.status === "success" && visibleLoad.data.length === 0
        ? "empty"
        : visibleLoad.status,
    data: visibleLoad.data,
    error: visibleLoad.error,
    reload,
  };
}
