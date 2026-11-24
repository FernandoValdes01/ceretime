import { ErrorState } from "../shared/view-states.tsx";

/**
 * Reintento de lectura para el portal de Administración (TI2-169).
 *
 * Una sola definición para las secciones con lectura paginada: mismo mensaje
 * según el recurso y mismo botón de reintento, con la variante blanca de los
 * estados compartidos.
 */
export function adminLoadFallback({ subject, retry }: { subject: string; retry: () => void }) {
  return (
    <ErrorState
      tone="admin"
      message={`No pudimos cargar ${subject}. Inténtalo de nuevo.`}
      onRetry={retry}
    />
  );
}
