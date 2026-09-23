import {
  createMockAuthenticationPort,
  mockAuthCredentials,
  unassignedPractitionerCredentials,
} from "../infrastructure/mock-authentication";
import { createMockAdministratorAccountsAdapter } from "../infrastructure/mock-administrator-accounts-adapter";
import { createMockProfessionalAgendaReader } from "../infrastructure/mock-professional-agenda-reader";
import { createMockProfessionalReviewAdapter } from "../infrastructure/mock-professional-review-adapter";

export const mobileDependencies = {
  administratorAccountsPort: createMockAdministratorAccountsAdapter(),
  authPort: createMockAuthenticationPort(),
  demoCredentials: mockAuthCredentials,
  unassignedPractitionerCredentials,
  professionalAgendaReader: createMockProfessionalAgendaReader(),
  professionalReviewPort: createMockProfessionalReviewAdapter(),
} as const;
