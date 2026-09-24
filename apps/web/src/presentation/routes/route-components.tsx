import { Navigate, Outlet } from "@tanstack/react-router";
import { useSessionState } from "../session/session-state.ts";
import { IndexPage } from "./index-page.tsx";
import { LoginPage } from "./login-page.tsx";
import { RequireStudent } from "./student-guard.tsx";
import { StudentHome, StudentLayout } from "./student-portal.tsx";

/**
 * Componentes de ruta (TI2-6): puentes delgados entre las definiciones de
 * `router.tsx` y las páginas. Viven acá para que `router.tsx` no mezcle
 * componentes con objetos de ruta (regla de fast refresh).
 */
export function RootComponent() {
  return (
    <main>
      <Outlet />
    </main>
  );
}

export function NotFoundRedirect() {
  return <Navigate to="/" replace />;
}

export function IndexRouteComponent() {
  return <IndexPage session={useSessionState()} />;
}

export function LoginRouteComponent() {
  return <LoginPage session={useSessionState()} />;
}

export function StudentLayoutRouteComponent() {
  return (
    <RequireStudent session={useSessionState()}>
      <StudentLayout />
    </RequireStudent>
  );
}

export function StudentIndexRouteComponent() {
  return <StudentHome />;
}
