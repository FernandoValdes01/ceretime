import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ProfessionalAgendaDay,
  ProfessionalAgendaEvent,
} from "../../application/professional-agenda-models";
import type { ProfessionalAgendaReader } from "../../application/professional-agenda-port";

export type ProfessionalAgendaStatus = "loading" | "success" | "empty" | "error";

export interface ProfessionalAgendaState {
  readonly status: ProfessionalAgendaStatus;
  readonly data: ProfessionalAgendaDay | null;
  readonly events: readonly ProfessionalAgendaEvent[];
  readonly error: unknown | null;
  readonly reload: () => void;
  readonly findEvent: (id: string) => ProfessionalAgendaEvent | null;
}

interface AgendaLoad {
  readonly reader: ProfessionalAgendaReader;
  readonly status: Exclude<ProfessionalAgendaStatus, "empty">;
  readonly data: ProfessionalAgendaDay | null;
  readonly error: unknown | null;
}

function loadingLoad(reader: ProfessionalAgendaReader): AgendaLoad {
  return { reader, status: "loading", data: null, error: null };
}

function errorLoad(reader: ProfessionalAgendaReader, error: unknown): AgendaLoad {
  return { reader, status: "error", data: null, error };
}

function successLoad(reader: ProfessionalAgendaReader, data: ProfessionalAgendaDay): AgendaLoad {
  return { reader, status: "success", data, error: null };
}

export function useProfessionalAgenda(reader: ProfessionalAgendaReader): ProfessionalAgendaState {
  const [load, setLoad] = useState<AgendaLoad>(() => loadingLoad(reader));
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
    let pending: Promise<ProfessionalAgendaDay>;

    try {
      pending = reader.readProfessionalAgenda();
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
  const data = visibleLoad.data;
  const events = data?.events ?? [];

  return {
    status: visibleLoad.status === "success" && events.length === 0 ? "empty" : visibleLoad.status,
    data,
    events,
    error: visibleLoad.error,
    reload,
    findEvent: (id) => events.find((event) => event.id === id) ?? null,
  };
}
