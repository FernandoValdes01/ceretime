import { createRoute } from "@tanstack/react-router";
import {
  AdminIndexRouteComponent,
  AdminLayoutRouteComponent,
  AdminSpacesRouteComponent,
} from "./route-components.tsx";
import { rootRoute } from "./root-route.ts";

/**
 * Área de Administración (TI2-133).
 *
 * Conserva las URL y la guardia por rol. Para agregar una pantalla de
 * Administración, define la ruta acá y agrega su enlace en la lista `admin`
 * de `navigation.ts`.
 */

const adminLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/administrador",
  component: AdminLayoutRouteComponent,
});

const adminIndexRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: "/",
  component: AdminIndexRouteComponent,
});

const adminSpacesRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: "espacios",
  component: AdminSpacesRouteComponent,
});

export const adminRoutes = [
  adminLayoutRoute.addChildren([adminIndexRoute, adminSpacesRoute]),
] as const;
