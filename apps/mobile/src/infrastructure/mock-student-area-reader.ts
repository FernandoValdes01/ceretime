import type { StudentAreaReader } from "../application/student-area-port";
import { mapCanonicalStudentArea } from "./ti2-contract-mappers";
import {
  fictionalAccompanimentDetails,
  fictionalStudentAreaResponses,
  fictionalStudentIdentity,
} from "./mock-student-area-data";

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
        return mapCanonicalStudentArea(fictionalStudentIdentity, {
          requests: [],
          accompaniments: [],
        });
      }

      const snapshot = mapCanonicalStudentArea(
        fictionalStudentIdentity,
        fictionalStudentAreaResponses,
      );
      return {
        ...snapshot,
        accompaniments: snapshot.accompaniments.map((accompaniment) => {
          const details = fictionalAccompanimentDetails[accompaniment.id];
          return details ? { ...accompaniment, ...details } : accompaniment;
        }),
      };
    },
  };
}
