import { getRouteApi, Navigate, Outlet } from "@tanstack/react-router";
import { AccessibilityProvider } from "../accessibility/AccessibilityProvider.tsx";
import {
  ProfessionalAgendaDetailPage,
  ProfessionalAgendaPage,
} from "../gestion/professional-agenda.tsx";
import { ProfessionalAvailabilityPage } from "../gestion/professional-availability-editor.tsx";
import { StudentAccompanimentDetailPage } from "../estudiante/student-accompaniments.tsx";
import { StudentRequestDetailPage, StudentRequestsPage } from "../estudiante/student-requests.tsx";
import {
  ProfessionalRequestDetailPage,
  ProfessionalRequestsPage,
} from "../gestion/professional-requests.tsx";
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
import { ScheduleSearchPage } from "../estudiante/schedule-search.tsx";
import { ReservationFormPage } from "../estudiante/reservation-form.tsx";

/**
 * Componentes de ruta (TI2-6, TI2-20, TI2-89, TI2-90, TI2-91, TI2-103, TI2-115): puentes delgados entre las
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

export function StudentScheduleRouteComponent() {
  return <ScheduleSearchPage />;
}

export function StudentReservationRouteComponent() {
  return <ReservationFormPage />;
}

const studentRequestDetailApi = getRouteApi("/estudiante/solicitudes/$requestId");

const studentAccompanimentDetailApi = getRouteApi("/estudiante/acompanamientos/$accompanimentId");

export function StudentRequestsRouteComponent() {
  return <StudentRequestsPage />;
}

export function StudentRequestDetailRouteComponent() {
  const { requestId } = studentRequestDetailApi.useParams();
  return <StudentRequestDetailPage requestId={requestId} />;
}

export function StudentAccompanimentDetailRouteComponent() {
  const { accompanimentId } = studentAccompanimentDetailApi.useParams();
  return <StudentAccompanimentDetailPage accompanimentId={accompanimentId} />;
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

const professionalRequestDetailApi = getRouteApi("/profesional/solicitudes/$requestId");

export function ProfessionalRequestsRouteComponent() {
  return <ProfessionalRequestsPage />;
}

export function ProfessionalRequestDetailRouteComponent() {
  const { requestId } = professionalRequestDetailApi.useParams();
  return <ProfessionalRequestDetailPage requestId={requestId} />;
}

export function ProfessionalAvailabilityRouteComponent() {
  return <ProfessionalAvailabilityPage />;
}

const professionalAgendaDetailApi = getRouteApi("/profesional/agenda/$appointmentId");

export function ProfessionalAgendaRouteComponent() {
  return <ProfessionalAgendaPage />;
}

export function ProfessionalAgendaDetailRouteComponent() {
  const { appointmentId } = professionalAgendaDetailApi.useParams();
  return <ProfessionalAgendaDetailPage appointmentId={appointmentId} />;
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
