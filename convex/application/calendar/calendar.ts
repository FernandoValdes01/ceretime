/**
 * Casos de uso del calendario por atención (TI2-122).
 *
 * Capa de Aplicación: compone la autorización de la atención concreta, la
 * construcción pura del evento y el puerto del proveedor externo. No conoce
 * Convex, Google ni detalles de persistencia: recibe lecturas y escrituras por
 * puertos y decide solo el flujo. Un fallo del proveedor nunca revierte la
 * reserva ni se propaga con su respuesta: se traduce a un respaldo `.ics`
 * genérico.
 */

import {
  buildCalendarEvent,
  CALENDAR_EVENTS_SCOPE,
  toCalendarFile,
  type CalendarFile,
} from "../../domain/calendar/calendar_event";
import { isProfileActive } from "../../domain/authorization/permissions";
import {
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import {
  authorizeAppointmentCalendar,
  type AuthorizableAppointment,
  type AuthorizationReader,
} from "../authorization/authorize";

/** Fila de atención que necesita el calendario, ya autorizada por pertenencia. */
export type CalendarAppointmentRow = AuthorizableAppointment & {
  readonly startAt: number;
  readonly endAt: number;
  /** Instante estable de creación de la atención; se usa como `DTSTAMP`. */
  readonly createdAt: number;
  readonly calendarEventId?: string;
  readonly calendarEventAddedAt?: number;
};

/** Lectura y escritura de la referencia del evento en la atención. */
export interface CalendarAppointmentReader {
  getAppointment(appointmentId: string): Promise<CalendarAppointmentRow | null>;
  recordCalendarEvent(input: {
    readonly appointmentId: string;
    readonly eventId: string;
    readonly addedAt: number;
  }): Promise<void>;
}

/** Contexto mínimo de una atención autorizada para calendario. */
export interface CalendarAppointmentContext {
  readonly appointmentId: string;
  readonly startAt: number;
  readonly endAt: number;
  /** Instante estable de creación: el `.ics` no depende del reloj de la consulta. */
  readonly createdAt: number;
  readonly reference: { readonly eventId: string; readonly addedAt: number } | null;
}

/** Resultado del proveedor externo, sin respuestas ni credenciales. */
export type GoogleCalendarCreateOutcome =
  | { readonly status: "created"; readonly eventId: string }
  | { readonly status: "already_exists"; readonly eventId: string }
  | { readonly status: "not_connected" }
  | { readonly status: "unavailable" };

/** Puerto del proveedor de calendario: solo crea eventos, nunca lee la agenda. */
export interface GoogleCalendarGateway {
  createEvent(input: {
    readonly googleEventId: string;
    readonly title: string;
    readonly startAt: number;
    readonly endAt: number;
    readonly timeZone: string;
  }): Promise<GoogleCalendarCreateOutcome>;
}

/** Lectura de los alcances OAuth vinculados a la sesión. */
export interface CalendarConnectionReader {
  listGoogleScopes(): Promise<readonly string[] | null>;
}

/** Resultado público de agregar una atención al calendario. */
export type AppointmentCalendarResult =
  | { readonly status: "created"; readonly eventId: string; readonly ics: CalendarFile }
  | {
      readonly status: "already_created";
      readonly eventId: string;
      readonly ics: CalendarFile;
    }
  | {
      readonly status: "fallback";
      readonly reason: "not_connected" | "unavailable";
      readonly ics: CalendarFile;
    };

/** Archivo `.ics` y si la atención ya tiene un evento registrado. */
export type AppointmentCalendarFile = CalendarFile & { readonly alreadyAdded: boolean };

/**
 * Carga la atención y autoriza al Estudiante dueño. Un identificador ajeno,
 * inexistente, de otro acompañamiento o de un acompañamiento no activo
 * responde `null` sin revelar cuál faltó.
 */
export async function loadCalendarAppointment(
  deps: {
    readonly auth: AuthorizationReader;
    readonly appointments: Pick<CalendarAppointmentReader, "getAppointment">;
  },
  input: { readonly tokenIdentifier: string | null; readonly appointmentId: string },
): Promise<CalendarAppointmentContext | null> {
  const appointment = await deps.appointments.getAppointment(input.appointmentId);
  if (appointment === null) return null;
  const grant = await authorizeAppointmentCalendar(deps.auth, {
    tokenIdentifier: input.tokenIdentifier,
    appointment,
  });
  if (grant.status === "error") return null;
  return {
    appointmentId: appointment._id,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    createdAt: appointment.createdAt,
    reference:
      appointment.calendarEventId === undefined
        ? null
        : {
            eventId: appointment.calendarEventId,
            addedAt: appointment.calendarEventAddedAt ?? 0,
          },
  };
}

function buildFile(context: CalendarAppointmentContext, timeZone: string) {
  return toCalendarFile(
    buildCalendarEvent({
      appointmentId: context.appointmentId,
      startAt: context.startAt,
      endAt: context.endAt,
      timeZone,
      generatedAt: context.createdAt,
    }),
  );
}

/**
 * Entrega el `.ics` de una atención autorizada. No consulta Google ni requiere
 * consentimiento de Calendar: es la alternativa disponible desde el primer
 * momento, incluso si el proveedor está caído o la cuenta no está vinculada.
 * El `DTSTAMP` sale de la creación de la atención, así el archivo es estable y
 * la consulta no lee el reloj.
 */
export async function getAppointmentCalendarFile(
  deps: {
    readonly loadAppointment: (input: {
      readonly tokenIdentifier: string | null;
      readonly appointmentId: string;
    }) => Promise<CalendarAppointmentContext | null>;
  },
  input: {
    readonly tokenIdentifier: string | null;
    readonly appointmentId: string;
    readonly timeZone: string;
  },
): Promise<ApiResult<AppointmentCalendarFile>> {
  const context = await deps.loadAppointment(input);
  if (context === null) return errResult(unauthorizedError());
  return okResult({
    ...buildFile(context, input.timeZone),
    alreadyAdded: context.reference !== null,
  });
}

/**
 * Agrega la atención al calendario personal con una acción explícita.
 *
 * Si ya hay una referencia guardada, no llama al proveedor: responde
 * `already_created`. Si el proveedor no está vinculado o falla, devuelve
 * `fallback` con el `.ics` y sin detalles externos. La referencia se guarda
 * después de crear el evento; el identificador determinista hace que un
 * reintento no duplique aunque esa escritura falle.
 */
export async function addAppointmentToGoogleCalendar(
  deps: {
    readonly loadAppointment: (input: {
      readonly tokenIdentifier: string | null;
      readonly appointmentId: string;
    }) => Promise<CalendarAppointmentContext | null>;
    readonly recordEvent: (input: {
      readonly appointmentId: string;
      readonly eventId: string;
      readonly addedAt: number;
    }) => Promise<void>;
    readonly google: GoogleCalendarGateway;
    readonly now: () => number;
  },
  input: {
    readonly tokenIdentifier: string | null;
    readonly appointmentId: string;
    readonly timeZone: string;
  },
): Promise<ApiResult<AppointmentCalendarResult>> {
  const context = await deps.loadAppointment(input);
  if (context === null) return errResult(unauthorizedError());

  const addedAt = deps.now();
  const event = buildCalendarEvent({
    appointmentId: context.appointmentId,
    startAt: context.startAt,
    endAt: context.endAt,
    timeZone: input.timeZone,
    generatedAt: context.createdAt,
  });
  const ics = toCalendarFile(event);

  if (context.reference !== null) {
    return okResult({ status: "already_created", eventId: context.reference.eventId, ics });
  }

  const outcome = await deps.google.createEvent({
    googleEventId: event.googleEventId,
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    timeZone: event.timeZone,
  });
  if (outcome.status === "not_connected" || outcome.status === "unavailable") {
    return okResult({ status: "fallback", reason: outcome.status, ics });
  }

  try {
    await deps.recordEvent({
      appointmentId: context.appointmentId,
      eventId: outcome.eventId,
      addedAt,
    });
  } catch {
    // El evento ya existe y su identificador es determinista: el próximo
    // intento lo recupera sin duplicarlo. No se expone el fallo interno.
  }

  return okResult({
    status: outcome.status === "created" ? "created" : "already_created",
    eventId: outcome.eventId,
    ics,
  });
}

/**
 * Estado de la conexión de Google Calendar de la sesión.
 *
 * Solo confirma si el alcance mínimo de creación de eventos está concedido.
 * No devuelve tokens, identificadores de cuenta ni el correo de Google.
 */
export async function getCalendarConnection(
  deps: {
    readonly auth: AuthorizationReader;
    readonly connection: CalendarConnectionReader;
  },
  input: { readonly tokenIdentifier: string | null },
): Promise<ApiResult<{ readonly connected: boolean }>> {
  if (input.tokenIdentifier === null) return errResult(unauthorizedError());
  const profile = await deps.auth.findProfileByTokenIdentifier(input.tokenIdentifier);
  if (profile === null || !isProfileActive(profile)) return errResult(unauthorizedError());
  const scopes = await deps.connection.listGoogleScopes();
  return okResult({ connected: scopes !== null && scopes.includes(CALENDAR_EVENTS_SCOPE) });
}
