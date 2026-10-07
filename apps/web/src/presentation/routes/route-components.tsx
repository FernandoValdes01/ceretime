import { getRouteApi, Navigate, Outlet } from "@tanstack/react-router";
import { AccessibilityProvider } from "../accessibility/AccessibilityProvider.tsx";
import { StudentRequestDetailPage, StudentRequestsPage } from "../estudiante/student-requests.tsx";
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
 * Componentes de ruta (TI2-6, TI2-20, TI2-89): puentes delgados entre las
 * definiciones de `router.tsx` y las páginas. Viven acá para que `router.tsx`
 * no mezcle componentes con objetos de ruta (regla de fast refresh).
 */
export function RootComponent() {
  return (
    <AccessibilityProvider>
      <main>
        <Outlet />
      </main>
    </AccessibilityProvider>
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

const studentRequestDetailApi = getRouteApi("/estudiante/solicitudes/$requestId");

export function StudentRequestsRouteComponent() {
  return <StudentRequestsPage />;
}

export function StudentRequestDetailRouteComponent() {
  const { requestId } = studentRequestDetailApi.useParams();
  return <StudentRequestDetailPage requestId={requestId} />;
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
