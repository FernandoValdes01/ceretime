import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { GENERIC_AUTH_MESSAGES } from "../../application/session/institutional-login.ts";
import type { WebSessionState } from "../session/session-state.ts";

/**
 * Guard del portal del Estudiante (TI2-6).
 *
 * Solo mejora la navegación: sin sesión redirige al acceso conservando la
 * ruta pedida, y con sesión de otra población muestra denegado sin exponer
 * contenido protegido. No sustituye la autorización del Backend: cada
 * lectura real la comprueba Convex aunque la interfaz deje pasar.
 *
 * La redirección es imperativa en efecto con dependencias estables, y la
 * ruta de retorno se captura una sola vez al montar: el router actualiza la
 * ubicación de forma optimista al navegar, así que releerla en cada render
 * abortaría la navegación anterior y el ciclo no se asentaría nunca.
 */
export function RequireStudent({
  session,
  children,
}: {
  session: WebSessionState;
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
    if (session.status === "unauthenticated") {
      void navigate({ to: "/login", search: { redirect: returnHref }, replace: true });
      return;
    }
    if (session.population !== "estudiante") {
      void navigate({ to: "/denegado", replace: true });
    }
  }, [session, returnHref, navigate]);

  if (session === undefined) {
    return <p role="status">{GENERIC_AUTH_MESSAGES.loading}</p>;
  }
  if (session.status === "unauthenticated" || session.population !== "estudiante") {
    return <p role="status">{GENERIC_AUTH_MESSAGES.loading}</p>;
  }
  return <>{children}</>;
}
