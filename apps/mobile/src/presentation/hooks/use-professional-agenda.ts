import { useCallback, useState } from "react";

import type {
  ProfessionalAgendaDayViewModel,
  ProfessionalAgendaAppointmentViewModel,
} from "../../domain/professional-agenda-view-models";
import type { ProfessionalAgendaReader } from "../../application/professional-agenda-port";

import { useAsyncResource } from "./use-async-resource";
import { toMobileOperationError } from "../to-mobile-operation-error";

export type ProfessionalAgendaStatus = "loading" | "success" | "empty" | "error";

export interface ProfessionalAgendaState {
  readonly status: ProfessionalAgendaStatus;
  readonly data: ProfessionalAgendaDayViewModel | null;
  readonly appointments: readonly ProfessionalAgendaAppointmentViewModel[];
  readonly error: unknown | null;
  readonly reload: () => void;
  readonly goToPreviousDay: () => void;
  readonly goToNextDay: () => void;
  readonly findAppointment: (id: string) => ProfessionalAgendaAppointmentViewModel | null;
}

export function useProfessionalAgenda(reader: ProfessionalAgendaReader): ProfessionalAgendaState {
  const [dayOffset, setDayOffset] = useState(0);
  const read = useCallback(() => reader.readProfessionalAgenda(dayOffset), [reader, dayOffset]);
  const resource = useAsyncResource(read);
  const data = resource.data;
  const appointments = data?.appointments ?? [];
  return {
    status: resource.status === "success" && appointments.length === 0 ? "empty" : resource.status,
    data,
    appointments,
    error:
      resource.status === "error"
        ? toMobileOperationError(resource.error, "No pudimos cargar la agenda. Intenta nuevamente.")
        : null,
    reload: resource.reload,
    goToPreviousDay: () => setDayOffset((offset) => offset - 1),
    goToNextDay: () => setDayOffset((offset) => offset + 1),
    findAppointment: (id) => appointments.find((appointment) => appointment.id === id) ?? null,
  };
}
