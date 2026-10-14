import { REQUEST_STATE_LABELS } from "../../../../../convex/domain/index.ts";

/**
 * Etiquetas de gestión del Profesional (TI2-91).
 *
 * Derivan del contrato canónico del dominio, sin duplicar literales: si el
 * Backend agrega un estado, la etiqueta llega sola. Ante un literal
 * desconocido se muestra el valor, igual que el panel del Estudiante. El
 * estado siempre se comunica con texto, nunca solo con color.
 */
export function requestStatusLabel(status: string): string {
  return (REQUEST_STATE_LABELS as Record<string, string>)[status] ?? status;
}
