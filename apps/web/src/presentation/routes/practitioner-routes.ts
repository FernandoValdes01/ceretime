import { createRoute } from "@tanstack/react-router";
import {
  PractitionerAccompanimentDetailRouteComponent,
  PractitionerAccompanimentsRouteComponent,
  PractitionerIndexRouteComponent,
  PractitionerLayoutRouteComponent,
} from "./route-components.tsx";
import { rootRoute } from "./root-route.ts";

/**
 * Área del Practicante (TI2-133).
 *
 * Conserva las URL y la guardia por rol. Para agregar una pantalla del
 * Practicante, define la ruta acá y agrega su enlace en la lista
 * `practitioner` de `navigation.ts`.
 */

const practitionerLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/practicante",
  component: PractitionerLayoutRouteComponent,
});

const practitionerIndexRoute = createRoute({
  getParentRoute: () => practitionerLayoutRoute,
  path: "/",
  component: PractitionerIndexRouteComponent,
});

const practitionerAccompanimentsRoute = createRoute({
  getParentRoute: () => practitionerLayoutRoute,
  path: "acompanamientos",
  component: PractitionerAccompanimentsRouteComponent,
});

const practitionerAccompanimentDetailRoute = createRoute({
  getParentRoute: () => practitionerLayoutRoute,
  path: "acompanamientos/$accompanimentId",
  component: PractitionerAccompanimentDetailRouteComponent,
});

export const practitionerRoutes = [
  practitionerLayoutRoute.addChildren([
    practitionerIndexRoute,
    practitionerAccompanimentsRoute,
    practitionerAccompanimentDetailRoute,
  ]),
] as const;
