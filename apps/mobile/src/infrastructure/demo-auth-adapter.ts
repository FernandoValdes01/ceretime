import type {
  AuthCredentials,
  AuthRole,
  AuthSession,
  AuthenticatedUser,
} from "../domain/auth-models";
import type { AuthPort } from "../application/auth-port";
import { LocalOperationError } from "../domain/operation-error";
import { demoInternAccompanimentsByIntern } from "./demo-intern-accompaniment-data";

export const demoAuthCredentials = {
  estudiante: { email: "estudiante@cereti.test", password: "cereti-demo" },
  profesional: { email: "profesional@cereti.test", password: "cereti-demo" },
  practicante: { email: "practicante@cereti.test", password: "cereti-demo" },
  administrador: { email: "administrador@cereti.test", password: "cereti-demo" },
} as const satisfies Readonly<Record<AuthRole, AuthCredentials>>;

export const unassignedInternCredentials = {
  email: "practicante-sin-asignacion@cereti.test",
  password: "cereti-demo",
} as const satisfies AuthCredentials;

const demoUsers: readonly {
  readonly credentials: AuthCredentials;
  readonly user: AuthenticatedUser;
}[] = [
  {
    credentials: demoAuthCredentials.estudiante,
    user: {
      id: "demo-student-1",
      displayName: "Valentina Rojas",
      email: demoAuthCredentials.estudiante.email,
      role: "estudiante",
      assignedAccompaniments: [],
    },
  },
  {
    credentials: demoAuthCredentials.profesional,
    user: {
      id: "demo-professional-1",
      displayName: "Sam Profesional",
      email: demoAuthCredentials.profesional.email,
      role: "profesional",
      assignedAccompaniments: [],
    },
  },
  {
    credentials: demoAuthCredentials.practicante,
    user: {
      id: "demo-intern-assigned-1",
      displayName: "Rocío Practicante",
      email: demoAuthCredentials.practicante.email,
      role: "practicante",
      assignedAccompaniments: demoInternAccompanimentsByIntern["demo-intern-assigned-1"].map(
        ({ id, objective }) => ({ id, title: objective }),
      ),
    },
  },
  {
    credentials: unassignedInternCredentials,
    user: {
      id: "demo-intern-unassigned-1",
      displayName: "Practicante sin asignación",
      email: unassignedInternCredentials.email,
      role: "practicante",
      assignedAccompaniments: [],
    },
  },
  {
    credentials: demoAuthCredentials.administrador,
    user: {
      id: "demo-administrator-1",
      displayName: "Pat Administrador",
      email: demoAuthCredentials.administrador.email,
      role: "administrador",
      assignedAccompaniments: [],
    },
  },
];

export class DemoAuthenticationError extends LocalOperationError {
  constructor() {
    super("Correo o contraseña incorrectos.");
    this.name = "DemoAuthenticationError";
  }
}

export function createDemoAuthAdapter(): AuthPort {
  return {
    async login(credentials) {
      const account = demoUsers.find(
        ({ credentials: expected }) =>
          expected.email === credentials.email.trim().toLowerCase() &&
          expected.password === credentials.password,
      );

      if (!account) {
        throw new DemoAuthenticationError();
      }

      return { user: account.user } satisfies AuthSession;
    },
    async logout() {
      // La sesión vive únicamente en el provider; este adapter no persiste nada.
    },
  };
}
