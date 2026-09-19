import {
  createMockAuthenticationPort,
  mockAuthCredentials,
  unassignedPractitionerCredentials,
} from "../infrastructure/mock-authentication";
import { createMockProfessionalAgendaReader } from "../infrastructure/mock-professional-agenda-reader";

export const mobileDependencies = {
  authPort: createMockAuthenticationPort(),
  demoCredentials: mockAuthCredentials,
  unassignedPractitionerCredentials,
  professionalAgendaReader: createMockProfessionalAgendaReader(),
} as const;
