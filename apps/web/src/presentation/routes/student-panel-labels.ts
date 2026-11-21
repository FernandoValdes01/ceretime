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

/**
 * Qué significa cada estado para el Estudiante (TI2-153): la etiqueta sola no
 * dice qué sigue. Describe lo ocurrido, no reglas que la Web decida.
 */
const REQUEST_STATUS_DESCRIPTIONS: Record<string, string> = {
  received: "CERETI recibió tu solicitud. Un profesional la revisará pronto.",
  under_review: "Un profesional de CERETI está revisando tu solicitud.",
  awaiting_information_or_acceptance:
    "CERETI necesita tu respuesta para continuar con la solicitud.",
  accepted: "CERETI aceptó tu solicitud y abrió tu acompañamiento.",
  referred: "CERETI derivó tu solicitud a otra unidad, que se encargará de ella.",
  closed_without_accompaniment: "CERETI cerró la solicitud sin abrir un acompañamiento.",
  cancelled: "Cancelaste esta solicitud. Si lo necesitas, puedes enviar una nueva.",
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

/** Explicación en español de un estado de solicitud; ante un literal desconocido no explica nada. */
export function requestStatusDescription(status: string): string | null {
  return REQUEST_STATUS_DESCRIPTIONS[status] ?? null;
}

/** Etiqueta en español de un estado de acompañamiento; ante un literal desconocido muestra el valor. */
export function accompanimentStatusLabel(status: string): string {
  return ACCOMPANIMENT_STATUS_LABELS[status] ?? status;
}

import { formatAgendaShortDate } from "../shared/date-format.ts";

/** Fecha legible de un `createdAt` en milisegundos (p. ej. «12 sept 2026»). */
export function formatPanelDate(timestamp: number): string {
  return formatAgendaShortDate(timestamp);
}
