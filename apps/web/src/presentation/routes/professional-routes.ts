import { createRoute } from "@tanstack/react-router";
import {
  ProfessionalAgendaDetailRouteComponent,
  ProfessionalAgendaRouteComponent,
  ProfessionalAvailabilityRouteComponent,
  ProfessionalIndexRouteComponent,
  ProfessionalLayoutRouteComponent,
  ProfessionalRequestDetailRouteComponent,
  ProfessionalRequestsRouteComponent,
} from "./route-components.tsx";
import { rootRoute } from "./root-route.ts";

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
  component: ProfessionalRequestsRouteComponent,
});

const professionalRequestDetailRoute = createRoute({
  getParentRoute: () => professionalLayoutRoute,
  path: "solicitudes/$requestId",
  component: ProfessionalRequestDetailRouteComponent,
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

export const professionalRoutes = [
  professionalLayoutRoute.addChildren([
    professionalIndexRoute,
    professionalRequestsRoute,
    professionalRequestDetailRoute,
    professionalAvailabilityRoute,
    professionalAgendaRoute,
    professionalAgendaDetailRoute,
  ]),
] as const;
