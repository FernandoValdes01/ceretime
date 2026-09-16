import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
// Provisorio (TI2-3): importa los tipos generados por ruta relativa hasta que
// el monorepo defina el alias o paquete interno compartido.
import { api } from "../../../../../convex/_generated/api";
import {
  GENERIC_AUTH_MESSAGES,
  POPULATION_LOGINS,
  getLoginRequest,
  readAuthErrorNotice,
  removeAuthErrorParams,
  type InstitutionalPopulation,
} from "../../application/session/institutional-login";
import { authClient } from "../../infrastructure/auth/auth-client";
import { isBackendConfigured } from "../../infrastructure/convex/convex-client";
import "./auth.css";

/** Lee el aviso inicial de error una sola vez al montar (TI2-14). Retira solo los parámetros de auth sin exponer el motivo ni borrar el resto de la URL. */
function readInitialNotice(): string | null {
  const notice = readAuthErrorNotice(window.location.search);
  if (notice !== null) {
    window.history.replaceState(
      null,
      "",
      window.location.pathname +
        removeAuthErrorParams(window.location.search) +
        window.location.hash,
    );
  }
  return notice;
}

/**
 * Presentación: acceso institucional, cierre de sesión y estado de sesión (TI2-3, TI2-14).
 *
 * Solo proveedor, callback, logout y manejo de sesión. Sin roles ni reglas de
 * negocio: la pantalla no decide portales ni permisos. Los mensajes son
 * genéricos y fuera de sesión no se nombra la unidad ni el tipo de apoyo.
 */
export function AuthScreen() {
  const clientSession = authClient.useSession();
  const serverState = useQuery(api.presentation.session.getSessionState);
  const [notice, setNotice] = useState<string | null>(readInitialNotice);
  const [pendingPopulation, setPendingPopulation] = useState<InstitutionalPopulation | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [prevServerStatus, setPrevServerStatus] = useState<
    "authenticated" | "unauthenticated" | undefined
  >(undefined);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const serverStatus = serverState?.status;
  const signedIn = serverStatus === "authenticated";

  // Sesión expirada: el servidor dejó de reconocer una sesión que existía.
  // Ajuste durante el render (patrón documentado de React), sin efectos.
  if (serverStatus !== prevServerStatus) {
    setPrevServerStatus(serverStatus);
    if (prevServerStatus === "authenticated" && serverStatus === "unauthenticated") {
      setPendingPopulation(null);
      setNotice(GENERIC_AUTH_MESSAGES.sessionExpired);
    }
  }

  const isLoading =
    isBackendConfigured && !signedIn && (clientSession.isPending || serverState === undefined);

  useEffect(() => {
    headingRef.current?.focus();
  }, [signedIn, isLoading]);

  async function handleSignIn(population: InstitutionalPopulation) {
    setPendingPopulation(population);
    setNotice(null);
    // `onError` + `catch`: si el flujo no redirige (fallo de red o rechazo
    // del servidor), los botones se liberan y se muestra el mensaje genérico.
    const reset = () => {
      setNotice(GENERIC_AUTH_MESSAGES.signInError);
      setPendingPopulation(null);
    };
    try {
      await authClient.signIn.social(getLoginRequest(), {
        onError: reset,
      });
    } catch {
      reset();
    }
  }

  async function handleSignOut() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setNotice(null);
    try {
      // Invalida la sesión en Better Auth; la verdad autoritativa vuelve a ser
      // `unauthenticated` en `getSessionState` y la pantalla retorna al acceso.
      // El cliente resuelve `{data, error}` sin lanzar ante un fallo de API,
      // por lo que un rechazo debe leerse en el resultado y no solo en `catch`.
      const result = await authClient.signOut();
      if (result?.error) {
        setNotice(GENERIC_AUTH_MESSAGES.signOutError);
      } else {
        setPendingPopulation(null);
      }
    } catch {
      setNotice(GENERIC_AUTH_MESSAGES.signOutError);
    } finally {
      setIsSigningOut(false);
    }
  }

  // El aviso explícito (expiración o error de callback) manda sobre el error
  // genérico del cliente para no ocultar la recuperación fallida ni filtrar motivos.
  const sessionErrorNotice =
    notice ?? (clientSession.error ? GENERIC_AUTH_MESSAGES.signInError : null);

  if (!isBackendConfigured) {
    return (
      <section className="auth-card" aria-labelledby="auth-title">
        <h1 id="auth-title" ref={headingRef} tabIndex={-1}>
          Acceso institucional
        </h1>
        <p role="alert">{GENERIC_AUTH_MESSAGES.misconfigured}</p>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className="auth-card" aria-labelledby="auth-title">
        <h1 id="auth-title" ref={headingRef} tabIndex={-1}>
          Acceso institucional
        </h1>
        <p role="status">{GENERIC_AUTH_MESSAGES.loading}</p>
      </section>
    );
  }

  if (signedIn && serverState?.status === "authenticated") {
    return (
      <section className="auth-card" aria-labelledby="auth-title">
        <h1 id="auth-title" ref={headingRef} tabIndex={-1}>
          Sesión iniciada
        </h1>
        <p>
          Conectado como <strong>{serverState.name || serverState.email}</strong>
        </p>
        <p className="auth-email">{serverState.email}</p>
        {sessionErrorNotice ? <p role="alert">{sessionErrorNotice}</p> : null}
        <button
          type="button"
          className="auth-button auth-button--primary auth-button--block"
          disabled={isSigningOut}
          aria-busy={isSigningOut}
          onClick={() => void handleSignOut()}
        >
          {isSigningOut ? GENERIC_AUTH_MESSAGES.loading : "Cerrar sesión"}
        </button>
      </section>
    );
  }

  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <h1 id="auth-title" ref={headingRef} tabIndex={-1}>
        Acceso institucional
      </h1>
      <p>Usa tu cuenta institucional de Google para continuar.</p>
      {sessionErrorNotice ? <p role="alert">{sessionErrorNotice}</p> : null}
      <div className="auth-actions">
        {POPULATION_LOGINS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="auth-button auth-button--primary"
            disabled={pendingPopulation !== null}
            aria-busy={pendingPopulation === entry.id}
            onClick={() => void handleSignIn(entry.id)}
          >
            {pendingPopulation === entry.id ? GENERIC_AUTH_MESSAGES.loading : entry.buttonLabel}
          </button>
        ))}
      </div>
    </section>
  );
}
