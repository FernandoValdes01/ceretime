import { useCallback, useEffect, useRef, useState } from "react";

import type { ProfessionalAccompaniment } from "../../application/professional-accompaniment-models";
import type { ProfessionalAccompanimentReader } from "../../application/professional-accompaniment-port";

export type ProfessionalAccompanimentsLoadStatus = "loading" | "success" | "empty" | "error";

export interface ProfessionalAccompanimentsState {
  readonly status: ProfessionalAccompanimentsLoadStatus;
  readonly data: readonly ProfessionalAccompaniment[];
  readonly error: unknown | null;
  readonly reload: () => void;
}

interface AccompanimentLoad {
  readonly reader: ProfessionalAccompanimentReader;
  readonly status: Exclude<ProfessionalAccompanimentsLoadStatus, "empty">;
  readonly data: readonly ProfessionalAccompaniment[];
  readonly error: unknown | null;
}

function loadingLoad(reader: ProfessionalAccompanimentReader): AccompanimentLoad {
  return { reader, status: "loading", data: [], error: null };
}

function errorLoad(reader: ProfessionalAccompanimentReader, error: unknown): AccompanimentLoad {
  return { reader, status: "error", data: [], error };
}

function successLoad(
  reader: ProfessionalAccompanimentReader,
  data: readonly ProfessionalAccompaniment[],
): AccompanimentLoad {
  return { reader, status: "success", data, error: null };
}

export function useProfessionalAccompaniments(
  reader: ProfessionalAccompanimentReader,
): ProfessionalAccompanimentsState {
  const [load, setLoad] = useState<AccompanimentLoad>(() => loadingLoad(reader));
  const [reloadVersion, setReloadVersion] = useState(0);
  const requestId = useRef(0);

  const reload = useCallback(() => {
    requestId.current += 1;
    setLoad(loadingLoad(reader));
    setReloadVersion((version) => version + 1);
  }, [reader]);

  useEffect(() => {
    let disposed = false;
    const currentRequestId = ++requestId.current;
    const isCurrent = () => !disposed && requestId.current === currentRequestId;
    let pending: Promise<readonly ProfessionalAccompaniment[]>;

    try {
      pending = reader.readAccompaniments();
    } catch (error) {
      if (isCurrent()) setLoad(errorLoad(reader, error));
      return () => {
        disposed = true;
      };
    }

    Promise.resolve(pending).then(
      (data) => {
        if (isCurrent()) setLoad(successLoad(reader, data));
      },
      (error: unknown) => {
        if (isCurrent()) setLoad(errorLoad(reader, error));
      },
    );

    return () => {
      disposed = true;
    };
  }, [reader, reloadVersion]);

  const visibleLoad = load.reader === reader ? load : loadingLoad(reader);

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
