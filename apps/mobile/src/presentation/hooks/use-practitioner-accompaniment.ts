import { useCallback, useEffect, useRef, useState } from "react";

import type { PractitionerAccompaniment } from "../../application/practitioner-accompaniment-models";
import {
  isPractitionerAccompanimentAccessDeniedError,
  type PractitionerAccompanimentReader,
} from "../../application/practitioner-accompaniment-port";

export type PractitionerAccompanimentLoadStatus = "loading" | "success" | "error" | "access-denied";

export interface PractitionerAccompanimentState {
  readonly status: PractitionerAccompanimentLoadStatus;
  readonly data: PractitionerAccompaniment | null;
  readonly error: unknown | null;
  readonly reload: () => void;
}

interface AccompanimentLoad {
  readonly reader: PractitionerAccompanimentReader;
  readonly practitionerId: string | null;
  readonly accompanimentId: string | null;
  readonly status: PractitionerAccompanimentLoadStatus;
  readonly data: PractitionerAccompaniment | null;
  readonly error: unknown | null;
}

function loadingLoad(
  reader: PractitionerAccompanimentReader,
  practitionerId: string | null,
  accompanimentId: string | null,
): AccompanimentLoad {
  return {
    reader,
    practitionerId,
    accompanimentId,
    status: "loading",
    data: null,
    error: null,
  };
}

function accessDeniedLoad(
  reader: PractitionerAccompanimentReader,
  practitionerId: string | null,
  accompanimentId: string | null,
  error: unknown,
): AccompanimentLoad {
  return {
    reader,
    practitionerId,
    accompanimentId,
    status: "access-denied",
    data: null,
    error,
  };
}

function errorLoad(
  reader: PractitionerAccompanimentReader,
  practitionerId: string | null,
  accompanimentId: string | null,
  error: unknown,
): AccompanimentLoad {
  return {
    reader,
    practitionerId,
    accompanimentId,
    status: "error",
    data: null,
    error,
  };
}

function successLoad(
  reader: PractitionerAccompanimentReader,
  practitionerId: string | null,
  accompanimentId: string | null,
  data: PractitionerAccompaniment,
): AccompanimentLoad {
  return {
    reader,
    practitionerId,
    accompanimentId,
    status: "success",
    data,
    error: null,
  };
}

export function usePractitionerAccompaniment(
  reader: PractitionerAccompanimentReader,
  practitionerId: string | null,
  accompanimentId: string | null,
): PractitionerAccompanimentState {
  const [load, setLoad] = useState<AccompanimentLoad>(() =>
    practitionerId && accompanimentId
      ? loadingLoad(reader, practitionerId, accompanimentId)
      : accessDeniedLoad(reader, practitionerId, accompanimentId, null),
  );
  const [reloadVersion, setReloadVersion] = useState(0);
  const requestId = useRef(0);

  const reload = useCallback(() => {
    requestId.current += 1;
    setLoad(
      practitionerId && accompanimentId
        ? loadingLoad(reader, practitionerId, accompanimentId)
        : accessDeniedLoad(reader, practitionerId, accompanimentId, null),
    );
    setReloadVersion((version) => version + 1);
  }, [accompanimentId, practitionerId, reader]);

  useEffect(() => {
    let disposed = false;
    const currentRequestId = ++requestId.current;
    const isCurrent = () => !disposed && requestId.current === currentRequestId;

    if (!practitionerId || !accompanimentId) {
      return () => {
        disposed = true;
      };
    }

    let pending: Promise<PractitionerAccompaniment>;
    try {
      pending = reader.readAssignedAccompaniment(practitionerId, accompanimentId);
    } catch (error) {
      if (isCurrent()) {
        setLoad(
          isPractitionerAccompanimentAccessDeniedError(error)
            ? accessDeniedLoad(reader, practitionerId, accompanimentId, error)
            : errorLoad(reader, practitionerId, accompanimentId, error),
        );
      }
      return () => {
        disposed = true;
      };
    }

    Promise.resolve(pending).then(
      (data) => {
        if (isCurrent()) {
          setLoad(successLoad(reader, practitionerId, accompanimentId, data));
        }
      },
      (error: unknown) => {
        if (isCurrent()) {
          setLoad(
            isPractitionerAccompanimentAccessDeniedError(error)
              ? accessDeniedLoad(reader, practitionerId, accompanimentId, error)
              : errorLoad(reader, practitionerId, accompanimentId, error),
          );
        }
      },
    );

    return () => {
      disposed = true;
    };
  }, [accompanimentId, practitionerId, reader, reloadVersion]);

  const visibleLoad =
    load.reader === reader &&
    load.practitionerId === practitionerId &&
    load.accompanimentId === accompanimentId
      ? load
      : loadingLoad(reader, practitionerId, accompanimentId);

  if (!practitionerId || !accompanimentId) {
    return {
      status: "access-denied",
      data: null,
      error: null,
      reload,
    };
  }

  return {
    status: visibleLoad.status,
    data: visibleLoad.data,
    error: visibleLoad.error,
    reload,
  };
}
