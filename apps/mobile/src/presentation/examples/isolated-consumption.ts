import type { ReactElement } from "react";

import { createMockStudentAreaReader } from "../../infrastructure/mock-student-area-reader";
import { renderStudentAreaExample } from "./StudentAreaExample";

/**
 * Isolated evidence of the intended wiring. This helper is not an app
 * entrypoint: a future composition root can replace the mock with a TI2
 * adapter while the presentational example remains unchanged.
 */
export function renderIsolatedStudentAreaExample(): Promise<ReactElement> {
  return renderStudentAreaExample(createMockStudentAreaReader());
}
