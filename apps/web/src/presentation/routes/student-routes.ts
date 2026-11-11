import { createRoute } from "@tanstack/react-router";
import {
  StudentAccompanimentDetailRouteComponent,
  StudentAppointmentDetailRouteComponent,
  StudentAppointmentsRouteComponent,
  StudentIndexRouteComponent,
  StudentLayoutRouteComponent,
  StudentRequestDetailRouteComponent,
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

const studentScheduleRoute = createRoute({
  getParentRoute: () => studentLayoutRoute,
  path: "/horarios",
  validateSearch: (search: Record<string, unknown>): { accompanimentId?: string } => ({
    accompanimentId:
      typeof search.accompanimentId === "string" ? search.accompanimentId : undefined,
  }),
  component: StudentScheduleRouteComponent,
});

const studentReservationRoute = createRoute({
  getParentRoute: () => studentLayoutRoute,
  path: "/reservar",
  validateSearch: (
    search: Record<string, unknown>,
  ): { slotId?: string; accompanimentId?: string } => ({
    slotId: typeof search.slotId === "string" ? search.slotId : undefined,
    accompanimentId:
      typeof search.accompanimentId === "string" ? search.accompanimentId : undefined,
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

export const studentRoutes = [
  studentLayoutRoute.addChildren([
    studentIndexRoute,
    studentScheduleRoute,
    studentReservationRoute,
    studentAppointmentsRoute,
    studentAppointmentDetailRoute,
    studentRequestsRoute,
    studentRequestDetailRoute,
    studentAccompanimentDetailRoute,
  ]),
] as const;
