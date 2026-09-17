import { createContext, useContext, type PropsWithChildren } from "react";

import type { StudentAreaReader } from "@/application/student-area-port";
import { useStudentArea, type StudentAreaState } from "@/presentation/hooks/useStudentArea";

const StudentAreaContext = createContext<StudentAreaState | null>(null);

export interface StudentAreaProviderProps extends PropsWithChildren {
  readonly reader: StudentAreaReader;
}

export function StudentAreaProvider({ reader, children }: StudentAreaProviderProps) {
  const state = useStudentArea(reader);
  return <StudentAreaContext value={state}>{children}</StudentAreaContext>;
}

export function useStudentAreaContext(): StudentAreaState {
  const state = useContext(StudentAreaContext);
  if (!state) {
    throw new Error("Las pantallas de solicitudes necesitan StudentAreaProvider.");
  }
  return state;
}
