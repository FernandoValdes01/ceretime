import { CALENDAR_EVENTS_SCOPE } from "../../../../../convex/domain/index.ts";

/**
 * Caso de uso del cliente: consentimiento separado de Google Calendar
 * (TI2-122).
 *
 * El inicio institucional pide solo identidad. Cuando la persona decide
 * agregar una atención a su calendario, este flujo pide el alcance mínimo de
 * creación de eventos (`calendar.events`) sobre la misma cuenta de Google ya
 * vinculada. No lee el calendario ni solicita otros alcances.
 *
 * `callbackURL` y `errorCallbackURL` son navegación posterior dentro de la SPA;
 * el redirect OAuth siempre es `/api/auth/callback/google` en el Site URL de
 * Convex. El marcador `calendar` permite mostrar un aviso genérico sin
 * detalles del proveedor.
 */

export type CalendarCallbackStatus = "connected" | "error";

export function getCalendarLinkRequest(callbackPath: string) {
  return {
    provider: "google" as const,
    scopes: [CALENDAR_EVENTS_SCOPE],
    callbackURL: withCalendarStatus(callbackPath, "connected"),
    errorCallbackURL: withCalendarStatus(callbackPath, "error"),
  };
}

function withCalendarStatus(path: string, status: CalendarCallbackStatus): string {
  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.set("calendar", status);
  return `${pathname}?${params.toString()}`;
}

/** Lee el marcador de retorno sin aceptar valores fuera del contrato. */
export function toCalendarCallbackStatus(value: unknown): CalendarCallbackStatus | undefined {
  return value === "connected" || value === "error" ? value : undefined;
}
