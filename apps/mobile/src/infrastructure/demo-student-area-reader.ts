import type { StudentAreaReader } from "../application/student-area-port";
import { mapBackendStudentArea } from "./backend-contract-mappers";
import type { DemoStudentAreaStore } from "./demo-student-area-store";
import {
  demoAccompanimentDetails,
  demoStudentAreaResponses,
  demoStudentIdentity,
} from "./demo-student-area-data";

export type DemoStudentAreaMode = "success" | "empty" | "error";

export interface DemoStudentAreaReaderOptions {
  readonly delayMs?: number;
  readonly mode?: DemoStudentAreaMode;
  readonly store?: DemoStudentAreaStore;
}

// Adaptador de demostración; se reemplazará por uno conectado al backend de TI2.
export function createDemoStudentAreaReader({
  delayMs = 0,
  mode = "success",
  store,
}: DemoStudentAreaReaderOptions = {}): StudentAreaReader {
  return {
    ...(store ? { subscribe: store.subscribe } : {}),
    async readStudentArea() {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      if (mode === "error") {
        throw new Error("Falla simulada al cargar las solicitudes");
      }

      if (mode === "empty") {
        const snapshot = mapBackendStudentArea(demoStudentIdentity, {
          requests: [],
          accompaniments: [],
        });
        return {
          ...snapshot,
          requests: store?.readRequests() ?? [],
          accompaniments: store?.readAccompaniments() ?? [],
        };
      }

      const snapshot = mapBackendStudentArea(demoStudentIdentity, demoStudentAreaResponses);
      return {
        ...snapshot,
        requests: [...(store?.readRequests() ?? []), ...snapshot.requests],
        accompaniments: [
          ...(store?.readAccompaniments() ?? []),
          ...snapshot.accompaniments.map((accompaniment) => {
            const details = demoAccompanimentDetails[accompaniment.id];
            return details ? { ...accompaniment, ...details } : accompaniment;
          }),
        ],
      };
    },
  };
}
