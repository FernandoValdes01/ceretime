import { Link, Outlet } from "@tanstack/react-router";
import "./student-portal.css";

/**
 * Estructura del portal del Estudiante (TI2-6).
 *
 * Solo navegación y protección: el encabezado enlaza el inicio del portal
 * y la sesión (donde vive el cierre). Las vistas funcionales de
 * solicitudes, agenda y seguimiento llegan en Sprint 2 y cuelgan de este
 * layout tras el mismo guard.
 */
export function StudentLayout() {
  return (
    <div className="student-portal">
      <header className="student-portal__header">
        <nav aria-label="Portal del Estudiante">
          <Link to="/estudiante">Inicio</Link> <Link to="/login">Sesión</Link>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}

/**
 * Portada del portal (TI2-6): marcador de posición sin vistas funcionales.
 * No lee datos del Backend; el contenido protegido lo traerá Sprint 2.
 */
export function StudentHome() {
  return (
    <section aria-labelledby="student-home-title">
      <h1 id="student-home-title">Portal del Estudiante</h1>
      <p>Tus solicitudes y acompañamientos estarán disponibles aquí.</p>
    </section>
  );
}
