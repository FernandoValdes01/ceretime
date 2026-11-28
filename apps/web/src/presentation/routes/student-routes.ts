import { createRoute } from "@tanstack/react-router";
import { toCalendarCallbackStatus } from "../../application/calendar/calendar-link.ts";
import {
  SLOT_MODALITY_FILTER_VALUES,
  type SlotModalityFilter,
} from "../../application/agenda/agenda-port.ts";
import {
  StudentAccompanimentDetailRouteComponent,
  StudentAppointmentDetailRouteComponent,
  StudentAppointmentsRouteComponent,
  StudentIndexRouteComponent,
  StudentLayoutRouteComponent,
  StudentNotificationsRouteComponent,
  StudentPrivacyDetailRouteComponent,
  StudentPrivacyRouteComponent,
  StudentRequestDetailRouteComponent,
  StudentRequestFormRouteComponent,
  StudentRequestsRouteComponent,
  StudentReservationRouteComponent,
  StudentScheduleRouteComponent,
} from "./route-components.tsx";
import { rootRoute } from "./root-route.ts";

/**
 * Área del Estudiante (TI2-133).
 *
 * Conserva las URL y las guardias vigentes: `/estudiante` es el layout
 * protegido y cada vista cuelga de él. Para agregar una pantalla del
 * Estudiante, define la ruta acá y agrega su enlace en la lista `student` de
 * `navigation.ts`; no hace falta tocar el árbol de otra área.
 */

const studentLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/estudiante",
  component: StudentLayoutRouteComponent,
});

const studentIndexRoute = createRoute({
  getParentRoute: () => studentLayoutRoute,
  path: "/",
  component: StudentIndexRouteComponent,
});

/**
 * Búsqueda que comparten horarios y confirmación (TI2-163): la modalidad
 * elegida y la atención cuyo horario cambia viajan en la URL, así volver a elegir
 * un horario tras un conflicto conserva lo ingresado y recargar no lo pierde.
 */
type BookingSearch = {
  accompanimentId?: string;
  modality?: SlotModalityFilter;
  rescheduleAppointmentId?: string;
};

function readBookingSearch(search: Record<string, unknown>): BookingSearch {
  const modality = SLOT_MODALITY_FILTER_VALUES.find((value) => value === search.modality);
  return {
    accompanimentId:
      typeof search.accompanimentId === "string" ? search.accompanimentId : undefined,
    modality,
    rescheduleAppointmentId:
      typeof search.rescheduleAppointmentId === "string"
        ? search.rescheduleAppointmentId
        : undefined,
  };
}

const studentScheduleRoute = createRoute({
  getParentRoute: () => studentLayoutRoute,
  path: "/horarios",
  validateSearch: readBookingSearch,
  component: StudentScheduleRouteComponent,
});

const studentReservationRoute = createRoute({
  getParentRoute: () => studentLayoutRoute,
  path: "/reservar",
  validateSearch: (search: Record<string, unknown>): BookingSearch & { slotId?: string } => ({
    ...readBookingSearch(search),
    slotId: typeof search.slotId === "string" ? search.slotId : undefined,
  }),
  component: StudentReservationRouteComponent,
});

const studentAppointmentsRoute = createRoute({
  getParentRoute: () => studentLayoutRoute,
  path: "atenciones",
  component: StudentAppointmentsRouteComponent,
});

const studentAppointmentDetailRoute = createRoute({
  getParentRoute: () => studentLayoutRoute,
  path: "atenciones/$appointmentId",
  component: StudentAppointmentDetailRouteComponent,
});

const studentRequestsRoute = createRoute({
  getParentRoute: () => studentLayoutRoute,
  path: "solicitudes",
  component: StudentRequestsRouteComponent,
});

// Ruta estática: TanStack Router la prefiere sobre `solicitudes/$requestId`.
const studentRequestFormRoute = createRoute({
  getParentRoute: () => studentLayoutRoute,
  path: "solicitudes/nueva",
  component: StudentRequestFormRouteComponent,
});

const studentRequestDetailRoute = createRoute({
  getParentRoute: () => studentLayoutRoute,
  path: "solicitudes/$requestId",
  component: StudentRequestDetailRouteComponent,
});

const studentAccompanimentDetailRoute = createRoute({
  getParentRoute: () => studentLayoutRoute,
  path: "acompanamientos/$accompanimentId",
  validateSearch: (search: Record<string, unknown>): { calendar?: "connected" | "error" } => ({
    calendar:
      search.calendar === "connected"
        ? "connected"
        : search.calendar === "error"
          ? "error"
          : undefined,
  }),
  component: StudentAccompanimentDetailRouteComponent,
});

// `calendar` es el marcador de retorno de la autorización de Google (TI2-172).
const studentNotificationsRoute = createRoute({
  getParentRoute: () => studentLayoutRoute,
  path: "avisos",
  validateSearch: (search: Record<string, unknown>): { calendar?: "connected" | "error" } => ({
    calendar: toCalendarCallbackStatus(search.calendar),
  }),
  component: StudentNotificationsRouteComponent,
});

const studentPrivacyRoute = createRoute({
  getParentRoute: () => studentLayoutRoute,
  path: "privacidad",
  component: StudentPrivacyRouteComponent,
});

const studentPrivacyDetailRoute = createRoute({
  getParentRoute: () => studentLayoutRoute,
  path: "privacidad/$requestId",
  component: StudentPrivacyDetailRouteComponent,
});

export const studentRoutes = [
  studentLayoutRoute.addChildren([
    studentIndexRoute,
    studentScheduleRoute,
    studentReservationRoute,
    studentAppointmentsRoute,
    studentAppointmentDetailRoute,
    studentRequestsRoute,
    studentRequestFormRoute,
    studentRequestDetailRoute,
    studentAccompanimentDetailRoute,
    studentNotificationsRoute,
    studentPrivacyRoute,
    studentPrivacyDetailRoute,
  ]),
] as const;
