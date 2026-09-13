import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
// Provisorio (TI2-3): importa los tipos generados por ruta relativa hasta que
// el monorepo defina el alias o paquete interno compartido.
import { api } from "../../../../../convex/_generated/api";
import {
  GENERIC_AUTH_MESSAGES,
  POPULATION_LOGINS,
  getLoginRequest,
  type InstitutionalPopulation,
} from "../../application/session/institutional-login";
import { authClient } from "../../infrastructure/auth/auth-client";
import { isBackendConfigured } from "../../infrastructure/convex/convex-client";
import "./auth.css";

/** Lee `?auth=error` una sola vez al montar, sin efectos. */
function readInitialNotice(): string | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get("auth") === "error") {
    window.history.replaceState(null, "", window.location.pathname);
    return GENERIC_AUTH_MESSAGES.signInError;
  }
  return null;
}

/**
 * Presentación: acceso institucional y estado de sesión (TI2-3).
 *
 * Solo proveedor, callback y manejo de sesión. Sin roles ni reglas de
 * negocio: la pantalla no decide portales ni permisos. Los mensajes son
 * genéricos y fuera de sesión no se nombra la unidad ni el tipo de apoyo.
 */
export function AuthScreen() {
  const clientSession = authClient.useSession();
  const serverState = useQuery(api.presentation.session.getSessionState);
  const [notice, setNotice] = useState<string | null>(readInitialNotice);
  const [pendingPopulation, setPendingPopulation] = useState<InstitutionalPopulation | null>(null);
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
    setNotice(null);
    try {
      await authClient.signOut();
    } catch {
      setNotice(GENERIC_AUTH_MESSAGES.signOutError);
    }
  }

  const sessionErrorNotice = clientSession.error ? GENERIC_AUTH_MESSAGES.signInError : notice;

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
          onClick={() => void handleSignOut()}
        >
          Cerrar sesión
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
