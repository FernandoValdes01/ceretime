import { AGENDA_TIME_ZONE } from "../../../../../convex/domain/availability/availability";

export function formatRequestDate(value: string): string {
  // Las fechas civiles no son instantes. Los instantes se muestran en la zona de CERETI.
  const civilDate = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Intl.DateTimeFormat("es-CL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: civilDate ? "UTC" : AGENDA_TIME_ZONE,
  }).format(new Date(civilDate ? `${value}T12:00:00.000Z` : value));
}
