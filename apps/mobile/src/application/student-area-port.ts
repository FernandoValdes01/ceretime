import type {
  StudentAreaSnapshot,
  StudentRequestSubmissionReceipt,
  SubmitStudentRequestCommand,
} from "./student-area-models";

/**
 * Small, replaceable application capability for the isolated student-area
 * example. Infrastructure implements it; this port has no React or transport
 * dependency.
 */
export interface StudentAreaReader {
  readStudentArea(): Promise<StudentAreaSnapshot>;
}

/** Replaceable capability for the provisional student-request submission. */
export interface StudentRequestSubmitter {
  submitStudentRequest(
    command: SubmitStudentRequestCommand,
  ): Promise<StudentRequestSubmissionReceipt>;
}
