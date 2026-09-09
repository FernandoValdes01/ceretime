import type { StudentAreaSnapshot } from './student-area-models';

/**
 * Small, replaceable application capability for the isolated student-area
 * example. Infrastructure implements it; this port has no React or transport
 * dependency.
 */
export interface StudentAreaReader {
  readStudentArea(): Promise<StudentAreaSnapshot>;
}
