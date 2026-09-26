import { useCallback, useEffect, useRef, useState } from "react";

import type { ProfessionalAccompaniment } from "@/application/professional-accompaniment-models";
import {
  isProfessionalAccompanimentAccessDeniedError,
  type ProfessionalAccompanimentReader,
} from "@/application/professional-accompaniment-port";

export type ProfessionalAccompanimentLoadStatus = "loading" | "success" | "error" | "access-denied";

export interface ProfessionalAccompanimentState {
  readonly status: ProfessionalAccompanimentLoadStatus;
  readonly data: ProfessionalAccompaniment | null;
  readonly error: unknown | null;
  readonly reload: () => void;
}

interface AccompanimentLoad {
  readonly reader: ProfessionalAccompanimentReader;
  readonly accompanimentId: string | null;
  readonly status: ProfessionalAccompanimentLoadStatus;
  readonly data: ProfessionalAccompaniment | null;
  readonly error: unknown | null;
}

function loadingLoad(
  reader: ProfessionalAccompanimentReader,
  accompanimentId: string | null,
): AccompanimentLoad {
  return {
    reader,
    accompanimentId,
    status: "loading",
    data: null,
    error: null,
  };
}

function accessDeniedLoad(
  reader: ProfessionalAccompanimentReader,
  accompanimentId: string | null,
  error: unknown,
): AccompanimentLoad {
  return {
    reader,
    accompanimentId,
    status: "access-denied",
    data: null,
    error,
  };
}

function errorLoad(
  reader: ProfessionalAccompanimentReader,
  accompanimentId: string | null,
  error: unknown,
): AccompanimentLoad {
  return {
    reader,
    accompanimentId,
    status: "error",
    data: null,
    error,
  };
}

function successLoad(
  reader: ProfessionalAccompanimentReader,
  accompanimentId: string | null,
  data: ProfessionalAccompaniment,
): AccompanimentLoad {
  return {
    reader,
    accompanimentId,
    status: "success",
    data,
    error: null,
  };
}

export function useProfessionalAccompaniment(
  reader: ProfessionalAccompanimentReader,
  accompanimentId: string | null,
): ProfessionalAccompanimentState {
  const [load, setLoad] = useState<AccompanimentLoad>(() =>
    accompanimentId
      ? loadingLoad(reader, accompanimentId)
      : accessDeniedLoad(reader, accompanimentId, null),
  );
  const [reloadVersion, setReloadVersion] = useState(0);
  const requestId = useRef(0);

  const reload = useCallback(() => {
    requestId.current += 1;
    setLoad(
      accompanimentId
        ? loadingLoad(reader, accompanimentId)
        : accessDeniedLoad(reader, accompanimentId, null),
    );
    setReloadVersion((version) => version + 1);
  }, [accompanimentId, reader]);

  useEffect(() => {
    let disposed = false;
    const currentRequestId = ++requestId.current;
    const isCurrent = () => !disposed && requestId.current === currentRequestId;

    if (!accompanimentId) {
      return () => {
        disposed = true;
      };
    }

    let pending: Promise<ProfessionalAccompaniment>;
    try {
      pending = reader.readAccompaniment(accompanimentId);
    } catch (error) {
      if (isCurrent()) {
        setLoad(
          isProfessionalAccompanimentAccessDeniedError(error)
            ? accessDeniedLoad(reader, accompanimentId, error)
            : errorLoad(reader, accompanimentId, error),
        );
      }
      return () => {
        disposed = true;
      };
    }

    Promise.resolve(pending).then(
      (data) => {
        if (isCurrent()) setLoad(successLoad(reader, accompanimentId, data));
      },
      (error: unknown) => {
        if (isCurrent()) {
          setLoad(
            isProfessionalAccompanimentAccessDeniedError(error)
              ? accessDeniedLoad(reader, accompanimentId, error)
              : errorLoad(reader, accompanimentId, error),
          );
        }
      },
    );

    return () => {
      disposed = true;
    };
  }, [accompanimentId, reader, reloadVersion]);

  const visibleLoad =
    load.reader === reader && load.accompanimentId === accompanimentId
      ? load
      : loadingLoad(reader, accompanimentId);

  if (!accompanimentId) {
    return { status: "access-denied", data: null, error: null, reload };
  }

  return {
    status: visibleLoad.status,
    data: visibleLoad.data,
    error: visibleLoad.error,
    reload,
  };
}
