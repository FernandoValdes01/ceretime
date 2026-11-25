import { buildCalendarEvent, toCalendarFile } from "../../domain/calendar/calendar_event";
import { isCalendarActionableStatus } from "../../domain/appointments/appointment";
import {
  conflictError,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import type { CalendarAppointmentContext } from "./calendar";

/** Resultado del proveedor al eliminar el evento de una atención cancelada. */
export type GoogleCalendarDeleteOutcome =
  | { readonly status: "deleted"; readonly eventId: string }
  | { readonly status: "not_found"; readonly eventId: string }
  | { readonly status: "not_connected" }
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

/** Puerto del proveedor para la sincronización automática. */
export interface CalendarSyncGoogleGateway {
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
  deleteEvent(input: { readonly googleEventId: string }): Promise<GoogleCalendarDeleteOutcome>;
}

/** Escritura de la referencia del evento y del estado de sincronización. */
export interface CalendarSyncRecorder {
  recordEvent(input: {
    readonly appointmentId: string;
    readonly eventId: string;
    readonly addedAt: number;
    readonly startsAt: number;
    readonly endsAt: number;
  }): Promise<void>;
  recordSynced(input: { readonly attemptedAt: number }): Promise<void>;
  recordError(input: {
    readonly attemptedAt: number;
    readonly errorCode: "not_connected" | "unavailable";
  }): Promise<void>;
}

/** Resultado público de la sincronización automática, sin detalles del proveedor. */
export type CalendarSyncResult =
  | { readonly status: "synced"; readonly eventId?: string }
  | { readonly status: "error"; readonly errorCode: "not_connected" | "unavailable" };

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

async function recordEventBestEffort(
  recorder: Pick<CalendarSyncRecorder, "recordEvent">,
  context: CalendarAppointmentContext,
  eventId: string,
  addedAt: number,
): Promise<void> {
  try {
    await recorder.recordEvent({
      appointmentId: context.appointmentId,
      eventId,
      addedAt,
      startsAt: context.startAt,
      endsAt: context.endAt,
    });
  } catch {
    // El identificador es determinista: un próximo reintento lo recupera sin
    // duplicarlo. No se expone el fallo interno.
  }
}

/**
 * Sincronización automática de una atención tras confirmar el cambio (TI2-162).
 *
 * Carga la atención vigente en el momento de ejecutar, no la de cuando se
 * programó: dos reagendamientos seguidos sincronizan la última fecha, nunca
 * una anterior. Reutiliza el mismo evento determinista y el mismo `.ics` de
 * TI2-122, sin otro generador ni notas.
 *
 * - `scheduled` o `rescheduled`: crea o actualiza el mismo evento.
 * - `cancelled_by_student` o `cancelled_by_cereti`: elimina el evento si hay
 *   referencia; sin referencia no hay nada que borrar.
 * - Otro estado terminal: no toca Google; se marca sincronizado para no
 *   reintentar un evento que ya no es vigente.
 *
 * Un fallo del proveedor nunca revierte la reserva: se registra `error` con el
 * código genérico (`not_connected` pide volver a vincular, `unavailable`
 * permite reintentar) y la atención sigue vigente. Los errores usan el
 * contrato común; los clientes distinguen por `code`, nunca por el texto.
 */
export async function syncAppointmentToGoogleCalendar(deps: {
  readonly loadAppointment: () => Promise<CalendarAppointmentContext | null>;
  readonly google: CalendarSyncGoogleGateway;
  readonly sync: CalendarSyncRecorder;
  readonly now: () => number;
  readonly timeZone: string;
}): Promise<ApiResult<CalendarSyncResult>> {
  const context = await deps.loadAppointment();
  if (context === null) return errResult(unauthorizedError());

  const attemptedAt = deps.now();
  if (!Number.isFinite(attemptedAt) || attemptedAt <= 0) {
    return errResult(conflictError());
  }

  const isCancelled =
    context.status === "cancelled_by_student" || context.status === "cancelled_by_cereti";
  if (isCancelled) {
    if (context.reference === null) {
      await deps.sync.recordSynced({ attemptedAt });
      return okResult({ status: "synced" });
    }
    const deleted = await deps.google.deleteEvent({
      googleEventId: context.reference.eventId,
    });
    if (deleted.status === "not_connected" || deleted.status === "unavailable") {
      await deps.sync.recordError({ attemptedAt, errorCode: deleted.status });
      return okResult({ status: "error", errorCode: deleted.status });
    }
    await deps.sync.recordSynced({ attemptedAt });
    return okResult({ status: "synced", eventId: deleted.eventId });
  }

  if (!isCalendarActionableStatus(context.status)) {
    await deps.sync.recordSynced({ attemptedAt });
    return okResult({ status: "synced" });
  }

  const event = buildCalendarEvent({
    appointmentId: context.appointmentId,
    startAt: context.startAt,
    endAt: context.endAt,
    timeZone: deps.timeZone,
    generatedAt: context.createdAt,
  });
  // El `.ics` se construye con el mismo generador de TI2-122 para no duplicar
  // la representación; acá solo valida que la fecha, la duración y la zona
  // viajan en el evento antes de llamar al proveedor.
  toCalendarFile(event);

  if (context.reference !== null && !context.referenceIsCurrent) {
    const updated = await deps.google.updateEvent({
      googleEventId: context.reference.eventId,
      title: event.title,
      startAt: event.startAt,
      endAt: event.endAt,
      timeZone: event.timeZone,
    });
    if (updated.status === "not_connected" || updated.status === "unavailable") {
      await deps.sync.recordError({ attemptedAt, errorCode: updated.status });
      return okResult({ status: "error", errorCode: updated.status });
    }
    await recordEventBestEffort(deps.sync, context, updated.eventId, context.reference.addedAt);
    await deps.sync.recordSynced({ attemptedAt });
    return okResult({ status: "synced", eventId: updated.eventId });
  }

  if (context.reference !== null && context.referenceIsCurrent) {
    await deps.sync.recordSynced({ attemptedAt });
    return okResult({ status: "synced", eventId: context.reference.eventId });
  }

  const created = await deps.google.createEvent({
    googleEventId: event.googleEventId,
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    timeZone: event.timeZone,
  });
  if (created.status === "not_connected" || created.status === "unavailable") {
    await deps.sync.recordError({ attemptedAt, errorCode: created.status });
    return okResult({ status: "error", errorCode: created.status });
  }

  if (created.status === "already_exists") {
    const updated = await deps.google.updateEvent({
      googleEventId: created.eventId,
      title: event.title,
      startAt: event.startAt,
      endAt: event.endAt,
      timeZone: event.timeZone,
    });
    if (updated.status === "not_connected" || updated.status === "unavailable") {
      await deps.sync.recordError({ attemptedAt, errorCode: updated.status });
      return okResult({ status: "error", errorCode: updated.status });
    }
    await recordEventBestEffort(deps.sync, context, updated.eventId, attemptedAt);
    await deps.sync.recordSynced({ attemptedAt });
    return okResult({ status: "synced", eventId: updated.eventId });
  }

  await recordEventBestEffort(deps.sync, context, created.eventId, attemptedAt);
  await deps.sync.recordSynced({ attemptedAt });
  return okResult({ status: "synced", eventId: created.eventId });
}
