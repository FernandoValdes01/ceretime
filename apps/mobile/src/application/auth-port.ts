import type { AuthCredentials, AuthSession } from "./auth-models";

/**
 * Boundary for the temporary mobile authentication flow.
 *
 * The current implementation is local and fictional. A future backend adapter
 * can replace it without changing the presentation or navigation layers.
 */
export interface AuthPort {
  login(credentials: AuthCredentials): Promise<AuthSession>;
  logout(session: AuthSession | null): Promise<void>;
}
