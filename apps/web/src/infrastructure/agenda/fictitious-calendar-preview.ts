/**
 * Vista previa externa de calendario con datos ficticios (TI2-87).
 *
 * Adaptador Web provisional para Google Calendar y la alternativa `.ics`:
 * usa títulos genéricos que no revelan CERETI ni datos sensibles fuera de
 * sesión, con respuestas tipadas a la forma `v1`. No implementa reglas de
 * negocio ni hace red; se reemplaza por la acción del backend en las tareas
 * de conexión.
 */

export const GENERIC_CALENDAR_TITLE = "Atención programada";

export interface FictitiousCalendarPreview {
  readonly eventId: string;
  readonly title: typeof GENERIC_CALENDAR_TITLE;
  readonly icsContent: string;
  readonly version: "v1";
}

export type FictitiousCalendarMode = "success" | "error";

export interface FictitiousCalendarPreviewOptions {
  readonly mode?: FictitiousCalendarMode;
}

/** Mensaje genérico de la vista previa, sin detalles internos. */
export const FICTITIOUS_CALENDAR_ERROR = "No pudimos preparar el evento ficticio.";

function toFictitiousIcs(reservationId: string): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    `UID:${reservationId}@ficticio.cereti`,
    "SUMMARY:Atención programada",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function createFictitiousCalendarPreview(options: FictitiousCalendarPreviewOptions = {}) {
  const { mode = "success" } = options;
  return {
    async previewCalendarEvent(reservationId: string): Promise<FictitiousCalendarPreview> {
      if (mode === "error") throw new Error(FICTITIOUS_CALENDAR_ERROR);
      return {
        eventId: `fictitious-${reservationId}`,
        title: GENERIC_CALENDAR_TITLE,
        icsContent: toFictitiousIcs(reservationId),
        version: "v1",
      };
    },
  };
}
