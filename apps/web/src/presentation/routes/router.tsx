import { createRouter, type RouterHistory } from "@tanstack/react-router";
import { adminRoutes } from "./admin-routes.ts";
import { practitionerRoutes } from "./practitioner-routes.ts";
import { professionalRoutes } from "./professional-routes.ts";
import { publicRoutes } from "./public-routes.ts";
import { rootRoute } from "./root-route.ts";
import { studentRoutes } from "./student-routes.ts";

/**
 * Composición del mapa de rutas web (TI2-133).
 *
 * Cada área define su árbol en su propio archivo (`public-routes.ts`,
 * `student-routes.ts`, `professional-routes.ts`, `practitioner-routes.ts`,
 * `admin-routes.ts`); este archivo solo los cuelga de la raíz, sin cambiar
 * URL ni guardias.
 *
 * Rutas vigentes:
 * - `/` índice, `/login?redirect=…` y `/denegado` son públicas.
 * - `/estudiante`, `/profesional`, `/practicante` y `/administrador` son
 *   layouts protegidos por rol; cada vista cuelga de su layout.
 * - Ruta desconocida: vuelve al índice, que deriva según sesión.
 *
 * Cómo agregar una ruta: define el `createRoute` en el archivo del área,
 * agrégalo a `addChildren` de ese layout y, si debe aparecer en la
 * navegación, agrega el enlace a la lista del portal en `navigation.ts`.
 * `docs/rutas-web.md` describe el procedimiento completo.
 */

const routeTree = rootRoute.addChildren([
  ...publicRoutes,
  ...studentRoutes,
  ...professionalRoutes,
  ...practitionerRoutes,
  ...adminRoutes,
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
