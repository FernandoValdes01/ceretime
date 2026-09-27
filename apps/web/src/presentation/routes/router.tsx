import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { DeniedPage } from "./denied-page.tsx";
import {
  AdminIndexRouteComponent,
  AdminLayoutRouteComponent,
  IndexRouteComponent,
  LoginRouteComponent,
  NotFoundRedirect,
  PractitionerIndexRouteComponent,
  PractitionerLayoutRouteComponent,
  ProfessionalIndexRouteComponent,
  ProfessionalLayoutRouteComponent,
  RootComponent,
  StudentIndexRouteComponent,
  StudentLayoutRouteComponent,
} from "./route-components.tsx";

/**
 * Mapa de rutas web (TI2-6, TI2-20, Sprint 1).
 *
 * - `/` índice: acceso sin sesión (preserva callback OAuth de TI2-3),
 *   portal según sesión y rol, denegado sin portal conocido.
 * - `/login?redirect=…` acceso público; conserva la ruta de retorno.
 * - `/denegado` estado público de acceso denegado, sin contenido protegido.
 * - `/estudiante` layout protegido (sesión de Estudiante) con portada
 *   temporal; las vistas funcionales de Sprint 2 cuelgan de este layout.
 * - `/profesional`, `/practicante` y `/administrador`: layouts protegidos
 *   por rol con portada temporal; sin sesión van al acceso, con otro rol
 *   van a denegado. El portal de Administración no enlaza acompañamientos
 *   ni notas internas.
 * - Ruta desconocida: vuelve al índice, que deriva según sesión.
 */

const rootRoute = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundRedirect,
});

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
  component: DeniedPage,
});

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

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  deniedRoute,
  studentLayoutRoute.addChildren([studentIndexRoute]),
  professionalLayoutRoute.addChildren([professionalIndexRoute]),
  practitionerLayoutRoute.addChildren([practitionerIndexRoute]),
  adminLayoutRoute.addChildren([adminIndexRoute]),
]);

/** Router de la app; acepta historial inyectado para probar navegación. */
export function createAppRouter(options?: { history?: RouterHistory }) {
  return createRouter({ routeTree, history: options?.history });
}

export const appRouter = createAppRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof appRouter;
  }
}
