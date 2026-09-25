import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { GENERIC_AUTH_MESSAGES } from "../../application/session/institutional-login.ts";
import { isBackendConfigured } from "../../infrastructure/convex/convex-client.ts";
import { AuthScreen } from "../auth/AuthScreen.tsx";
import type { StaffRole, WebSessionRole, WebSessionState } from "../session/session-state.ts";

/**
 * Guard de portal por rol (TI2-20).
 *
 * Solo mejora la navegación: sin sesión redirige al acceso conservando la
 * ruta pedida; con sesión pero sin rol conocido (sin perfil) o con rol no
 * permitido muestra denegado sin exponer contenido protegido. No sustituye
 * la autorización del Backend: cada lectura real la comprueba Convex aunque
 * la interfaz deje pasar.
 *
 * Sesión y rol llegan vinculados al mismo principal en una única respuesta
 * (`getSessionWithRole`): al cambiar de cuenta ambas mitades cambian a la
 * vez y el portal anterior nunca se monta con la sesión nueva. No se
 * comparan correos en el cliente porque el guardado en el perfil puede
 * diferir legítimamente del de la identidad.
 *
 * La redirección es imperativa en efecto con dependencias estables, y la
 * ruta de retorno se captura una sola vez al montar (mismo motivo que en
 * `student-guard.tsx`: releer la ubicación optimista reiniciaría el ciclo).
 */
export function RequireStaffRole({
  session,
  role,
  allowedRoles,
  children,
}: {
  session: WebSessionState;
  role: WebSessionRole;
  allowedRoles: ReadonlyArray<StaffRole>;
  children: ReactNode;
}) {
  const href = useRouterState({
    select: (state) => state.location.pathname + state.location.searchStr,
  });
  const navigate = useNavigate();
  const [returnHref] = useState(href);

  const denied =
    session !== undefined &&
    role !== undefined &&
    (session.status === "unauthenticated" ||
      role.status === "unauthenticated" ||
      (role.status === "authenticated" && !allowedRoles.includes(role.role)));

  useEffect(() => {
    if (session === undefined || role === undefined) {
      return;
    }
    // La redirección por falta de sesión no espera más que al par
    // completo: sesión y rol llegan juntos en una única respuesta.
    if (session.status === "unauthenticated") {
      void navigate({ to: "/login", search: { redirect: returnHref }, replace: true });
      return;
    }
    if (denied) {
      void navigate({ to: "/denegado", replace: true });
    }
  }, [session, role, denied, returnHref, navigate]);

  // Sin backend la sesión nunca resuelve: se muestra el acceso con su
  // estado explícito en vez de un "Cargando…" indefinido. No expone
  // contenido protegido porque el portal nunca llega a renderizarse.
  if (!isBackendConfigured) {
    return <AuthScreen />;
  }
  // El portal se oculta desde el primer render sin sesión, aunque el par
  // anterior siga en memoria: tras perder la sesión no se vuelve a mostrar
  // contenido protegido mientras se navega al acceso.
  if (session === undefined || role === undefined || denied) {
    return <p role="status">{GENERIC_AUTH_MESSAGES.loading}</p>;
  }
  return <>{children}</>;
}
