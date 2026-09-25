import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { GENERIC_AUTH_MESSAGES } from "../../application/session/institutional-login.ts";
import { isBackendConfigured } from "../../infrastructure/convex/convex-client.ts";
import { AuthScreen } from "../auth/AuthScreen.tsx";
import type { WebSessionAndRole, WebSessionState } from "../session/session-state.ts";
import { isPairCurrent, isStaffRole } from "./staff-portal-roles.ts";

/**
 * Guard del portal del Estudiante (TI2-6, TI2-20).
 *
 * Solo mejora la navegación: sin sesión redirige al acceso conservando la
 * ruta pedida, y sin acceso muestra denegado sin exponer contenido
 * protegido. No sustituye la autorización del Backend: cada lectura real la
 * comprueba Convex aunque la interfaz deje pasar.
 *
 * Además de la población, exige el par confirmado y deniega roles del
 * personal: la población se infiere del dominio del correo mientras el rol
 * viene del perfil, así que un staff con correo de estudiante no debe entrar
 * por esta vía. Sin fila de perfil (rol no autenticado) se mantiene el
 * acceso por población de TI2-6.
 *
 * La redirección es imperativa en efecto con dependencias estables, y la
 * ruta de retorno se captura una sola vez al montar: el router actualiza la
 * ubicación de forma optimista al navegar, así que releerla en cada render
 * abortaría la navegación anterior y el ciclo no se asentaría nunca.
 */
export function RequireStudent({
  session,
  pair,
  children,
}: {
  session: WebSessionState;
  pair: WebSessionAndRole;
  children: ReactNode;
}) {
  const href = useRouterState({
    select: (state) => state.location.pathname + state.location.searchStr,
  });
  const navigate = useNavigate();
  const [returnHref] = useState(href);

  useEffect(() => {
    if (session === undefined || pair === undefined) {
      return;
    }
    if (session.status === "unauthenticated") {
      void navigate({ to: "/login", search: { redirect: returnHref }, replace: true });
      return;
    }
    // Espera la confirmación como en el guard del personal: con el par de
    // otra sesión aún en memoria no se decide el acceso.
    if (!isPairCurrent(session, pair)) {
      return;
    }
    if (session.population !== "estudiante" || isStaffRole(pair.role)) {
      void navigate({ to: "/denegado", replace: true });
    }
  }, [session, pair, returnHref, navigate]);

  // Sin backend la sesión nunca resuelve: se muestra el acceso con su
  // estado explícito en vez de un "Cargando…" indefinido. No expone
  // contenido protegido porque el portal nunca llega a renderizarse.
  if (!isBackendConfigured) {
    return <AuthScreen />;
  }
  if (
    session === undefined ||
    pair === undefined ||
    session.status === "unauthenticated" ||
    !isPairCurrent(session, pair) ||
    session.population !== "estudiante" ||
    isStaffRole(pair.role)
  ) {
    return <p role="status">{GENERIC_AUTH_MESSAGES.loading}</p>;
  }
  return <>{children}</>;
}
