import { createContext, useContext, type PropsWithChildren } from "react";

import type { ProfessionalReviewPort } from "@/application/professional-review-port";
import {
  useProfessionalReview,
  type ProfessionalReviewState,
} from "@/presentation/hooks/use-professional-review";

const ProfessionalReviewContext = createContext<ProfessionalReviewState | null>(null);

export function ProfessionalReviewProvider({
  port,
  children,
}: PropsWithChildren<{ readonly port: ProfessionalReviewPort }>) {
  const state = useProfessionalReview(port);
  return <ProfessionalReviewContext value={state}>{children}</ProfessionalReviewContext>;
}

export function useProfessionalReviewContext(): ProfessionalReviewState {
  const state = useContext(ProfessionalReviewContext);
  if (!state) {
    throw new Error("Las pantallas profesionales necesitan ProfessionalReviewProvider.");
  }
  return state;
}
