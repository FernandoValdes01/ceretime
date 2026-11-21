import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

import type {
  AuthCredentials,
  AuthRole,
  AuthSession,
  InstitutionalPopulation,
} from "../../domain/auth-models";
import { isInstitutionalAuthPort, type AuthPort } from "../../application/auth-port";
import { toMobileOperationError } from "../to-mobile-operation-error";

export type SessionStatus = "unauthenticated" | "loading" | "authenticated" | "error";

// El navegador vuelve igual si la persona cancela o Google rechaza la cuenta; no hay un motivo que mostrar.
const institutionalSignInIncompleteMessage =
  "No se completó el ingreso. Puedes intentarlo de nuevo con tu cuenta @alu.uct.cl o @uct.cl.";

type NavigationSession = {
  readonly session: AuthSession | null;
  readonly role: AuthRole | null;
  readonly status: SessionStatus;
  readonly error: string | null;
  readonly accessDeniedRole: AuthRole | null;
  /** Verdadero mientras la app consulta al servidor si la sesión guardada sigue vigente. */
  readonly isRestoring: boolean;
  readonly signIn: (credentials: AuthCredentials) => Promise<boolean>;
  readonly signInInstitutional: (population: InstitutionalPopulation) => Promise<boolean>;
  readonly signOut: () => Promise<boolean>;
  /** Acceso al selector de roles del prototipo simulado. */
  readonly selectRole: (role: AuthRole) => Promise<boolean>;
  readonly clearError: () => void;
  readonly recordAccessDenied: (role: AuthRole) => void;
  readonly dismissAccessDenied: () => void;
};

type SessionState = Pick<
  NavigationSession,
  "session" | "status" | "error" | "accessDeniedRole" | "isRestoring"
> & {
  readonly port: AuthPort;
};

// Solo el ingreso institucional guarda sesión en el dispositivo y necesita recuperarla al abrir.
function initialSession(port: AuthPort): SessionState {
  return {
    port,
    session: null,
    status: "unauthenticated",
    error: null,
    accessDeniedRole: null,
    isRestoring: isInstitutionalAuthPort(port),
  };
}

const SessionContext = createContext<NavigationSession | null>(null);

// Guarda la sesión actual y expone iniciar/cerrar sesión a toda la app.
// `operation` descarta respuestas de un intento anterior y `pendingOperation` impide dos a la vez.
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
  const pendingOperation = useRef<"restore" | "login" | "logout" | null>(null);
  const activePort = useRef<AuthPort | null>(authPort);

  useEffect(() => {
    activePort.current = authPort;
    let operationId = 0;
    if (isInstitutionalAuthPort(authPort)) {
      operationId = ++operation.current;
      pendingOperation.current = "restore";
      authPort.restoreSession().then(
        (restored) => {
          if (operation.current !== operationId) return;
          pendingOperation.current = null;
          setState({
            ...initialSession(authPort),
            isRestoring: false,
            session: restored,
            status: restored ? "authenticated" : "unauthenticated",
          });
        },
        (cause) => {
          if (operation.current !== operationId) return;
          pendingOperation.current = null;
          setState({
            ...initialSession(authPort),
            isRestoring: false,
            status: "error",
            error: toMobileOperationError(cause, "No fue posible recuperar tu sesión.").message,
          });
        },
      );
    }
    return () => {
      activePort.current = null;
      operation.current += 1;
      pendingOperation.current = null;
    };
  }, [authPort]);

  // Un solo intento a la vez; `signIn` devuelve `null` cuando la persona no completó el ingreso.
  const runSignIn = useCallback(
    async (signIn: () => Promise<AuthSession | null>) => {
      if (activePort.current !== authPort || pendingOperation.current) return false;
      const operationId = ++operation.current;
      pendingOperation.current = "login";
      setState((previous) => ({ ...previous, status: "loading", error: null }));
      try {
        const nextSession = await signIn();
        if (operation.current !== operationId) return false;
        if (!nextSession) {
          setState({
            ...initialSession(authPort),
            isRestoring: false,
            status: "error",
            error: institutionalSignInIncompleteMessage,
          });
          return false;
        }
        setState({
          ...initialSession(authPort),
          isRestoring: false,
          session: nextSession,
          status: "authenticated",
        });
        return true;
      } catch (cause) {
        if (operation.current !== operationId) return false;
        setState({
          ...initialSession(authPort),
          isRestoring: false,
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

  const signIn = useCallback(
    async (credentials: AuthCredentials) =>
      isInstitutionalAuthPort(authPort) ? false : runSignIn(() => authPort.login(credentials)),
    [authPort, runSignIn],
  );

  const signInInstitutional = useCallback(
    async (population: InstitutionalPopulation) =>
      isInstitutionalAuthPort(authPort)
        ? runSignIn(() => authPort.signInInstitutional(population))
        : false,
    [authPort, runSignIn],
  );

  const signOut = useCallback(async () => {
    if (activePort.current !== authPort || pendingOperation.current) return false;
    const operationId = ++operation.current;
    pendingOperation.current = "logout";
    setState((previous) => ({ ...previous, status: "loading", error: null }));
    try {
      await authPort.logout(current.session);
      if (operation.current !== operationId) return false;
      setState({ ...initialSession(authPort), isRestoring: false });
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
        isRestoring: current.isRestoring,
        signIn,
        signInInstitutional,
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
