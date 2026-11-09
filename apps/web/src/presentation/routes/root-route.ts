import { createRootRoute } from "@tanstack/react-router";
import { NotFoundRedirect, RootComponent } from "./route-components.tsx";

/**
 * Raíz del router (TI2-133).
 *
 * Aísla la raíz en su propio módulo para que cada área importe el mismo nodo
 * sin depender del archivo que compone el árbol completo.
 */
export const rootRoute = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundRedirect,
});
