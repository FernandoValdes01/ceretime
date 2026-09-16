import type {
  AuthCredentials,
  AuthRole,
  AuthSession,
  AuthenticatedUser,
} from "../application/auth-models";
import type { AuthPort } from "../application/auth-port";

export const mockAuthCredentials = {
  estudiante: { email: "estudiante@cereti.test", password: "cereti-demo" },
  profesional: { email: "profesional@cereti.test", password: "cereti-demo" },
  practicante: { email: "practicante@cereti.test", password: "cereti-demo" },
  administrador: { email: "administrador@cereti.test", password: "cereti-demo" },
} as const satisfies Readonly<Record<AuthRole, AuthCredentials>>;

export const unassignedPractitionerCredentials = {
  email: "practicante-sin-asignacion@cereti.test",
  password: "cereti-demo",
} as const satisfies AuthCredentials;

const mockUsers: readonly {
  readonly credentials: AuthCredentials;
  readonly user: AuthenticatedUser;
}[] = [
  {
    credentials: mockAuthCredentials.estudiante,
    user: {
      id: "mock-student-1",
      displayName: "Alex Estudiante",
      email: mockAuthCredentials.estudiante.email,
      role: "estudiante",
      assignedAccompaniments: [],
    },
  },
  {
    credentials: mockAuthCredentials.profesional,
    user: {
      id: "mock-professional-1",
      displayName: "Sam Profesional",
      email: mockAuthCredentials.profesional.email,
      role: "profesional",
      assignedAccompaniments: [],
    },
  },
  {
    credentials: mockAuthCredentials.practicante,
    user: {
      id: "mock-practitioner-assigned-1",
      displayName: "Rocío Practicante",
      email: mockAuthCredentials.practicante.email,
      role: "practicante",
      assignedAccompaniments: [{ id: "mock-accompaniment-1", title: "Acompañamiento ficticio" }],
    },
  },
  {
    credentials: unassignedPractitionerCredentials,
    user: {
      id: "mock-practitioner-unassigned-1",
      displayName: "Practicante sin asignación",
      email: unassignedPractitionerCredentials.email,
      role: "practicante",
      assignedAccompaniments: [],
    },
  },
  {
    credentials: mockAuthCredentials.administrador,
    user: {
      id: "mock-administrator-1",
      displayName: "Pat Administrador",
      email: mockAuthCredentials.administrador.email,
      role: "administrador",
      assignedAccompaniments: [],
    },
  },
];

export class MockAuthenticationError extends Error {
  constructor() {
    super("Correo o contraseña incorrectos.");
    this.name = "MockAuthenticationError";
  }
}

export function createMockAuthenticationPort(): AuthPort {
  return {
    async login(credentials) {
      const account = mockUsers.find(
        ({ credentials: expected }) =>
          expected.email === credentials.email.trim().toLowerCase() &&
          expected.password === credentials.password,
      );

      if (!account) {
        throw new MockAuthenticationError();
      }

      return { user: account.user } satisfies AuthSession;
    },
    async logout() {
      // La sesión vive únicamente en el provider; este adapter no persiste nada.
    },
  };
}
