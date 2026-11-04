import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

import type { AuthCredentials, AuthRole, AuthSession } from "../../application/auth-models";
import type { AuthPort } from "../../application/auth-port";
import { toMobileOperationError } from "../to-mobile-operation-error";

export type SessionStatus = "unauthenticated" | "loading" | "authenticated" | "error";

type NavigationSession = {
  readonly session: AuthSession | null;
  readonly role: AuthRole | null;
  readonly status: SessionStatus;
  readonly error: string | null;
  readonly accessDeniedRole: AuthRole | null;
  readonly signIn: (credentials: AuthCredentials) => Promise<boolean>;
  readonly signOut: () => Promise<boolean>;
  /** Acceso al selector de roles del prototipo simulado. */
  readonly selectRole: (role: AuthRole) => Promise<boolean>;
  readonly clearError: () => void;
  readonly recordAccessDenied: (role: AuthRole) => void;
  readonly dismissAccessDenied: () => void;
};

type SessionState = Pick<NavigationSession, "session" | "status" | "error" | "accessDeniedRole"> & {
  readonly port: AuthPort;
};

function initialSession(port: AuthPort): SessionState {
  return { port, session: null, status: "unauthenticated", error: null, accessDeniedRole: null };
}

const SessionContext = createContext<NavigationSession | null>(null);

export function NavigationSessionProvider({
  children,
  authPort,
  demoCredentials,
}: PropsWithChildren<{
  readonly authPort: AuthPort;
  readonly demoCredentials: Readonly<Record<AuthRole, AuthCredentials>>;
}>) {
  const [state, setState] = useState(() => initialSession(authPort));
  const current = state.port === authPort ? state : initialSession(authPort);
  // Registrar la nueva fuente impide recuperar una sesión descartada al volver a la anterior.
  if (state.port !== authPort) setState(current);
  const operation = useRef(0);
  const pendingOperation = useRef<"login" | "logout" | null>(null);
  const activePort = useRef<AuthPort | null>(authPort);

  useEffect(() => {
    activePort.current = authPort;
    return () => {
      activePort.current = null;
      operation.current += 1;
      pendingOperation.current = null;
    };
  }, [authPort]);

  const signIn = useCallback(
    async (credentials: AuthCredentials) => {
      if (activePort.current !== authPort || pendingOperation.current) return false;
      const operationId = ++operation.current;
      pendingOperation.current = "login";
      setState((previous) => ({ ...previous, status: "loading", error: null }));
      try {
        const nextSession = await authPort.login(credentials);
        if (operation.current !== operationId) return false;
        setState({
          port: authPort,
          session: nextSession,
          status: "authenticated",
          error: null,
          accessDeniedRole: null,
        });
        return true;
      } catch (cause) {
        if (operation.current !== operationId) return false;
        setState({
          ...initialSession(authPort),
          status: "error",
          error: toMobileOperationError(cause, "No fue posible iniciar sesión.").message,
        });
        return false;
      } finally {
        if (operation.current === operationId) pendingOperation.current = null;
      }
    },
    [authPort],
  );

  const signOut = useCallback(async () => {
    if (activePort.current !== authPort || pendingOperation.current) return false;
    const operationId = ++operation.current;
    pendingOperation.current = "logout";
    setState((previous) => ({ ...previous, status: "loading", error: null }));
    try {
      await authPort.logout(current.session);
      if (operation.current !== operationId) return false;
      setState(initialSession(authPort));
      return true;
    } catch (cause) {
      if (operation.current !== operationId) return false;
      setState((previous) => ({
        ...previous,
        status: "error",
        error: toMobileOperationError(cause, "No fue posible cerrar sesión.").message,
      }));
      return false;
    } finally {
      if (operation.current === operationId) pendingOperation.current = null;
    }
  }, [authPort, current.session]);

  const selectRole = useCallback(
    (selectedRole: AuthRole) => signIn(demoCredentials[selectedRole]),
    [demoCredentials, signIn],
  );
  const clearError = useCallback(() => setState((previous) => ({ ...previous, error: null })), []);
  const recordAccessDenied = useCallback((deniedRole: AuthRole) => {
    setState((previous) => ({ ...previous, accessDeniedRole: deniedRole }));
  }, []);
  const dismissAccessDenied = useCallback(
    () => setState((previous) => ({ ...previous, accessDeniedRole: null })),
    [],
  );

  return (
    <SessionContext.Provider
      value={{
        session: current.session,
        role: current.session?.user.role ?? null,
        status: current.status,
        error: current.error,
        accessDeniedRole: current.accessDeniedRole,
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

export function useOptionalNavigationSession() {
  return useContext(SessionContext);
}
