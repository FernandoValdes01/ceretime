import { createRoute } from "@tanstack/react-router";
import {
  DeniedRouteComponent,
  IndexRouteComponent,
  LoginRouteComponent,
} from "./route-components.tsx";
import { rootRoute } from "./root-route.ts";

/**
 * Rutas públicas (TI2-133): índice, acceso y estado denegado.
 *
 * Sin sesión no cargan contenido protegido y conservan intactos el callback
 * OAuth y la ruta de retorno.
 */

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: IndexRouteComponent,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: LoginRouteComponent,
});

const deniedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/denegado",
  component: DeniedRouteComponent,
});

export const publicRoutes = [indexRoute, loginRoute, deniedRoute] as const;
