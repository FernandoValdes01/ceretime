import { useEffect } from "react";
import { useSearch } from "@tanstack/react-router";
import { GENERIC_AUTH_MESSAGES } from "../../application/session/institutional-login.ts";
import { isBackendConfigured } from "../../infrastructure/convex/convex-client.ts";
import { AuthScreen } from "../auth/AuthScreen.tsx";
import type { WebSessionState } from "../session/session-state.ts";
import { useNavigateToPath } from "./navigation.ts";
import {
  consumeReturnTarget,
  peekReturnTarget,
  persistReturnTarget,
  resolveReturnTarget,
} from "./return-target.ts";

/**
 * Página de acceso (TI2-6, TI2-20).
 *
 * Sin sesión muestra el acceso institucional (el `?auth=error` del retorno
 * OAuth lo sigue leyendo `AuthScreen` como en TI2-14). Con sesión y retorno
 * válido redirige ahí (cualquier población; el guard del destino decide);
 * con sesión ya iniciada y sin retorno muestra el estado de sesión
 * (incluido el cierre).
 */
export function LoginPage({ session }: { session: WebSessionState }) {
  const search = useSearch({ from: "/login" });
  const navigateToPath = useNavigateToPath();

  useEffect(() => {
    persistReturnTarget(search.redirect);
  }, [search.redirect]);

  // Solo redirige con sesión y retorno válido; sin retorno muestra el
  // estado de sesión (incluido el cierre) en vez de expulsar al portal. El
  // retorno guardado solo se consulta sin `?redirect=` en la URL: una visita
  // explícita al acceso no hereda destinos de otra visita.
  const target =
    session?.status === "authenticated"
      ? (resolveReturnTarget(search.redirect) ??
        (search.redirect === undefined ? peekReturnTarget() : null))
      : null;

  useEffect(() => {
    if (target !== null) {
      consumeReturnTarget();
      navigateToPath(target);
    }
  }, [target, navigateToPath]);

  // Sin backend la sesión nunca resuelve: se muestra el acceso, que ya
  // contiene el estado explícito de configuración faltante.
  if (!isBackendConfigured) {
    return <AuthScreen />;
  }
  if (session === undefined || target !== null) {
    return <p role="status">{GENERIC_AUTH_MESSAGES.loading}</p>;
  }
  return <AuthScreen />;
}
