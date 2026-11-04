import { useCallback, useState } from "react";

import type {
  ProfessionalAgendaDay,
  ProfessionalAgendaEvent,
} from "../../application/professional-agenda-models";
import type { ProfessionalAgendaReader } from "../../application/professional-agenda-port";

import { useAsyncResource } from "./use-async-resource";
import { toMobileOperationError } from "../to-mobile-operation-error";

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

export function useProfessionalAgenda(reader: ProfessionalAgendaReader): ProfessionalAgendaState {
  const [dayOffset, setDayOffset] = useState(0);
  const read = useCallback(() => reader.readProfessionalAgenda(dayOffset), [reader, dayOffset]);
  const resource = useAsyncResource(read);
  const data = resource.data;
  const events = data?.events ?? [];
  return {
    status: resource.status === "success" && events.length === 0 ? "empty" : resource.status,
    data,
    events,
    error:
      resource.status === "error"
        ? toMobileOperationError(resource.error, "No pudimos cargar la agenda. Intenta nuevamente.")
        : null,
    reload: resource.reload,
    goToPreviousDay: () => setDayOffset((offset) => offset - 1),
    goToNextDay: () => setDayOffset((offset) => offset + 1),
    findEvent: (id) => events.find((event) => event.id === id) ?? null,
  };
}
