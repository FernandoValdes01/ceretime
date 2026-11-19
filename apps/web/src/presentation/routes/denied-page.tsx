import { Link } from "@tanstack/react-router";

/**
 * Estado de acceso denegado (TI2-6, TI2-182).
 *
 * Página pública y estática: no lee sesión ni contenido protegido, así que
 * es segura tanto sin sesión como con sesión de otra población. Mensaje
 * genérico, sin exponer motivos ni datos del apoyo. También es el destino de
 * una cuenta de personal que aún no está habilitada, así que explica ese
 * estado sin confirmar si es el caso de quien mira.
 */
export function DeniedPage() {
  return (
    <section aria-labelledby="denied-title">
      <h1 id="denied-title">Acceso denegado</h1>
      <p>No tienes acceso a esta sección.</p>
      <p>Si eres estudiante, inicia sesión para continuar.</p>
      <p>
        Si eres parte del personal, CERETI debe habilitar tu cuenta antes de que puedas usar el área
        de gestión. Si crees que es un error, comunícate con CERETI por sus canales oficiales.
      </p>
      <p>
        <Link to="/login">Ir al acceso</Link>
      </p>
    </section>
  );
}
