import { createContext, useContext, type PropsWithChildren } from "react";

import type { StudentAreaReader, StudentRequestActions } from "@/application/student-area-port";
import { useStudentArea, type StudentAreaState } from "@/presentation/hooks/use-student-area";

const StudentAreaContext = createContext<
  (StudentAreaState & { readonly actions?: StudentRequestActions }) | null
>(null);

export interface StudentAreaProviderProps extends PropsWithChildren {
  readonly reader: StudentAreaReader;
  readonly actions?: StudentRequestActions;
}

export function StudentAreaProvider({ reader, actions, children }: StudentAreaProviderProps) {
  const state = useStudentArea(reader);
  return <StudentAreaContext value={{ ...state, actions }}>{children}</StudentAreaContext>;
}

export function useStudentAreaContext(): StudentAreaState & {
  readonly actions?: StudentRequestActions;
} {
  const state = useContext(StudentAreaContext);
  if (!state) {
    throw new Error("Las pantallas de solicitudes necesitan StudentAreaProvider.");
  }
  return state;
}
