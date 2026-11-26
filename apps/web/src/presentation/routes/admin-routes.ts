import { createRoute } from "@tanstack/react-router";
import {
  AdminAccountsRouteComponent,
  AdminIndexRouteComponent,
  AdminLayoutRouteComponent,
  AdminReportsRouteComponent,
  AdminSpacesRouteComponent,
} from "./route-components.tsx";
import { rootRoute } from "./root-route.ts";

/**
 * Área de Administración (TI2-133, extendido TI2-169).
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

const adminAccountsRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: "cuentas",
  component: AdminAccountsRouteComponent,
});

const adminSpacesRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: "espacios",
  component: AdminSpacesRouteComponent,
});

const adminReportsRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: "reportes",
  component: AdminReportsRouteComponent,
});

export const adminRoutes = [
  adminLayoutRoute.addChildren([
    adminIndexRoute,
    adminAccountsRoute,
    adminSpacesRoute,
    adminReportsRoute,
  ]),
] as const;
