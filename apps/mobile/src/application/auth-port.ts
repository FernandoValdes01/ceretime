import type { AuthCredentials, AuthSession, InstitutionalPopulation } from "../domain/auth-models";

// Ingreso local con datos ficticios (`createDemoAuthAdapter`); no persiste nada fuera del provider.
export interface DemoAuthPort {
  login(credentials: AuthCredentials): Promise<AuthSession>;
  logout(session: AuthSession | null): Promise<void>;
}

// Ingreso real con la cuenta institucional. El servidor decide el rol y la sesión sobrevive al cierre de la app.
export interface InstitutionalAuthPort {
  /** Sesión guardada en el dispositivo; `null` si no existe o el servidor ya no la reconoce. */
  restoreSession(): Promise<AuthSession | null>;
  /** `null` cuando la persona cancela o el proveedor no entrega una sesión válida. */
  signInInstitutional(population: InstitutionalPopulation): Promise<AuthSession | null>;
  logout(session: AuthSession | null): Promise<void>;
}

export type AuthPort = DemoAuthPort | InstitutionalAuthPort;

export function isInstitutionalAuthPort(port: AuthPort): port is InstitutionalAuthPort {
  return "signInInstitutional" in port;
}
