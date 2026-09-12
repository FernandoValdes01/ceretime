import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

import type { AuthCredentials, AuthRole, AuthSession } from "../../application/auth-models";
import type { AuthPort } from "../../application/auth-port";
import {
  createMockAuthenticationPort,
  mockAuthCredentials,
} from "../../infrastructure/mock-authentication";
import type { NavigationRole } from "./roles";

export type SessionStatus = "unauthenticated" | "loading" | "authenticated" | "error";

type NavigationSession = {
  readonly session: AuthSession | null;
  readonly role: NavigationRole | null;
  readonly status: SessionStatus;
  readonly error: string | null;
  readonly accessDeniedRole: NavigationRole | null;
  readonly signIn: (credentials: AuthCredentials) => Promise<boolean>;
  readonly signOut: () => Promise<boolean>;
  /** Compatibility helper for the existing role-selector prototype. */
  readonly selectRole: (role: AuthRole) => Promise<boolean>;
  readonly clearError: () => void;
  readonly recordAccessDenied: (role: NavigationRole) => void;
  readonly dismissAccessDenied: () => void;
};

const SessionContext = createContext<NavigationSession | null>(null);
const defaultAuthPort = createMockAuthenticationPort();

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function NavigationSessionProvider({
  children,
  authPort = defaultAuthPort,
}: PropsWithChildren<{ readonly authPort?: AuthPort }>) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState<SessionStatus>("unauthenticated");
  const [error, setError] = useState<string | null>(null);
  const [accessDeniedRole, setAccessDeniedRole] = useState<NavigationRole | null>(null);
  const operation = useRef(0);
  const pendingOperation = useRef<"login" | "logout" | null>(null);

  const signIn = useCallback(
    async (credentials: AuthCredentials) => {
      if (pendingOperation.current) return false;

      const operationId = ++operation.current;
      pendingOperation.current = "login";
      setStatus("loading");
      setError(null);

      try {
        const nextSession = await authPort.login(credentials);
        if (operation.current !== operationId) return false;
        setSession(nextSession);
        setStatus("authenticated");
        setAccessDeniedRole(null);
        return true;
      } catch (cause) {
        if (operation.current !== operationId) return false;
        setSession(null);
        setStatus("error");
        setError(errorMessage(cause, "No fue posible iniciar sesión."));
        return false;
      } finally {
        if (operation.current === operationId) pendingOperation.current = null;
      }
    },
    [authPort],
  );

  const signOut = useCallback(async () => {
    if (pendingOperation.current) return false;

    const operationId = ++operation.current;
    pendingOperation.current = "logout";
    setStatus("loading");
    setError(null);

    try {
      await authPort.logout(session);
      if (operation.current !== operationId) return false;
      setSession(null);
      setStatus("unauthenticated");
      setAccessDeniedRole(null);
      return true;
    } catch (cause) {
      if (operation.current !== operationId) return false;
      setStatus("error");
      setError(errorMessage(cause, "No fue posible cerrar sesión."));
      return false;
    } finally {
      if (operation.current === operationId) pendingOperation.current = null;
    }
  }, [authPort, session]);

  const selectRole = useCallback(
    (selectedRole: AuthRole) => signIn(mockAuthCredentials[selectedRole]),
    [signIn],
  );

  const clearError = useCallback(() => setError(null), []);
  const recordAccessDenied = useCallback((deniedRole: NavigationRole) => {
    setAccessDeniedRole(deniedRole);
  }, []);
  const dismissAccessDenied = useCallback(() => setAccessDeniedRole(null), []);

  return (
    <SessionContext.Provider
      value={{
        session,
        role: session?.user.role ?? null,
        status,
        error,
        accessDeniedRole,
        signIn,
        signOut,
        selectRole,
        clearError,
        recordAccessDenied,
        dismissAccessDenied,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useNavigationSession() {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error("La navegación necesita NavigationSessionProvider.");
  }
  return session;
}
