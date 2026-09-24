import { useEffect } from "react";
import { GENERIC_AUTH_MESSAGES } from "../../application/session/institutional-login.ts";
import { isBackendConfigured } from "../../infrastructure/convex/convex-client.ts";
import { AuthScreen } from "../auth/AuthScreen.tsx";
import type { WebSessionRole, WebSessionState } from "../session/session-state.ts";
import { useNavigateToPath } from "./navigation.ts";
import { consumeReturnTarget } from "./return-target.ts";
import { staffHomeForRole } from "./staff-portal-roles.ts";

/**
 * Índice `/` (TI2-6, TI2-20).
 *
 * Sin sesión muestra el acceso institucional para preservar intactos el
 * `callbackURL` y el `errorCallbackURL` de TI2-3/TI2-14. Con sesión deriva
 * al portal del Estudiante (consumiendo el retorno conservado) o al portal
 * del rol del personal; sin rol conocido va a denegado.
 */
export function IndexPage({ session, role }: { session: WebSessionState; role: WebSessionRole }) {
  const navigateToPath = useNavigateToPath();

  useEffect(() => {
    if (session === undefined || session.status === "unauthenticated") {
      return;
    }
    if (session.population !== "estudiante") {
      // Espera el rol antes de derivar: sin perfil no hay portal conocido.
      if (role === undefined) {
        return;
      }
      const home =
        role.status === "authenticated"
          ? (staffHomeForRole(role.role) ?? "/denegado")
          : "/denegado";
      navigateToPath(home);
      return;
    }
    navigateToPath(consumeReturnTarget() ?? "/estudiante");
  }, [session, role, navigateToPath]);

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
