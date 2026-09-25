import { useEffect } from "react";
import { GENERIC_AUTH_MESSAGES } from "../../application/session/institutional-login.ts";
import { isBackendConfigured } from "../../infrastructure/convex/convex-client.ts";
import { AuthScreen } from "../auth/AuthScreen.tsx";
import type { WebSessionAndRole, WebSessionState } from "../session/session-state.ts";
import { useNavigateToPath } from "./navigation.ts";
import { consumeReturnTarget } from "./return-target.ts";
import { isPairCurrent, staffHomeForRole } from "./staff-portal-roles.ts";

/**
 * Índice `/` (TI2-6, TI2-20).
 *
 * Sin sesión muestra el acceso institucional para preservar intactos el
 * `callbackURL` y el `errorCallbackURL` de TI2-3/TI2-14. Con sesión deriva
 * al portal del Estudiante (consumiendo el retorno conservado) o al portal
 * del rol del personal; sin rol conocido va a denegado.
 */
export function IndexPage({
  session,
  pair,
}: {
  session: WebSessionState;
  pair: WebSessionAndRole;
}) {
  const navigateToPath = useNavigateToPath();

  useEffect(() => {
    if (session === undefined || pair === undefined) {
      return;
    }
    if (session.status === "unauthenticated") {
      return;
    }
    // Espera la confirmación antes de derivar a cualquier portal: con el
    // par de otra sesión aún en memoria se consumiría el retorno en vano y
    // se navegaría al portal anterior.
    if (!isPairCurrent(session, pair)) {
      return;
    }
    // Deriva por rol del perfil: el personal va a su portal aunque su
    // correo sea de estudiante; la población sola no decide. Sin perfil se
    // mantiene la regla por población de TI2-6.
    const role = pair.role;
    if (role.status === "authenticated" && role.role !== "student") {
      const home = staffHomeForRole(role.role);
      if (home === null) {
        navigateToPath("/denegado");
        return;
      }
      navigateToPath(consumeReturnTarget() ?? home);
      return;
    }
    if (session.population !== "estudiante") {
      navigateToPath("/denegado");
      return;
    }
    navigateToPath(consumeReturnTarget() ?? "/estudiante");
  }, [session, pair, navigateToPath]);

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
