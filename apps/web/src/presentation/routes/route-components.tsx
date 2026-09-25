import { Navigate, Outlet } from "@tanstack/react-router";
import { useSessionAndRole, useSessionState } from "../session/session-state.ts";
import { IndexPage } from "./index-page.tsx";
import { LoginPage } from "./login-page.tsx";
import { RequireStudent } from "./student-guard.tsx";
import { ADMIN_ROLES, PRACTITIONER_ROLES, PROFESSIONAL_ROLES } from "./staff-portal-roles.ts";
import {
  AdminHome,
  AdminLayout,
  PractitionerHome,
  PractitionerLayout,
  ProfessionalHome,
  ProfessionalLayout,
} from "./staff-portals.tsx";
import { RequireStaffRole } from "./staff-guard.tsx";
import { StudentHome, StudentLayout } from "./student-portal.tsx";

/**
 * Componentes de ruta (TI2-6, TI2-20): puentes delgados entre las
 * definiciones de `router.tsx` y las páginas. Viven acá para que `router.tsx`
 * no mezcle componentes con objetos de ruta (regla de fast refresh).
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
  const pair = useSessionAndRole();
  return <IndexPage session={pair?.session} role={pair?.role} />;
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

export function ProfessionalLayoutRouteComponent() {
  const pair = useSessionAndRole();
  return (
    <RequireStaffRole session={pair?.session} role={pair?.role} allowedRoles={PROFESSIONAL_ROLES}>
      <ProfessionalLayout />
    </RequireStaffRole>
  );
}

export function ProfessionalIndexRouteComponent() {
  return <ProfessionalHome />;
}

export function PractitionerLayoutRouteComponent() {
  const pair = useSessionAndRole();
  return (
    <RequireStaffRole session={pair?.session} role={pair?.role} allowedRoles={PRACTITIONER_ROLES}>
      <PractitionerLayout />
    </RequireStaffRole>
  );
}

export function PractitionerIndexRouteComponent() {
  return <PractitionerHome />;
}

export function AdminLayoutRouteComponent() {
  const pair = useSessionAndRole();
  return (
    <RequireStaffRole session={pair?.session} role={pair?.role} allowedRoles={ADMIN_ROLES}>
      <AdminLayout />
    </RequireStaffRole>
  );
}

export function AdminIndexRouteComponent() {
  return <AdminHome />;
}
