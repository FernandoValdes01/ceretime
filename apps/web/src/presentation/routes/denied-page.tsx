import { Link } from "@tanstack/react-router";

/**
 * Estado de acceso denegado (TI2-6).
 *
 * Página pública y estática: no lee sesión ni contenido protegido, así que
 * es segura tanto sin sesión como con sesión de otra población. Mensaje
 * genérico, sin exponer motivos ni datos del apoyo.
 */
export function DeniedPage() {
  return (
    <section aria-labelledby="denied-title">
      <h1 id="denied-title">Acceso denegado</h1>
      <p>No tienes acceso a esta sección.</p>
      <p>Si eres estudiante, inicia sesión para continuar.</p>
      <p>
        <Link to="/login">Ir al acceso</Link>
      </p>
    </section>
  );
}
