import type { StudentRequest } from "../application/student-area-models";

export interface MockStudentAreaStore {
  nextRequestId(): string;
  addRequest(request: StudentRequest): void;
  readRequests(): readonly StudentRequest[];
  reset(): void;
  subscribe(onChange: () => void): () => void;
}

/** Session-only store that joins the student form and its demo reader. */
export function createMockStudentAreaStore(initialRequestCount = 5): MockStudentAreaStore {
  let sequence = initialRequestCount;
  let requests: StudentRequest[] = [];
  const listeners = new Set<() => void>();

  return {
    nextRequestId() {
      sequence += 1;
      return `SOL-DEMO-${sequence.toString().padStart(3, "0")}`;
    },
    addRequest(request) {
      requests = [request, ...requests];
      listeners.forEach((listener) => listener());
    },
    readRequests() {
      return requests;
    },
    reset() {
      sequence = initialRequestCount;
      requests = [];
      listeners.forEach((listener) => listener());
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
  };
}

/** Shared only while the app process is running; no request leaves the device. */
export const mockStudentAreaStore = createMockStudentAreaStore();
