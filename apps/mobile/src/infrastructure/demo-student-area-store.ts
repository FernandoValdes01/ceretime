import type { StudentRequest } from "../domain/student-area-models";
import type { Accompaniment } from "../domain/request-models";

export interface DemoStudentAreaStore {
  nextRequestId(): string;
  addRequest(request: StudentRequest): void;
  readRequests(): readonly StudentRequest[];
  updateRequest(request: StudentRequest): void;
  addAccompaniment(accompaniment: Accompaniment): void;
  readAccompaniments(): readonly Accompaniment[];
  reset(): void;
  subscribe(onChange: () => void): () => void;
}

// Almacén en memoria que comparten el formulario del Estudiante y su lector de demostración.
export function createDemoStudentAreaStore(lastExampleRequestNumber = 5): DemoStudentAreaStore {
  let lastRequestNumber = lastExampleRequestNumber;
  let requests: StudentRequest[] = [];
  let accompaniments: Accompaniment[] = [];
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
    updateRequest(request) {
      requests = requests.map((current) => (current.id === request.id ? request : current));
      listeners.forEach((listener) => listener());
    },
    addAccompaniment(accompaniment) {
      if (accompaniments.some((current) => current.id === accompaniment.id)) return;
      accompaniments = [...accompaniments, accompaniment];
      listeners.forEach((listener) => listener());
    },
    readAccompaniments() {
      return accompaniments;
    },
    reset() {
      lastRequestNumber = lastExampleRequestNumber;
      requests = [];
      accompaniments = [];
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
