import { buildCalendarEvent } from "../../domain/calendar/calendar_event";
import {
  isCalendarActionableStatus,
  type AppointmentStatus,
} from "../../domain/appointments/appointment";
import {
  conflictError,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";

/** Acceso resuelto para un participante: token vigente o motivo genérico. */
export type CalendarSyncAccess =
  | { readonly status: "ok"; readonly accessToken: string }
  | { readonly status: "not_connected" }
  | { readonly status: "never_linked" }
  | { readonly status: "unavailable" };

/** Resultado de crear el evento en la sincronización automática. */
export type GoogleCalendarSyncCreateOutcome =
  | { readonly status: "created"; readonly eventId: string }
  | { readonly status: "already_exists"; readonly eventId: string }
  | { readonly status: "not_connected" }
  | { readonly status: "unavailable" };

/** Resultado de actualizar el evento en la sincronización automática. */
export type GoogleCalendarSyncUpdateOutcome =
  | { readonly status: "updated"; readonly eventId: string }
  | { readonly status: "not_connected" }
  | { readonly status: "unavailable" };

/** Resultado de eliminar el evento de una atención cancelada. */
export type GoogleCalendarSyncDeleteOutcome =
  | { readonly status: "deleted"; readonly eventId: string }
  | { readonly status: "not_found"; readonly eventId: string }
  | { readonly status: "not_connected" }
  | { readonly status: "unavailable" };

/** Puerto del proveedor para la sincronización automática. */
export interface CalendarSyncGateway {
  createEvent(input: {
    readonly googleEventId: string;
    readonly title: string;
    readonly startAt: number;
    readonly endAt: number;
    readonly timeZone: string;
  }): Promise<GoogleCalendarSyncCreateOutcome>;
  updateEvent(input: {
    readonly googleEventId: string;
    readonly title: string;
    readonly startAt: number;
    readonly endAt: number;
    readonly timeZone: string;
  }): Promise<GoogleCalendarSyncUpdateOutcome>;
  deleteEvent(input: { readonly googleEventId: string }): Promise<GoogleCalendarSyncDeleteOutcome>;
}

/** Horario y estado con los que el despacho debe coincidir para escribir. */
export interface CalendarSyncExpectation {
  readonly startsAt: number;
  readonly endsAt: number;
  readonly status: AppointmentStatus;
}

/**
 * Escritura del resultado con verificación de vigencia (TI2-162).
 *
 * La implementación compara en la misma transacción el horario y el estado
 * esperados con la fila vigente: si otro despacho terminó antes con un cambio
 * más nuevo, responde `stale` sin escribir y la última acción siempre gana. Si
 * el guardado falla, la implementación lanza: la fila queda `pending` y el
 * reintento la sincroniza.
 */
export interface CalendarSyncStore {
  record(input: {
    readonly appointmentId: string;
    readonly attemptedAt: number;
    readonly expected: CalendarSyncExpectation;
    readonly outcome:
      | { readonly kind: "success"; readonly eventId: string; readonly ownerId: string }
      | { readonly kind: "noop"; readonly eventId?: string }
      | { readonly kind: "failure"; readonly errorCode: "not_connected" | "unavailable" }
      | { readonly kind: "not_linked" };
  }): Promise<"recorded" | "stale">;
}

/** Atención cargada para sincronizar, con dueño y participantes. */
export interface CalendarSyncAppointmentContext {
  readonly appointmentId: string;
  readonly status: AppointmentStatus;
  readonly startAt: number;
  readonly endAt: number;
  readonly createdAt: number;
  readonly reference: { readonly eventId: string; readonly addedAt: number } | null;
  /**
   * Verdadero solo si la referencia guardada se sincronizó con el horario
   * vigente. Una referencia ausente o con el horario anterior está obsoleta.
   */
  readonly referenceIsCurrent: boolean;
  /**
   * `subject` de Better Auth del calendario donde vive el evento, o `null` si
   * todavía no se sincronizó en ninguno. Actualizar y eliminar usan siempre
   * ese calendario.
   */
  readonly ownerId: string | null;
  /** Participantes en orden de intento (estudiante primero). */
  readonly participants: readonly {
    readonly subject: string;
    /** Verdadero si alguna vez vinculó Calendar (aunque hoy falte el token). */
    readonly everLinked: boolean;
  }[];
}

/** Resultado público de la sincronización automática, sin detalles del proveedor. */
export type CalendarSyncResult =
  | { readonly status: "synced"; readonly eventId?: string }
  | { readonly status: "error"; readonly errorCode: "not_connected" | "unavailable" }
  | { readonly status: "pending" };

/**
 * Programa la sincronización tras confirmar el cambio (TI2-162).
 *
 * Capa de Aplicación: lo llaman la reserva, la cancelación y el
 * reagendamiento después de persistir, en la misma mutation que arma
 * Presentación. Si el cambio se rechaza, Presentación lanza el error y la
 * mutation descarta también lo programado. Infraestructura lo cumple con
 * `calendarSyncScheduler`, que marca `pending` y programa el despacho en otra
 * función, así un fallo del proveedor no deshace el cambio.
 */
export interface CalendarSyncScheduler {
  scheduleSync(appointmentId: string): Promise<void>;
}

function isCancelledStatus(status: AppointmentStatus): boolean {
  return status === "cancelled_by_student" || status === "cancelled_by_cereti";
}

/**
 * Sincronización automática de una atención tras confirmar el cambio (TI2-162).
 *
 * La política de qué calendario sincronizar vive acá y se prueba con dobles:
 * con referencia se usa siempre el calendario del dueño (`ownerId`); sin
 * referencia se prueban los participantes en orden hasta el primer éxito y ese
 * calendario queda como dueño. Eliminar prueba todos los calendarios con
 * acceso (borrar lo inexistente es éxito idempotente) y basta con que alguno
 * responda eliminado o ausente. Cuando nadie vinculó, queda registrado como
 * `not_linked` sin pedir nada; con vínculo perdido responde `not_connected`
 * para pedir volver a vincular y con fallo temporal `unavailable` para
 * reintentar. Un fallo nunca revierte la reserva. Los errores usan el contrato
 * común; los clientes distinguen por `code`, nunca por el texto.
 */
export async function syncAppointmentToGoogleCalendar(deps: {
  readonly loadAppointment: () => Promise<CalendarSyncAppointmentContext | null>;
  readonly resolveAccess: (subject: string) => Promise<CalendarSyncAccess>;
  readonly calendarApi: (accessToken: string) => CalendarSyncGateway;
  readonly store: CalendarSyncStore;
  readonly reschedule: () => Promise<void>;
  readonly now: () => number;
  readonly timeZone: string;
}): Promise<ApiResult<CalendarSyncResult>> {
  const context = await deps.loadAppointment();
  if (context === null) return errResult(unauthorizedError());

  const attemptedAt = deps.now();
  if (!Number.isFinite(attemptedAt) || attemptedAt <= 0) {
    return errResult(conflictError());
  }

  const expected: CalendarSyncExpectation = {
    startsAt: context.startAt,
    endsAt: context.endAt,
    status: context.status,
  };
  const record = (
    outcome: Parameters<CalendarSyncStore["record"]>[0]["outcome"],
  ): Promise<"recorded" | "stale"> =>
    deps.store.record({
      appointmentId: context.appointmentId,
      attemptedAt,
      expected,
      outcome,
    });

  async function finish(
    outcome: Parameters<CalendarSyncStore["record"]>[0]["outcome"],
  ): Promise<ApiResult<CalendarSyncResult>> {
    const stored = await record(outcome);
    if (stored === "stale") {
      // Otro despacho terminó antes con un cambio más nuevo: no se pisa y se
      // programa un seguimiento que lee lo vigente.
      await deps.reschedule();
      return okResult({ status: "pending" });
    }
    if (outcome.kind === "failure") {
      return okResult({ status: "error", errorCode: outcome.errorCode });
    }
    if (outcome.kind === "success") {
      return okResult({ status: "synced", eventId: outcome.eventId });
    }
    if (outcome.kind === "not_linked") {
      // Nadie vinculó: queda registrado sin pedir nada y el reintento no lo
      // vuelve a programar; si alguien vincula después, la confirmación del
      // vínculo programa las atenciones futuras vigentes.
      return okResult({ status: "pending" });
    }
    return okResult({
      status: "synced",
      ...(outcome.eventId === undefined ? {} : { eventId: outcome.eventId }),
    });
  }

  const isCancelled = isCancelledStatus(context.status);
  if (isCancelled) {
    if (context.reference === null) {
      return await finish({ kind: "noop" });
    }
    const targets =
      context.ownerId !== null
        ? [{ subject: context.ownerId, everLinked: true }]
        : context.participants;
    let sawDeleted = false;
    let sawMissing = false;
    let sawUnavailable = false;
    let sawNotConnected = false;
    for (const target of targets) {
      const access = await deps.resolveAccess(target.subject);
      if (access.status === "never_linked") {
        if (context.ownerId !== null) sawNotConnected = true;
        continue;
      }
      if (access.status !== "ok") {
        if (access.status === "unavailable") sawUnavailable = true;
        else sawNotConnected = true;
        continue;
      }
      const deleted = await deps.calendarApi(access.accessToken).deleteEvent({
        googleEventId: context.reference.eventId,
      });
      if (deleted.status === "not_connected" || deleted.status === "unavailable") {
        if (deleted.status === "unavailable") sawUnavailable = true;
        else sawNotConnected = true;
        continue;
      }
      if (context.ownerId !== null) {
        return await finish({ kind: "noop", eventId: deleted.eventId });
      }
      if (deleted.status === "deleted") sawDeleted = true;
      else sawMissing = true;
    }
    // Con alguno borrado ese era el calendario; sin borrado, un calendario que
    // no respondió (`unavailable`) podría tener el evento, así que se
    // reintenta antes de confirmar un `not_found` de otro calendario.
    if (sawDeleted) return await finish({ kind: "noop", eventId: context.reference.eventId });
    if (sawUnavailable) return await finish({ kind: "failure", errorCode: "unavailable" });
    if (sawMissing) return await finish({ kind: "noop", eventId: context.reference.eventId });
    if (sawNotConnected) return await finish({ kind: "failure", errorCode: "not_connected" });
    return await finish({ kind: "not_linked" });
  }

  if (!isCalendarActionableStatus(context.status)) {
    return await finish({ kind: "noop" });
  }

  const event = buildCalendarEvent({
    appointmentId: context.appointmentId,
    startAt: context.startAt,
    endAt: context.endAt,
    timeZone: deps.timeZone,
    generatedAt: context.createdAt,
  });

  const targets =
    context.ownerId !== null
      ? [{ subject: context.ownerId, everLinked: true }]
      : context.participants;
  let sawUnavailable = false;
  let sawNotConnected = false;
  const attemptUpsert = async (
    googleEventId: string,
    subject: string,
  ): Promise<
    | { readonly done: true; readonly result: ApiResult<CalendarSyncResult> }
    | { readonly done: false }
  > => {
    const access = await deps.resolveAccess(subject);
    if (access.status === "never_linked") {
      if (context.ownerId !== null) sawNotConnected = true;
      return { done: false };
    }
    if (access.status !== "ok") {
      if (access.status === "unavailable") sawUnavailable = true;
      else sawNotConnected = true;
      return { done: false };
    }
    const api = deps.calendarApi(access.accessToken);
    if (context.reference === null) {
      const created = await api.createEvent({
        googleEventId: event.googleEventId,
        title: event.title,
        startAt: event.startAt,
        endAt: event.endAt,
        timeZone: event.timeZone,
      });
      if (created.status === "not_connected" || created.status === "unavailable") {
        if (created.status === "unavailable") sawUnavailable = true;
        else sawNotConnected = true;
        return { done: false };
      }
      if (created.status === "already_exists") {
        const updated = await api.updateEvent({
          googleEventId: created.eventId,
          title: event.title,
          startAt: event.startAt,
          endAt: event.endAt,
          timeZone: event.timeZone,
        });
        if (updated.status === "not_connected" || updated.status === "unavailable") {
          if (updated.status === "unavailable") sawUnavailable = true;
          else sawNotConnected = true;
          return { done: false };
        }
        return {
          done: true,
          result: await finish({
            kind: "success",
            eventId: updated.eventId,
            ownerId: subject,
          }),
        };
      }
      return {
        done: true,
        result: await finish({ kind: "success", eventId: created.eventId, ownerId: subject }),
      };
    }
    const updated = await api.updateEvent({
      googleEventId: googleEventId,
      title: event.title,
      startAt: event.startAt,
      endAt: event.endAt,
      timeZone: event.timeZone,
    });
    if (updated.status === "not_connected" || updated.status === "unavailable") {
      if (updated.status === "unavailable") sawUnavailable = true;
      else sawNotConnected = true;
      return { done: false };
    }
    return {
      done: true,
      result: await finish({ kind: "success", eventId: updated.eventId, ownerId: subject }),
    };
  };

  if (context.reference !== null && context.referenceIsCurrent) {
    return await finish({ kind: "noop", eventId: context.reference.eventId });
  }

  for (const target of targets) {
    const attempted = await attemptUpsert(
      context.reference === null ? event.googleEventId : context.reference.eventId,
      target.subject,
    );
    if (attempted.done) return attempted.result;
  }
  if (sawUnavailable) return await finish({ kind: "failure", errorCode: "unavailable" });
  if (sawNotConnected) return await finish({ kind: "failure", errorCode: "not_connected" });
  // Nadie vinculó: queda registrado sin pedir nada y el reintento no lo
  // retoma; si alguien vincula después, esa confirmación lo programa.
  return await finish({ kind: "not_linked" });
}
