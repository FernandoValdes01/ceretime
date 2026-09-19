import { createContext, useContext, type PropsWithChildren } from "react";

import type { ProfessionalAgendaReader } from "@/application/professional-agenda-port";
import {
  useProfessionalAgenda,
  type ProfessionalAgendaState,
} from "@/presentation/hooks/use-professional-agenda";

const ProfessionalAgendaContext = createContext<ProfessionalAgendaState | null>(null);

export function ProfessionalAgendaProvider({
  reader,
  children,
}: PropsWithChildren<{ readonly reader: ProfessionalAgendaReader }>) {
  const state = useProfessionalAgenda(reader);
  return <ProfessionalAgendaContext value={state}>{children}</ProfessionalAgendaContext>;
}

export function useProfessionalAgendaContext() {
  const state = useContext(ProfessionalAgendaContext);
  if (!state) {
    throw new Error("Las pantallas profesionales necesitan ProfessionalAgendaProvider.");
  }
  return state;
}
