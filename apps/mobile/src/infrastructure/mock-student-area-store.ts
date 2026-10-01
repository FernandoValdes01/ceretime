import type { StudentRequest } from "../application/student-area-models";

export interface MockStudentAreaStore {
  nextRequestId(): string;
  addRequest(request: StudentRequest): void;
  readRequests(): readonly StudentRequest[];
  reset(): void;
  subscribe(onChange: () => void): () => void;
}

/** Session-only store that joins the student form and its demo reader. */
export function createMockStudentAreaStore(lastExampleRequestNumber = 5): MockStudentAreaStore {
  let lastRequestNumber = lastExampleRequestNumber;
  let requests: StudentRequest[] = [];
  const listeners = new Set<() => void>();

  return {
    nextRequestId() {
      lastRequestNumber += 1;
      return `SOL-DEMO-${lastRequestNumber.toString().padStart(3, "0")}`;
    },
    addRequest(request) {
      requests = [request, ...requests];
      listeners.forEach((listener) => listener());
    },
    readRequests() {
      return requests;
    },
    reset() {
      lastRequestNumber = lastExampleRequestNumber;
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
