import {
  createMockAuthenticationPort,
  mockAuthCredentials,
  unassignedPractitionerCredentials,
} from "../infrastructure/mock-authentication";
import { createMockAdministratorAccountsAdapter } from "../infrastructure/mock-administrator-accounts-adapter";
import { createMockProfessionalAgendaReader } from "../infrastructure/mock-professional-agenda-reader";
import { createMockProfessionalReviewAdapter } from "../infrastructure/mock-professional-review-adapter";
import { createMockPractitionerAccompanimentReader } from "../infrastructure/mock-practitioner-accompaniment-reader";

const practitionerDemoMode = process.env.EXPO_PUBLIC_PRACTITIONER_ACCOMPANIMENT_MODE;
const parsedPractitionerDelay = Number.parseInt(
  process.env.EXPO_PUBLIC_PRACTITIONER_ACCOMPANIMENT_DELAY_MS ?? "0",
  10,
);
const practitionerDemoDelay =
  Number.isFinite(parsedPractitionerDelay) && parsedPractitionerDelay > 0
    ? parsedPractitionerDelay
    : 0;

export const mobileDependencies = {
  administratorAccountsPort: createMockAdministratorAccountsAdapter(),
  authPort: createMockAuthenticationPort(),
  demoCredentials: mockAuthCredentials,
  unassignedPractitionerCredentials,
  professionalAgendaReader: createMockProfessionalAgendaReader(),
  professionalReviewPort: createMockProfessionalReviewAdapter(),
  practitionerAccompanimentReader: createMockPractitionerAccompanimentReader({
    delayMs: practitionerDemoDelay,
    mode:
      practitionerDemoMode === "empty" || practitionerDemoMode === "error"
        ? practitionerDemoMode
        : "success",
  }),
} as const;
