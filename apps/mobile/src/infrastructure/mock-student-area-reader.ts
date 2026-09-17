import type { StudentAreaReader } from "../application/student-area-port";
import { fictionalStudentArea } from "./mock-student-area-data";

export type MockStudentAreaMode = "success" | "empty" | "error";

export interface MockStudentAreaReaderOptions {
  readonly delayMs?: number;
  readonly mode?: MockStudentAreaMode;
}

/** Demo adapter only; replace with a TI2-backed adapter later. */
export function createMockStudentAreaReader({
  delayMs = 0,
  mode = "success",
}: MockStudentAreaReaderOptions = {}): StudentAreaReader {
  return {
    async readStudentArea() {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      if (mode === "error") {
        throw new Error("Falla simulada al cargar las solicitudes");
      }

      if (mode === "empty") {
        return { ...fictionalStudentArea, requests: [], accompaniments: [] };
      }

      return fictionalStudentArea;
    },
  };
}
