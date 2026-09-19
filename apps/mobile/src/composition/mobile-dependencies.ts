import {
  createMockAuthenticationPort,
  mockAuthCredentials,
  unassignedPractitionerCredentials,
} from "../infrastructure/mock-authentication";
import { createMockProfessionalAgendaReader } from "../infrastructure/mock-professional-agenda-reader";
import { createMockProfessionalReviewAdapter } from "../infrastructure/mock-professional-review-adapter";

export const mobileDependencies = {
  authPort: createMockAuthenticationPort(),
  demoCredentials: mockAuthCredentials,
  unassignedPractitionerCredentials,
  professionalAgendaReader: createMockProfessionalAgendaReader(),
  professionalReviewPort: createMockProfessionalReviewAdapter(),
} as const;
