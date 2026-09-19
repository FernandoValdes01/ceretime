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
  readonly goToPreviousDay: () => void;
  readonly goToNextDay: () => void;
  readonly findEvent: (id: string) => ProfessionalAgendaEvent | null;
}

interface AgendaLoad {
  readonly reader: ProfessionalAgendaReader;
  readonly dayOffset: number;
  readonly status: Exclude<ProfessionalAgendaStatus, "empty">;
  readonly data: ProfessionalAgendaDay | null;
  readonly error: unknown | null;
}

function loadingLoad(reader: ProfessionalAgendaReader, dayOffset: number): AgendaLoad {
  return { reader, dayOffset, status: "loading", data: null, error: null };
}

function errorLoad(
  reader: ProfessionalAgendaReader,
  dayOffset: number,
  error: unknown,
): AgendaLoad {
  return { reader, dayOffset, status: "error", data: null, error };
}

function successLoad(
  reader: ProfessionalAgendaReader,
  dayOffset: number,
  data: ProfessionalAgendaDay,
): AgendaLoad {
  return { reader, dayOffset, status: "success", data, error: null };
}

export function useProfessionalAgenda(reader: ProfessionalAgendaReader): ProfessionalAgendaState {
  const [dayOffset, setDayOffset] = useState(0);
  const [load, setLoad] = useState<AgendaLoad>(() => loadingLoad(reader, 0));
  const [reloadVersion, setReloadVersion] = useState(0);
  const requestId = useRef(0);

  const reload = useCallback(() => {
    requestId.current += 1;
    setLoad(loadingLoad(reader, dayOffset));
    setReloadVersion((version) => version + 1);
  }, [dayOffset, reader]);

  const changeDay = useCallback(
    (delta: number) => {
      const nextOffset = dayOffset + delta;
      setDayOffset(nextOffset);
      setLoad(loadingLoad(reader, nextOffset));
    },
    [dayOffset, reader],
  );

  useEffect(() => {
    let disposed = false;
    const currentRequestId = ++requestId.current;

    const isCurrent = () => !disposed && requestId.current === currentRequestId;
    let pending: Promise<ProfessionalAgendaDay>;

    try {
      pending = reader.readProfessionalAgenda(dayOffset);
    } catch (error) {
      if (isCurrent()) setLoad(errorLoad(reader, dayOffset, error));
      return () => {
        disposed = true;
      };
    }

    Promise.resolve(pending).then(
      (data) => {
        if (isCurrent()) setLoad(successLoad(reader, dayOffset, data));
      },
      (error: unknown) => {
        if (isCurrent()) setLoad(errorLoad(reader, dayOffset, error));
      },
    );

    return () => {
      disposed = true;
    };
  }, [dayOffset, reader, reloadVersion]);

  const visibleLoad =
    load.reader === reader && load.dayOffset === dayOffset ? load : loadingLoad(reader, dayOffset);
  const data = visibleLoad.data;
  const events = data?.events ?? [];

  return {
    status: visibleLoad.status === "success" && events.length === 0 ? "empty" : visibleLoad.status,
    data,
    events,
    error: visibleLoad.error,
    reload,
    goToPreviousDay: () => changeDay(-1),
    goToNextDay: () => changeDay(1),
    findEvent: (id) => events.find((event) => event.id === id) ?? null,
  };
}
