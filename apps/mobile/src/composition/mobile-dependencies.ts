import {
  createMockAuthenticationPort,
  mockAuthCredentials,
  unassignedPractitionerCredentials,
} from "../infrastructure/mock-authentication";
import { createMockAdministratorAccountsAdapter } from "../infrastructure/mock-administrator-accounts-adapter";
import { createMockProfessionalAgendaReader } from "../infrastructure/mock-professional-agenda-reader";
import { createMockProfessionalAccompanimentReader } from "../infrastructure/mock-professional-accompaniment-reader";
import { createMockProfessionalAccompanimentStore } from "../infrastructure/mock-professional-accompaniment-data";
import { createMockProfessionalReviewAdapter } from "../infrastructure/mock-professional-review-adapter";
import { createMockPractitionerAccompanimentReader } from "../infrastructure/mock-practitioner-accompaniment-reader";
import { createLocalAccessibilityPreferencesAdapter } from "../infrastructure/local-accessibility-preferences-adapter";

const professionalAccompanimentStore = createMockProfessionalAccompanimentStore();

const practitionerDemoMode = process.env.EXPO_PUBLIC_PRACTITIONER_ACCOMPANIMENT_MODE;
const parsedPractitionerDelay = Number.parseInt(
  process.env.EXPO_PUBLIC_PRACTITIONER_ACCOMPANIMENT_DELAY_MS ?? "0",
  10,
);
const practitionerDemoDelay =
  Number.isFinite(parsedPractitionerDelay) && parsedPractitionerDelay > 0
    ? parsedPractitionerDelay
    : 0;

const professionalAccompanimentDemoMode = process.env.EXPO_PUBLIC_PROFESSIONAL_ACCOMPANIMENT_MODE;
const parsedProfessionalAccompanimentDelay = Number.parseInt(
  process.env.EXPO_PUBLIC_PROFESSIONAL_ACCOMPANIMENT_DELAY_MS ?? "0",
  10,
);
const professionalAccompanimentDemoDelay =
  Number.isFinite(parsedProfessionalAccompanimentDelay) && parsedProfessionalAccompanimentDelay > 0
    ? parsedProfessionalAccompanimentDelay
    : 0;

export const mobileDependencies = {
  accessibilityPreferencesPort: createLocalAccessibilityPreferencesAdapter(),
  administratorAccountsPort: createMockAdministratorAccountsAdapter(),
  authPort: createMockAuthenticationPort(),
  demoCredentials: mockAuthCredentials,
  unassignedPractitionerCredentials,
  professionalAgendaReader: createMockProfessionalAgendaReader(),
  professionalAccompanimentReader: createMockProfessionalAccompanimentReader({
    delayMs: professionalAccompanimentDemoDelay,
    mode:
      professionalAccompanimentDemoMode === "empty" || professionalAccompanimentDemoMode === "error"
        ? professionalAccompanimentDemoMode
        : "success",
    store: professionalAccompanimentStore,
  }),
  professionalReviewPort: createMockProfessionalReviewAdapter({
    accompanimentStore: professionalAccompanimentStore,
  }),
  practitionerAccompanimentReader: createMockPractitionerAccompanimentReader({
    delayMs: practitionerDemoDelay,
    mode:
      practitionerDemoMode === "empty" || practitionerDemoMode === "error"
        ? practitionerDemoMode
        : "success",
  }),
} as const;
