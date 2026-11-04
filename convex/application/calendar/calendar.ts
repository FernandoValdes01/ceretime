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
import { isCalendarActionableStatus } from "../../domain/appointments/appointment";
import type { AppointmentStatus } from "../../domain/appointments/appointment";
import { isProfileActive } from "../../domain/authorization/permissions";
import {
  conflictError,
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
  readonly status: AppointmentStatus;
  readonly startAt: number;
  readonly endAt: number;
  /** Instante estable de creación de la atención; se usa como `DTSTAMP`. */
  readonly createdAt: number;
  readonly calendarEventId?: string;
  readonly calendarEventAddedAt?: number;
  /** Horario con el que se creó o actualizó el evento en Google Calendar. */
  readonly calendarEventStartsAt?: number;
  readonly calendarEventEndsAt?: number;
};

/** Lectura y escritura de la referencia del evento en la atención. */
export interface CalendarAppointmentReader {
  getAppointment(appointmentId: string): Promise<CalendarAppointmentRow | null>;
  recordCalendarEvent(input: {
    readonly appointmentId: string;
    readonly eventId: string;
    readonly addedAt: number;
    readonly startsAt: number;
    readonly endsAt: number;
  }): Promise<void>;
}

/** Contexto mínimo de una atención autorizada para calendario. */
export interface CalendarAppointmentContext {
  readonly appointmentId: string;
  readonly status: AppointmentStatus;
  readonly startAt: number;
  readonly endAt: number;
  /** Instante estable de creación: el `.ics` no depende del reloj de la consulta. */
  readonly createdAt: number;
  readonly reference: { readonly eventId: string; readonly addedAt: number } | null;
  /**
   * Verdadero solo si la referencia guardada se sincronizó con el horario
   * vigente. Una referencia ausente o con el horario anterior está obsoleta.
   */
  readonly referenceIsCurrent: boolean;
}

/** Resultado del proveedor externo, sin respuestas ni credenciales. */
export type GoogleCalendarCreateOutcome =
  | { readonly status: "created"; readonly eventId: string }
  | { readonly status: "already_exists"; readonly eventId: string }
  | { readonly status: "not_connected" }
  | { readonly status: "unavailable" };

/** Resultado de actualizar el evento de una atención ya creada. */
export type GoogleCalendarUpdateOutcome =
  | { readonly status: "updated"; readonly eventId: string }
  | { readonly status: "not_connected" }
  | { readonly status: "unavailable" };

/** Puerto del proveedor de calendario: crea y actualiza, nunca lee la agenda. */
export interface GoogleCalendarGateway {
  createEvent(input: {
    readonly googleEventId: string;
    readonly title: string;
    readonly startAt: number;
    readonly endAt: number;
    readonly timeZone: string;
  }): Promise<GoogleCalendarCreateOutcome>;
  updateEvent(input: {
    readonly googleEventId: string;
    readonly title: string;
    readonly startAt: number;
    readonly endAt: number;
    readonly timeZone: string;
  }): Promise<GoogleCalendarUpdateOutcome>;
}

/** Lectura de los alcances OAuth vinculados a la sesión. */
export interface CalendarConnectionReader {
  listGoogleScopes(): Promise<readonly string[] | null>;
}

/** Resultado público de agregar una atención al calendario. */
export type AppointmentCalendarResult =
  | { readonly status: "created"; readonly eventId: string; readonly ics: CalendarFile }
  | { readonly status: "updated"; readonly eventId: string; readonly ics: CalendarFile }
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
  const reference =
    appointment.calendarEventId === undefined
      ? null
      : {
          eventId: appointment.calendarEventId,
          addedAt: appointment.calendarEventAddedAt ?? 0,
        };
  return {
    appointmentId: appointment._id,
    status: appointment.status,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    createdAt: appointment.createdAt,
    reference,
    referenceIsCurrent:
      reference !== null &&
      appointment.calendarEventStartsAt === appointment.startAt &&
      appointment.calendarEventEndsAt === appointment.endAt,
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
  // Solo una atención vigente puede exportarse: un `.ics` con
  // `STATUS:CONFIRMED` para una atención cancelada, realizada o con
  // inasistencia representaría un estado que ya no es real.
  if (!isCalendarActionableStatus(context.status)) return errResult(conflictError());
  return okResult({
    ...buildFile(context, input.timeZone),
    alreadyAdded: context.referenceIsCurrent,
  });
}

/** Dependencias compartidas por las acciones que crean o actualizan el evento. */
interface CalendarEventActionDeps {
  readonly loadAppointment: (input: {
    readonly tokenIdentifier: string | null;
    readonly appointmentId: string;
  }) => Promise<CalendarAppointmentContext | null>;
  readonly recordEvent: (input: {
    readonly appointmentId: string;
    readonly eventId: string;
    readonly addedAt: number;
    readonly startsAt: number;
    readonly endsAt: number;
  }) => Promise<void>;
  readonly google: GoogleCalendarGateway;
}

async function recordEventReference(
  deps: CalendarEventActionDeps,
  context: CalendarAppointmentContext,
  eventId: string,
  addedAt: number,
): Promise<void> {
  try {
    await deps.recordEvent({
      appointmentId: context.appointmentId,
      eventId,
      addedAt,
      startsAt: context.startAt,
      endsAt: context.endAt,
    });
  } catch {
    // El evento ya existe y su identificador es determinista: el próximo
    // intento lo recupera sin duplicarlo. No se expone el fallo interno.
  }
}

/**
 * Agrega la atención al calendario personal con una acción explícita.
 *
 * Si la referencia guardada coincide con el horario vigente, no llama al
 * proveedor: responde `already_created`. Si la referencia existe pero conserva
 * el horario anterior, está desactualizada: no se confirma como agregada, se
 * actualiza el mismo evento y se responde `updated`. Si el proveedor no está
 * vinculado o falla, devuelve `fallback` con el `.ics` vigente y sin detalles
 * externos. La referencia guarda el horario del evento; un reagendamiento la
 * deja obsoleta hasta la próxima actualización explícita.
 */
export async function addAppointmentToGoogleCalendar(
  deps: CalendarEventActionDeps & { readonly now: () => number },
  input: {
    readonly tokenIdentifier: string | null;
    readonly appointmentId: string;
    readonly timeZone: string;
  },
): Promise<ApiResult<AppointmentCalendarResult>> {
  const context = await deps.loadAppointment(input);
  if (context === null) return errResult(unauthorizedError());
  // La acción pública no puede crear un evento confirmado para una atención
  // que ya no está vigente. La UI oculta la acción, pero la regla vive acá.
  if (!isCalendarActionableStatus(context.status)) return errResult(conflictError());

  const event = buildCalendarEvent({
    appointmentId: context.appointmentId,
    startAt: context.startAt,
    endAt: context.endAt,
    timeZone: input.timeZone,
    generatedAt: context.createdAt,
  });
  const ics = toCalendarFile(event);

  if (context.reference !== null) {
    if (context.referenceIsCurrent) {
      return okResult({ status: "already_created", eventId: context.reference.eventId, ics });
    }
    const update = await deps.google.updateEvent({
      googleEventId: context.reference.eventId,
      title: event.title,
      startAt: event.startAt,
      endAt: event.endAt,
      timeZone: event.timeZone,
    });
    if (update.status === "not_connected" || update.status === "unavailable") {
      return okResult({ status: "fallback", reason: update.status, ics });
    }
    await recordEventReference(deps, context, update.eventId, context.reference.addedAt);
    return okResult({ status: "updated", eventId: update.eventId, ics });
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

  await recordEventReference(deps, context, outcome.eventId, deps.now());

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
