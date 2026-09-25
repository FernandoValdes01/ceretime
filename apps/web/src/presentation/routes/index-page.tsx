import { useEffect } from "react";
import { GENERIC_AUTH_MESSAGES } from "../../application/session/institutional-login.ts";
import { isBackendConfigured } from "../../infrastructure/convex/convex-client.ts";
import { AuthScreen } from "../auth/AuthScreen.tsx";
import type { WebSessionState } from "../session/session-state.ts";
import { useNavigateToPath } from "./navigation.ts";
import { consumeReturnTarget } from "./return-target.ts";

/**
 * Índice `/` (TI2-6).
 *
 * Sin sesión muestra el acceso institucional para preservar intactos el
 * `callbackURL` y el `errorCallbackURL` de TI2-3/TI2-14. Con sesión deriva
 * al portal del Estudiante (consumiendo el retorno conservado), o a
 * denegado para otra población sin portal en Sprint 1.
 */
export function IndexPage({ session }: { session: WebSessionState }) {
  const navigateToPath = useNavigateToPath();

  useEffect(() => {
    if (session === undefined || session.status === "unauthenticated") {
      return;
    }
    if (session.population !== "estudiante") {
      navigateToPath("/denegado");
      return;
    }
    navigateToPath(consumeReturnTarget() ?? "/estudiante");
  }, [session, navigateToPath]);

  // Sin backend la sesión nunca resuelve: se muestra el acceso, que ya
  // contiene el estado explícito de configuración faltante, en vez de un
  // "Cargando…" indefinido que oculta el problema.
  if (!isBackendConfigured) {
    return <AuthScreen />;
  }
  if (session === undefined) {
    return <p role="status">{GENERIC_AUTH_MESSAGES.loading}</p>;
  }
  if (session.status === "unauthenticated") {
    return <AuthScreen />;
  }
  return <p role="status">{GENERIC_AUTH_MESSAGES.loading}</p>;
}
