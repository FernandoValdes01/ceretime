/**
 * Etiquetas del panel del Estudiante (Presentación web).
 *
 * Mapas locales como en mobile: los literales persistidos viajan en
 * snake_case y acá solo se traducen a español para mostrarlos. El estado
 * siempre se comunica con texto, nunca solo con color.
 */

const REQUEST_STATUS_LABELS: Record<string, string> = {
  received: "Recibida",
  under_review: "En revisión",
  awaiting_information_or_acceptance: "Esperando información o aceptación",
  accepted: "Aceptada",
  referred: "Derivada",
  closed_without_accompaniment: "Cerrada sin acompañamiento",
  cancelled: "Cancelada",
};

const ACCOMPANIMENT_STATUS_LABELS: Record<string, string> = {
  active: "Activo",
  paused: "Pausado",
  closed: "Cerrado",
};

/** Etiqueta en español de un estado de solicitud; ante un literal desconocido muestra el valor. */
export function requestStatusLabel(status: string): string {
  return REQUEST_STATUS_LABELS[status] ?? status;
}

/** Etiqueta en español de un estado de acompañamiento; ante un literal desconocido muestra el valor. */
export function accompanimentStatusLabel(status: string): string {
  return ACCOMPANIMENT_STATUS_LABELS[status] ?? status;
}

const PANEL_DATE_FORMAT = new Intl.DateTimeFormat("es-CL", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** Fecha legible de un `createdAt` en milisegundos (p. ej. «12 de sep de 2026»). */
export function formatPanelDate(timestamp: number): string {
  return PANEL_DATE_FORMAT.format(new Date(timestamp));
}
