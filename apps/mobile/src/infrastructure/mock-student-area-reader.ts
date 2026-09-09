import type { StudentAreaReader } from '../application/student-area-port';
import { fictionalStudentArea } from './mock-student-area-data';

/** Demo adapter only; replace with a TI2-backed adapter later. */
export function createMockStudentAreaReader(): StudentAreaReader {
  return {
    async readStudentArea() {
      return fictionalStudentArea;
    },
  };
}
