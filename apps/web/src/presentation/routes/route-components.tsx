import { getRouteApi, Link, Outlet } from "@tanstack/react-router";
import { useDocumentTitle } from "./document-title.ts";
import { AccessibilityProvider } from "../accessibility/AccessibilityProvider.tsx";
import { AdminAccountsPage } from "../gestion/admin-accounts.tsx";
import { AdminSpaceEditorPage } from "../gestion/admin-space-editor.tsx";
import {
  ProfessionalAgendaDetailPage,
  ProfessionalAgendaPage,
} from "../gestion/professional-agenda.tsx";
import {
  PractitionerAccompanimentDetailPage,
  PractitionerAccompanimentsPage,
} from "../gestion/practitioner-accompaniments.tsx";
import {
  ProfessionalAccompanimentDetailPage,
  ProfessionalAccompanimentsPage,
} from "../gestion/professional-accompaniments.tsx";
import { ProfessionalAvailabilityPage } from "../gestion/professional-availability-editor.tsx";
import { StudentAccompanimentDetailPage } from "../estudiante/student-accompaniments.tsx";
import {
  StudentAppointmentDetailPage,
  StudentAppointmentsPage,
} from "../estudiante/student-appointments-page.tsx";
import { StudentRequestFormPage } from "../estudiante/student-request-form.tsx";
import { StudentRequestDetailPage, StudentRequestsPage } from "../estudiante/student-requests.tsx";
import {
  ProfessionalRequestDetailPage,
  ProfessionalRequestsPage,
} from "../gestion/professional-requests.tsx";
import { retryOwnProfile, useOwnProfileProvisioning } from "../session/own-profile-provisioning.ts";
import { useSessionAndRole, useSessionState } from "../session/session-state.ts";
import { PublicMain, SkipLink } from "./app-shell.tsx";
import { DeniedPage } from "./denied-page.tsx";
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
 * Componentes de ruta (TI2-6, TI2-20, TI2-89, TI2-90, TI2-91, TI2-103, TI2-04,
 * TI2-114, TI2-115, TI2-116, TI2-133, TI2-165): puentes delgados entre las definiciones
 * de los archivos de área y las páginas. Viven acá para que las definiciones
 * de ruta no mezclen componentes (regla de fast refresh).
 */
export function RootComponent() {
  return (
    <AccessibilityProvider>
      <SkipLink />
      <Outlet />
    </AccessibilityProvider>
  );
}

export function NotFoundPage() {
  useDocumentTitle("Página no encontrada");
  return (
    <PublicMain>
      <section aria-labelledby="not-found-title">
        <h1 id="not-found-title">Página no encontrada</h1>
        <p>La dirección que abriste no existe o cambió de lugar.</p>
        <p>Revisa el enlace o vuelve al inicio para continuar.</p>
        <p>
          <Link to="/">Volver al inicio</Link>
        </p>
      </section>
    </PublicMain>
  );
}

export function IndexRouteComponent() {
  useDocumentTitle("Acceso institucional");
  return (
    <PublicMain>
      <IndexPage session={useSessionState()} pair={useSessionAndRole()} />
    </PublicMain>
  );
}

export function LoginRouteComponent() {
  useDocumentTitle("Acceso institucional");
  return (
    <PublicMain>
      <LoginPage session={useSessionState()} />
    </PublicMain>
  );
}

export function DeniedRouteComponent() {
  useDocumentTitle("Acceso denegado");
  return (
    <PublicMain>
      <DeniedPage />
    </PublicMain>
  );
}

export function StudentLayoutRouteComponent() {
  const pair = useSessionAndRole();
  const email = pair?.session.status === "authenticated" ? pair.session.email : null;
  const provisioning = useOwnProfileProvisioning(email);
  const account =
    pair?.role.status === "authenticated"
      ? "enabled"
      : provisioning === "failed"
        ? "unavailable"
        : "not-enabled";
  return (
    <RequireStudent session={useSessionState()} pair={pair}>
      <StudentLayout
        account={account}
        onRetry={() => {
          if (email !== null) retryOwnProfile(email);
        }}
      />
    </RequireStudent>
  );
}

export function StudentIndexRouteComponent() {
  useDocumentTitle("Portal del Estudiante");
  return <StudentHome />;
}

export function StudentScheduleRouteComponent() {
  useDocumentTitle("Buscar horarios");
  return <ScheduleSearchPage />;
}

export function StudentReservationRouteComponent() {
  useDocumentTitle("Reservar atención");
  return <ReservationFormPage />;
}

const studentAppointmentDetailApi = getRouteApi("/estudiante/atenciones/$appointmentId");

export function StudentAppointmentsRouteComponent() {
  useDocumentTitle("Atenciones");
  return <StudentAppointmentsPage />;
}

export function StudentAppointmentDetailRouteComponent() {
  useDocumentTitle("Detalle de la atención");
  const { appointmentId } = studentAppointmentDetailApi.useParams();
  return <StudentAppointmentDetailPage appointmentId={appointmentId} />;
}

const studentRequestDetailApi = getRouteApi("/estudiante/solicitudes/$requestId");

const studentAccompanimentDetailApi = getRouteApi("/estudiante/acompanamientos/$accompanimentId");

export function StudentRequestsRouteComponent() {
  useDocumentTitle("Mis solicitudes");
  return <StudentRequestsPage />;
}

export function StudentRequestFormRouteComponent() {
  useDocumentTitle("Nueva solicitud de acompañamiento");
  return <StudentRequestFormPage />;
}

export function StudentRequestDetailRouteComponent() {
  useDocumentTitle("Detalle de la solicitud");
  const { requestId } = studentRequestDetailApi.useParams();
  return <StudentRequestDetailPage requestId={requestId} />;
}

export function StudentAccompanimentDetailRouteComponent() {
  useDocumentTitle("Detalle del acompañamiento");
  const { accompanimentId } = studentAccompanimentDetailApi.useParams();
  // Marcador de retorno del consentimiento de Calendar (TI2-122). La ruta ya
  // lo valida; acá solo se pasa a la página para mostrar el aviso genérico.
  const { calendar } = studentAccompanimentDetailApi.useSearch();
  return (
    <StudentAccompanimentDetailPage accompanimentId={accompanimentId} calendarStatus={calendar} />
  );
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
  useDocumentTitle("Portal del Profesional");
  return <ProfessionalHome />;
}

export function ProfessionalRequestsRouteComponent() {
  useDocumentTitle("Solicitudes");
  return <ProfessionalRequestsPage />;
}

export function ProfessionalRequestDetailRouteComponent() {
  useDocumentTitle("Detalle de la solicitud");
  const { requestId } = professionalRequestDetailApi.useParams();
  return <ProfessionalRequestDetailPage requestId={requestId} />;
}

export function ProfessionalAvailabilityRouteComponent() {
  useDocumentTitle("Disponibilidad");
  return <ProfessionalAvailabilityPage />;
}

export function ProfessionalAgendaRouteComponent() {
  useDocumentTitle("Agenda");
  return <ProfessionalAgendaPage />;
}

export function ProfessionalAgendaDetailRouteComponent() {
  useDocumentTitle("Detalle de la atención");
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

const practitionerAccompanimentDetailApi = getRouteApi(
  "/practicante/acompanamientos/$accompanimentId",
);

export function PractitionerAccompanimentsRouteComponent() {
  useDocumentTitle("Acompañamientos asignados");
  return <PractitionerAccompanimentsPage />;
}

export function PractitionerAccompanimentDetailRouteComponent() {
  useDocumentTitle("Detalle del acompañamiento");
  const { accompanimentId } = practitionerAccompanimentDetailApi.useParams();
  return <PractitionerAccompanimentDetailPage accompanimentId={accompanimentId} />;
}
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

export function PractitionerIndexRouteComponent() {
  useDocumentTitle("Portal del Practicante");
  return <PractitionerHome />;
}

export function PractitionerAccompanimentsRouteComponent() {
  useDocumentTitle("Acompañamientos asignados");
  return <PractitionerAccompanimentsPage />;
}

export function PractitionerAccompanimentDetailRouteComponent() {
  useDocumentTitle("Detalle del acompañamiento");
  const { accompanimentId } = practitionerAccompanimentDetailApi.useParams();
  return <PractitionerAccompanimentDetailPage accompanimentId={accompanimentId} />;
}

export function AdminIndexRouteComponent() {
  useDocumentTitle("Portal de Administración");
  return <AdminHome />;
}

export function AdminAccountsRouteComponent() {
  useDocumentTitle("Cuentas de personal");
  return <AdminAccountsPage />;
}

export function AdminSpacesRouteComponent() {
  useDocumentTitle("Espacios de atención");
  return <AdminSpaceEditorPage />;
}
