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
  AdminSpacesRouteComponent,
  IndexRouteComponent,
  LoginRouteComponent,
  NotFoundRedirect,
  PractitionerAccompanimentDetailRouteComponent,
  PractitionerAccompanimentsRouteComponent,
  PractitionerIndexRouteComponent,
  PractitionerLayoutRouteComponent,
  ProfessionalAgendaDetailRouteComponent,
  ProfessionalAgendaRouteComponent,
  ProfessionalAvailabilityRouteComponent,
  ProfessionalIndexRouteComponent,
  ProfessionalLayoutRouteComponent,
  ProfessionalRequestDetailRouteComponent,
  ProfessionalRequestsRouteComponent,
  RootComponent,
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

/**
 * Mapa de rutas web (TI2-6, TI2-20, TI2-89, TI2-90, TI2-91, TI2-103, TI2-04, TI2-114, TI2-115, TI2-116, Sprint 1, 2 y 3).
 *
 * - `/` índice: acceso sin sesión (preserva callback OAuth de TI2-3),
 *   portal según sesión y rol, denegado sin portal conocido.
 * - `/login?redirect=…` acceso público; conserva la ruta de retorno.
 * - `/denegado` estado público de acceso denegado, sin contenido protegido.
 * - `/estudiante` layout protegido (sesión de Estudiante) con portada
 *   temporal; las vistas funcionales de Sprint 2 cuelgan de este layout.
 * - `/estudiante/solicitudes`: listado propio paginado del Estudiante
 *   (TI2-89); `/estudiante/solicitudes/$requestId`: detalle propio solo del
 *   titular, denegado por el Backend en otro caso.
 * - `/estudiante/acompanamientos/$accompanimentId`: detalle del
 *   acompañamiento propio solo del titular (TI2-90), denegado por el Backend
 *   en otro caso; los cerrados se muestran en solo lectura, sin notas
 *   internas.
 * - `/estudiante/atenciones`: lista propia de atenciones del Estudiante
 *   (TI2-114) por el puerto común de agenda, conectado a la API por
 *   TI2-123; `/estudiante/atenciones/$appointmentId`: detalle con los
 *   estados textuales de realización, cancelación e inasistencia.
 * - `/profesional`, `/practicante` y `/administrador`: layouts protegidos
 *   por rol con portada temporal; sin sesión van al acceso, con otro rol
 *   van a denegado. El portal de Administración no enlaza acompañamientos
 *   ni notas internas.
 * - `/administrador/espacios`: editor de espacios del Administrador con los
 *   campos del contrato y guardado simulado (TI2-04); la escritura real del
 *   catálogo no está entregada (TI2-99 entrega lectura, no escritura).
 * - `/profesional/solicitudes`: bandeja minimizada y tomadas del Profesional
 *   (TI2-91); `/profesional/solicitudes/$requestId`: detalle completo solo
 *   con toma activa, denegado por el Backend en otro caso.
 * - `/profesional/disponibilidad`: editor tipado de bloques recurrentes y
 *   excepciones del Profesional con lectura y guardado contra la API
 *   (TI2-103/TI2-125); composición reservada para `/estudiante/horarios`
 *   (TI2-101) y `/estudiante/reservar` (TI2-102) sin editar sus páginas.
 * - `/profesional/agenda`: atenciones reservadas del Profesional con lectura
 *   y cambios de estado contra la API (TI2-115/TI2-125);
 *   `/profesional/agenda/$appointmentId`: detalle de una atención propia,
 *   denegado por el Backend en otro caso. La autorización efectiva sigue
 *   viva en Convex; la página declara que consulta la API.
 * - `/practicante/acompanamientos`: acompañamientos con asignación vigente
 *   del Practicante en vista minimizada y solo lectura (TI2-116);
 *   `/practicante/acompanamientos/$accompanimentId`: detalle minimizado,
 *   denegado por el Backend sin asignación vigente aunque se conserve la URL.
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

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  deniedRoute,
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
  professionalLayoutRoute.addChildren([
    professionalIndexRoute,
    professionalRequestsRoute,
    professionalRequestDetailRoute,
    professionalAvailabilityRoute,
    professionalAgendaRoute,
    professionalAgendaDetailRoute,
  ]),
  practitionerLayoutRoute.addChildren([
    practitionerIndexRoute,
    practitionerAccompanimentsRoute,
    practitionerAccompanimentDetailRoute,
  ]),
  adminLayoutRoute.addChildren([adminIndexRoute, adminSpacesRoute]),
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
