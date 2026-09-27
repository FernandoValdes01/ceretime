import { RouterProvider } from "@tanstack/react-router";
import { appRouter } from "./presentation/routes/router.tsx";

/**
 * Raíz de Presentación web (TI2-6): router con rutas públicas de acceso y
 * portal protegido del Estudiante. La autorización efectiva vive en Convex;
 * las vistas funcionales del portal llegan en Sprint 2.
 */
function App() {
  return <RouterProvider router={appRouter} />;
}

export default App;
