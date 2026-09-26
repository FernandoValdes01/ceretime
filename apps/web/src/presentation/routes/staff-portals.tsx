import type { ReactNode } from "react";
import { Link, Outlet } from "@tanstack/react-router";
import "./staff-portal.css";

/**
 * Portales del personal con cuenta institucional (TI2-20).
 *
 * Solo navegación y protección, como el portal del Estudiante de TI2-6: cada
 * layout enlaza su inicio y la sesión, y cada portada es temporal. Las
 * vistas funcionales (bandejas, agenda, administración) llegan en Sprint 2
 * y cuelgan de estos layouts tras el mismo guard.
 *
 * El portal de Administración no enlaza acompañamientos ni notas internas
 * (coherente con la matriz TI2-5, donde el Administrador no lista ni lee
 * esos recursos). El portal del Practicante no enlaza acompañamientos
 * concretos: solo verá los asignados cuando existan las vistas.
 */

function StaffLayout({ title, home }: { title: string; home: ReactNode }) {
  return (
    <div className="staff-portal">
      <header className="staff-portal__header">
        <nav aria-label={title}>
          {home} <Link to="/login">Sesión</Link>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}

export function ProfessionalLayout() {
  return (
    <StaffLayout title="Portal del Profesional" home={<Link to="/profesional">Inicio</Link>} />
  );
}

export function PractitionerLayout() {
  return (
    <StaffLayout title="Portal del Practicante" home={<Link to="/practicante">Inicio</Link>} />
  );
}

export function AdminLayout() {
  return (
    <StaffLayout title="Portal de Administración" home={<Link to="/administrador">Inicio</Link>} />
  );
}

export function ProfessionalHome() {
  return (
    <section aria-labelledby="professional-home-title">
      <h1 id="professional-home-title">Portal del Profesional</h1>
      <p>Tus solicitudes y acompañamientos asignados estarán disponibles aquí.</p>
    </section>
  );
}

export function PractitionerHome() {
  return (
    <section aria-labelledby="practitioner-home-title">
      <h1 id="practitioner-home-title">Portal del Practicante</h1>
      <p>Tus acompañamientos asignados estarán disponibles aquí.</p>
    </section>
  );
}

export function AdminHome() {
  return (
    <section aria-labelledby="admin-home-title">
      <h1 id="admin-home-title">Portal de Administración</h1>
      <p>La gestión administrativa estará disponible aquí.</p>
    </section>
  );
}
