import { Link } from "@tanstack/react-router";
import { AppShell } from "./app-shell.tsx";

/**
 * Portales del personal con cuenta institucional (TI2-20, TI2-103, TI2-04,
 * TI2-116, TI2-133).
 *
 * La estructura, la navegación por rol y el cierre de sesión viven en
 * `AppShell`; cada portal solo fija su área. Las vistas funcionales (bandejas,
 * agenda, administración) cuelgan de estos layouts tras el mismo guard.
 *
 * El portal de Administración enlaza el editor de espacios (TI2-04) y no
 * enlaza acompañamientos ni notas internas (coherente con la matriz TI2-5,
 * donde el Administrador no lista ni lee esos recursos). El portal del
 * Practicante enlaza solo su listado de acompañamientos asignados (TI2-116),
 * en solo lectura; el Backend decide qué acompañamientos incluye. El portal
 * del Profesional enlaza solicitudes (TI2-91), agenda (TI2-115) y
 * disponibilidad (TI2-103).
 */

export function ProfessionalLayout() {
  return <AppShell area="professional" />;
}

export function PractitionerLayout() {
  return <AppShell area="practitioner" />;
}

export function AdminLayout() {
  return <AppShell area="admin" />;
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
      <p>
        Consulta en solo lectura tus acompañamientos asignados desde{" "}
        <Link to="/practicante/acompanamientos">Acompañamientos</Link>.
      </p>
    </section>
  );
}

export function AdminHome() {
  return (
    <section aria-labelledby="admin-home-title">
      <h1 id="admin-home-title">Portal de Administración</h1>
      <p>Gestiona los espacios de atención desde el editor de espacios.</p>
    </section>
  );
}
