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
  return <IndexPage session={useSessionState()} pair={useSessionAndRole()} />;
}

export function LoginRouteComponent() {
  return <LoginPage session={useSessionState()} />;
}

export function StudentLayoutRouteComponent() {
  return (
    <RequireStudent session={useSessionState()} pair={useSessionAndRole()}>
      <StudentLayout />
    </RequireStudent>
  );
}

export function StudentIndexRouteComponent() {
  return <StudentHome />;
}

export function ProfessionalLayoutRouteComponent() {
  return (
    <RequireStaffRole
      session={useSessionState()}
      pair={useSessionAndRole()}
      allowedRoles={PROFESSIONAL_ROLES}
    >
      <ProfessionalLayout />
    </RequireStaffRole>
  );
}

export function ProfessionalIndexRouteComponent() {
  return <ProfessionalHome />;
}

export function PractitionerLayoutRouteComponent() {
  return (
    <RequireStaffRole
      session={useSessionState()}
      pair={useSessionAndRole()}
      allowedRoles={PRACTITIONER_ROLES}
    >
      <PractitionerLayout />
    </RequireStaffRole>
  );
}

export function PractitionerIndexRouteComponent() {
  return <PractitionerHome />;
}

export function AdminLayoutRouteComponent() {
  return (
    <RequireStaffRole
      session={useSessionState()}
      pair={useSessionAndRole()}
      allowedRoles={ADMIN_ROLES}
    >
      <AdminLayout />
    </RequireStaffRole>
  );
}

export function AdminIndexRouteComponent() {
  return <AdminHome />;
}
