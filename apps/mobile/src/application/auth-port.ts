import type { AuthCredentials, AuthSession } from "./auth-models";

// Puerto del inicio de sesión. Hoy lo implementa `createDemoAuthAdapter`, local y ficticio; un adaptador
// real puede reemplazarlo sin tocar la presentación ni la navegación.
export interface AuthPort {
  login(credentials: AuthCredentials): Promise<AuthSession>;
  logout(session: AuthSession | null): Promise<void>;
}
