import { createRoute } from "@tanstack/react-router";
import { toCalendarCallbackStatus } from "../../application/calendar/calendar-link.ts";
import {
  ProfessionalAccompanimentDetailRouteComponent,
  ProfessionalAccompanimentsRouteComponent,
  ProfessionalAgendaDetailRouteComponent,
  ProfessionalAgendaRouteComponent,
  ProfessionalAvailabilityRouteComponent,
  ProfessionalIndexRouteComponent,
  ProfessionalLayoutRouteComponent,
  ProfessionalNotificationsRouteComponent,
  ProfessionalOfficialRequestRouteComponent,
  ProfessionalRequestDetailRouteComponent,
  ProfessionalRequestsRouteComponent,
} from "./route-components.tsx";
import { rootRoute } from "./root-route.ts";
import { toRequestListSearch } from "../gestion/paged-requests.ts";

/**
 * Área del Profesional (TI2-133).
 *
 * Conserva las URL y la guardia por rol. Para agregar una pantalla del
 * Profesional, define la ruta acá y agrega su enlace en la lista
 * `professional` de `navigation.ts`.
 */

const professionalLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/profesional",
  component: ProfessionalLayoutRouteComponent,
});

const professionalIndexRoute = createRoute({
  getParentRoute: () => professionalLayoutRoute,
  path: "/",
  component: ProfessionalIndexRouteComponent,
});

const professionalRequestsRoute = createRoute({
  getParentRoute: () => professionalLayoutRoute,
  path: "solicitudes",
  validateSearch: toRequestListSearch,
  component: ProfessionalRequestsRouteComponent,
});

const professionalRequestDetailRoute = createRoute({
  getParentRoute: () => professionalLayoutRoute,
  path: "solicitudes/$requestId",
  validateSearch: toRequestListSearch,
  component: ProfessionalRequestDetailRouteComponent,
});

// Registro por canal oficial (TI2-158). El segmento fijo gana sobre `$requestId`.
const professionalOfficialRequestRoute = createRoute({
  getParentRoute: () => professionalLayoutRoute,
  path: "solicitudes/registrar",
  component: ProfessionalOfficialRequestRouteComponent,
});

const professionalAccompanimentsRoute = createRoute({
  getParentRoute: () => professionalLayoutRoute,
  path: "acompanamientos",
  component: ProfessionalAccompanimentsRouteComponent,
});

const professionalAccompanimentDetailRoute = createRoute({
  getParentRoute: () => professionalLayoutRoute,
  path: "acompanamientos/$accompanimentId",
  component: ProfessionalAccompanimentDetailRouteComponent,
});

const professionalAvailabilityRoute = createRoute({
  getParentRoute: () => professionalLayoutRoute,
  path: "disponibilidad",
  component: ProfessionalAvailabilityRouteComponent,
});

const professionalAgendaRoute = createRoute({
  getParentRoute: () => professionalLayoutRoute,
  path: "agenda",
  component: ProfessionalAgendaRouteComponent,
});

const professionalAgendaDetailRoute = createRoute({
  getParentRoute: () => professionalLayoutRoute,
  path: "agenda/$appointmentId",
  component: ProfessionalAgendaDetailRouteComponent,
});

// `calendar` es el marcador de retorno de la autorización de Google (TI2-172).
const professionalNotificationsRoute = createRoute({
  getParentRoute: () => professionalLayoutRoute,
  path: "avisos",
  validateSearch: (search: Record<string, unknown>): { calendar?: "connected" | "error" } => ({
    calendar: toCalendarCallbackStatus(search.calendar),
  }),
  component: ProfessionalNotificationsRouteComponent,
});

export const professionalRoutes = [
  professionalLayoutRoute.addChildren([
    professionalIndexRoute,
    professionalRequestsRoute,
    professionalRequestDetailRoute,
    professionalOfficialRequestRoute,
    professionalAccompanimentsRoute,
    professionalAccompanimentDetailRoute,
    professionalAvailabilityRoute,
    professionalAgendaRoute,
    professionalAgendaDetailRoute,
    professionalNotificationsRoute,
  ]),
] as const;
