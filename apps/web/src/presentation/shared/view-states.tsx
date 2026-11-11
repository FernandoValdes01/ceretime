import type { ReactNode } from "react";
import "./view-states.css";

/**
 * Estados de vista comunes de la Web (TI2-134).
 *
 * Cuatro estados con un solo lenguaje: carga, sin datos, error y acceso
 * denegado. Todos comunican en texto lo que ocurre y cómo seguir; ninguno
 * depende solo del color. La carga y el vacío se anuncian con `role="status"`,
 * el error y la denegación con `role="alert"`, y el error ofrece reintentar la
 * operación que falló.
 *
 * No contienen reglas de negocio: la pantalla decide el mensaje y la acción,
 * y la autorización efectiva sigue en Convex.
 */

/** Mensaje genérico de denegación, sin exponer el motivo ni la existencia. */
export const ACCESS_DENIED_MESSAGE =
  "No autorizado. Pide acceso por el canal oficial si corresponde.";

/** Operación en curso: se anuncia sin bloquear el resto de la vista. */
export function LoadingState({ label }: { label: string }) {
  return (
    <p role="status" className="view-state view-state--loading">
      {label}
    </p>
  );
}

/** Sin datos: explica por qué está vacío y qué hacer para que se llene. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="status" className="view-state view-state--empty">
      <p className="view-state__title">{title}</p>
      {children}
    </div>
  );
}

/** Operación fallida: anuncia el mensaje y permite reintentar. */
export function ErrorState({
  message,
  onRetry,
  retryLabel = "Reintentar",
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div>
      <p role="alert" className="view-state view-state--error">
        {message}
      </p>
      {onRetry === undefined ? null : (
        <div className="view-state__actions">
          <button type="button" className="view-state__retry" onClick={onRetry}>
            {retryLabel}
          </button>
        </div>
      )}
    </div>
  );
}

/** Acceso denegado: aviso genérico y una salida hacia el canal oficial. */
export function DeniedState({
  title = ACCESS_DENIED_MESSAGE,
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="view-state view-state--denied">
      <p role="alert" className="view-state__title">
        {title}
      </p>
      {description === undefined ? null : <p>{description}</p>}
    </div>
  );
}
