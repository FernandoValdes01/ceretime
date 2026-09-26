import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { GENERIC_AUTH_MESSAGES } from "../../application/session/institutional-login.ts";
import { isBackendConfigured } from "../../infrastructure/convex/convex-client.ts";
import { AuthScreen } from "../auth/AuthScreen.tsx";
import type { StaffRole, WebSessionAndRole, WebSessionState } from "../session/session-state.ts";
import { isPairCurrent } from "./staff-portal-roles.ts";

/**
 * Guard de portal por rol (TI2-20).
 *
 * Solo mejora la navegación: sin sesión redirige al acceso conservando la
 * ruta pedida; con sesión pero sin rol conocido (sin perfil) o con rol no
 * permitido muestra denegado sin exponer contenido protegido. No sustituye
 * la autorización del Backend: cada lectura real la comprueba Convex aunque
 * la interfaz deje pasar.
 *
 * El par llega vinculado al mismo principal en una única respuesta
 * (`getSessionWithRole`), y además se exige confirmación cruzada con la
 * suscripción independiente de sesión: si el par aún trae otra sesión
 * (revalidación en curso tras un cambio de cuenta), se espera sin
 * renderizar ni navegar hasta que el contexto se actualice.
 *
 * La redirección es imperativa en efecto con dependencias estables, y la
 * ruta de retorno se captura una sola vez al montar (mismo motivo que en
 * `student-guard.tsx`: releer la ubicación optimista reiniciaría el ciclo).
 */
export function RequireStaffRole({
  session,
  pair,
  allowedRoles,
  children,
}: {
  session: WebSessionState;
  pair: WebSessionAndRole;
  allowedRoles: ReadonlyArray<StaffRole>;
  children: ReactNode;
}) {
  const href = useRouterState({
    select: (state) => state.location.pathname + state.location.searchStr,
  });
  const navigate = useNavigate();
  const [returnHref] = useState(href);

  useEffect(() => {
    if (session === undefined) {
      return;
    }
    // La redirección por falta de sesión no espera al par: con la sesión
    // confirmada sin autenticar se navega al acceso aunque el rol siga
    // pendiente, en vez de dejar un "Cargando…" indefinido.
    if (session.status === "unauthenticated") {
      void navigate({ to: "/login", search: { redirect: returnHref }, replace: true });
      return;
    }
    if (pair === undefined) {
      return;
    }
    // Sin confirmación no se navega ni se renderiza: el par puede traer
    // otra sesión mientras revalida y actuar con él mostraría el portal
    // anterior o expulsaría una sesión legítima.
    if (!isPairCurrent(session, pair)) {
      return;
    }
    const role = pair.role;
    if (role.status === "unauthenticated" || !allowedRoles.includes(role.role)) {
      void navigate({ to: "/denegado", replace: true });
    }
  }, [session, pair, allowedRoles, returnHref, navigate]);

  // Sin backend la sesión nunca resuelve: se muestra el acceso con su
  // estado explícito en vez de un "Cargando…" indefinido. No expone
  // contenido protegido porque el portal nunca llega a renderizarse.
  if (!isBackendConfigured) {
    return <AuthScreen />;
  }
  // El portal se oculta desde el primer render sin sesión o sin
  // confirmación, aunque el par anterior siga en memoria: tras perder la
  // sesión o al cambiar de cuenta no se vuelve a mostrar contenido
  // protegido mientras se navega o se espera al contexto vigente.
  if (session === undefined || pair === undefined) {
    return <p role="status">{GENERIC_AUTH_MESSAGES.loading}</p>;
  }
  if (session.status === "unauthenticated" || !isPairCurrent(session, pair)) {
    return <p role="status">{GENERIC_AUTH_MESSAGES.loading}</p>;
  }
  const role = pair.role;
  if (role.status === "unauthenticated" || !allowedRoles.includes(role.role)) {
    return <p role="status">{GENERIC_AUTH_MESSAGES.loading}</p>;
  }
  return <>{children}</>;
}
