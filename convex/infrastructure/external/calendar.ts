/**
 * Adaptadores externos de calendario: puertos tipados con datos ficticios (TI2-87).
 *
 * Capa de Infraestructura: fija los puertos que otros módulos usarán en
 * `action` para Google Calendar y la alternativa `.ics`, sin hacer E/S real
 * acá. La integración mínima ocurre por atención y con acción explícita, con
 * títulos genéricos que no revelan CERETI ni datos sensibles fuera de sesión.
 * Este archivo solo aporta tipos versionados y un puerto ficticio para
 * pruebas y demostraciones; no implementa reglas de negocio ni guarda nada.
 */

import type { ApiResult } from "../../domain/errors/api_error";

/** Versión del puerto externo de calendario. */
export const CALENDAR_PORT_CONTRACT_VERSION = "v1" as const;

export type CalendarPortContractVersion = typeof CALENDAR_PORT_CONTRACT_VERSION;

/** Solicitud mínima para crear un evento externo por atención. */
export interface ExternalCalendarEventRequest {
  readonly reservationId: string;
  /** Título genérico, p. ej. "Atención programada", sin datos sensibles. */
  readonly title: string;
  readonly startAt: number;
  readonly endAt: number;
  readonly version: CalendarPortContractVersion;
}

/** Comprobante ficticio de un evento externo creado. */
export interface ExternalCalendarEventReceipt {
  readonly eventId: string;
  /** Contenido `.ics` alternativo con título genérico, sin datos sensibles. */
  readonly icsContent: string;
  readonly version: CalendarPortContractVersion;
}

/** Puerto externo inyectable: producción usa HTTP y pruebas el ficticio. */
export interface CalendarPort {
  createEvent(
    request: ExternalCalendarEventRequest,
  ): Promise<ApiResult<ExternalCalendarEventReceipt>>;
  toIcs(request: ExternalCalendarEventRequest): string;
}

/** Título genérico que nunca revela CERETI ni el tipo de acompañamiento. */
export const GENERIC_CALENDAR_TITLE = "Atención programada";

/** Construye un `.ics` mínimo con título genérico y fechas en UTC. */
export function toGenericIcs(request: ExternalCalendarEventRequest): string {
  const stamp = new Date(request.startAt).toISOString();
  const end = new Date(request.endAt).toISOString();
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    `UID:${request.reservationId}@ficticio.cereti`,
    `DTSTAMP:${stamp.replace(/[-:]/g, "").split(".")[0]}Z`,
    `DTSTART:${stamp.replace(/[-:]/g, "").split(".")[0]}Z`,
    `DTEND:${end.replace(/[-:]/g, "").split(".")[0]}Z`,
    `SUMMARY:${request.title}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/**
 * Puerto ficticio para pruebas y demostraciones: no hace red ni persiste.
 * Rechaza rangos que no avanzan con un error público estable, sin detalles
 * internos; el resto devuelve un comprobante ficticio tipado.
 */
export function createFictitiousCalendarPort(): CalendarPort {
  return {
    async createEvent(request) {
      if (!Number.isFinite(request.startAt) || !Number.isFinite(request.endAt)) {
        return {
          status: "error",
          error: {
            code: "reservation_invalid_time_range",
            message: "El rango de la reserva debe avanzar en el tiempo.",
          },
        };
      }
      if (request.startAt >= request.endAt) {
        return {
          status: "error",
          error: {
            code: "reservation_invalid_time_range",
            message: "El rango de la reserva debe avanzar en el tiempo.",
          },
        };
      }
      if (request.title.trim().length === 0) {
        return {
          status: "error",
          error: {
            code: "reservation_invalid_time_range",
            message: "El rango de la reserva debe avanzar en el tiempo.",
          },
        };
      }
      return {
        status: "ok",
        data: {
          eventId: `fictitious-${request.reservationId}`,
          icsContent: toGenericIcs(request),
          version: CALENDAR_PORT_CONTRACT_VERSION,
        },
      };
    },
    toIcs(request) {
      return toGenericIcs(request);
    },
  };
}
