import {
  ACCOMPANIMENT_CLOSURE_CANCEL_REASON,
  transitionAccompaniment,
  type AccompanimentStateChange,
  type AccompanimentStatus,
} from "../../domain/accompaniments/accompaniment";
import {
  conflictError,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import {
  cancelAuthorizedAppointment,
  type AppointmentChangeClock,
  type AppointmentTransitionPersister,
  type CancellableAppointment,
} from "../appointments/changes";
import type { AppointmentAuditRecorder } from "../appointments/audit";
import {
  authorizeAccompanimentStatusChange,
  type AuthorizationReader,
} from "../authorization/authorize";

/**
 * Casos de uso del estado del acompañamiento (TI2-152): pausar, reactivar,
 * cerrar y la vista previa del cierre.
 *
 * Capa de Aplicación: autoriza sobre el acompañamiento, aplica
 * `transitionAccompaniment` y persiste por puertos, sin tocar `ctx.db`. Todo
 * ocurre en la mutation que arma Presentación: un rechazo se devuelve como
 * error, Presentación lo lanza y ninguna escritura parcial queda guardada.
 *
 * Pausar conserva las atenciones existentes; lo que cambia es la
 * autorización de agenda, que deja de admitir reservas y cambios de horario.
 * Cerrar cancela las atenciones futuras por el mismo camino que la
 * cancelación individual (`cancelAuthorizedAppointment`), así el cupo se
 * libera y la auditoría queda igual. Una atención vigente cuya hora ya pasó
 * impide el cierre: cancelarla diría que no ocurrió, así que antes debe
 * registrarse su resultado.
 *
 * Opera con datos ficticios.
 */

/** Atenciones vigentes del acompañamiento, o `complete: false` si no caben. */
export interface PendingAppointmentsReader {
  listPendingAppointments(accompanimentId: string): Promise<{
    readonly complete: boolean;
    readonly appointments: readonly CancellableAppointment[];
  }>;
}

/**
 * Guarda el cambio en el propio acompañamiento: el estado nuevo y, en un
 * cierre, quién cerró, cuándo y el motivo si se entregó.
 */
export interface AccompanimentStatusWriter {
  persistStatusChange(accompanimentId: string, change: AccompanimentStateChange): Promise<void>;
}

/** Dependencias de pausar y reactivar. */
export interface ChangeAccompanimentStatusDeps {
  readonly auth: AuthorizationReader;
  readonly accompaniments: AccompanimentStatusWriter;
  readonly now?: AppointmentChangeClock;
}

/** Dependencias de la vista previa del cierre: solo lecturas. */
export interface PreviewAccompanimentClosureDeps {
  readonly auth: AuthorizationReader;
  readonly appointments: PendingAppointmentsReader;
  readonly now?: AppointmentChangeClock;
}

/** Dependencias del cierre: el cambio de estado más la cancelación. */
export interface CloseAccompanimentDeps extends ChangeAccompanimentStatusDeps {
  readonly appointments: PendingAppointmentsReader;
  readonly persister: AppointmentTransitionPersister;
  readonly audit: AppointmentAuditRecorder;
}

/** Entrada de pausar, reactivar y la vista previa: identidad y acompañamiento. */
export interface ChangeAccompanimentStatusInput {
  readonly tokenIdentifier: string | null;
  readonly accompanimentId: string;
}

/** Entrada del cierre: además, su motivo opcional (`motivoCierre?` del MER). */
export interface CloseAccompanimentInput extends ChangeAccompanimentStatusInput {
  readonly reason?: string;
}

export interface AccompanimentStatusResult {
  readonly accompanimentId: string;
  readonly status: AccompanimentStatus;
}

export interface AccompanimentClosureResult extends AccompanimentStatusResult {
  /** Atenciones futuras que este cierre canceló. */
  readonly cancelledAppointments: number;
}

export interface AccompanimentClosurePreview {
  /** Atenciones futuras que el cierre cancelaría. */
  readonly appointmentsToCancel: number;
  /** Atenciones vigentes cuya hora ya pasó: impiden cerrar hasta registrarlas. */
  readonly unrecordedAppointments: number;
}

function denied<T>(): ApiResult<T> {
  return errResult(unauthorizedError());
}

function conflict<T>(): ApiResult<T> {
  return errResult(conflictError());
}

function occurredNow(deps: { readonly now?: AppointmentChangeClock }): number {
  return deps.now === undefined ? Date.now() : deps.now();
}

/**
 * Autoriza y aplica la política. Devuelve el cambio listo para guardar y
 * quién lo pidió, sin escribir: el cierre necesita cancelar atenciones antes
 * de guardarlo.
 */
async function decideStatusChange(
  deps: { readonly auth: AuthorizationReader },
  input: CloseAccompanimentInput,
  to: AccompanimentStatus,
  occurredAt: number,
): Promise<ApiResult<{ readonly actorId: string; readonly change: AccompanimentStateChange }>> {
  const grant = await authorizeAccompanimentStatusChange(deps.auth, input);
  if (grant.status === "error") return denied();
  const outcome = transitionAccompaniment({
    from: grant.data.status,
    to,
    actorId: grant.data.callerId,
    occurredAt,
    ...(input.reason === undefined ? {} : { closureReason: input.reason }),
  });
  if (outcome.status === "rejected") return conflict();
  return okResult({ actorId: grant.data.callerId, change: outcome.change });
}

async function changeStatus(
  deps: ChangeAccompanimentStatusDeps,
  input: ChangeAccompanimentStatusInput,
  to: AccompanimentStatus,
): Promise<ApiResult<AccompanimentStatusResult>> {
  const decided = await decideStatusChange(deps, input, to, occurredNow(deps));
  if (decided.status === "error") return errResult(decided.error);
  await deps.accompaniments.persistStatusChange(input.accompanimentId, decided.data.change);
  return okResult({ accompanimentId: input.accompanimentId, status: to });
}

/**
 * Pausa un acompañamiento activo. Las atenciones existentes se mantienen, pero
 * mientras dure la pausa no se opera sobre ellas; `conflict` si ya está en
 * pausa o cerrado.
 */
export async function pauseAccompaniment(
  deps: ChangeAccompanimentStatusDeps,
  input: ChangeAccompanimentStatusInput,
): Promise<ApiResult<AccompanimentStatusResult>> {
  return await changeStatus(deps, input, "paused");
}

/** Reactiva un acompañamiento en pausa. `conflict` si está activo o cerrado. */
export async function reactivateAccompaniment(
  deps: ChangeAccompanimentStatusDeps,
  input: ChangeAccompanimentStatusInput,
): Promise<ApiResult<AccompanimentStatusResult>> {
  return await changeStatus(deps, input, "active");
}

/** Separa las atenciones vigentes en futuras y ya pasadas, o `null` si no caben. */
async function planClosure(
  reader: PendingAppointmentsReader,
  accompanimentId: string,
  now: number,
): Promise<{
  readonly future: readonly CancellableAppointment[];
  readonly unrecorded: number;
} | null> {
  const pending = await reader.listPendingAppointments(accompanimentId);
  if (!pending.complete) return null;
  const future = pending.appointments.filter((appointment) => appointment.startAt > now);
  return { future, unrecorded: pending.appointments.length - future.length };
}

/**
 * Cuántas atenciones cancelaría el cierre, para mostrarlo antes de confirmar.
 *
 * Es informativa: el cierre vuelve a leer y devuelve la cifra real. Responde
 * `conflict` cuando el acompañamiento ya está cerrado, igual que el cierre.
 */
export async function previewAccompanimentClosure(
  deps: PreviewAccompanimentClosureDeps,
  input: ChangeAccompanimentStatusInput,
): Promise<ApiResult<AccompanimentClosurePreview>> {
  const now = occurredNow(deps);
  const decided = await decideStatusChange(deps, input, "closed", now);
  if (decided.status === "error") return errResult(decided.error);
  const plan = await planClosure(deps.appointments, input.accompanimentId, now);
  if (plan === null) return conflict();
  return okResult({
    appointmentsToCancel: plan.future.length,
    unrecordedAppointments: plan.unrecorded,
  });
}

/**
 * Cierra un acompañamiento activo o en pausa y cancela sus atenciones futuras
 * como `cancelled_by_cereti`, con quien cierra como actor.
 *
 * `conflict` si ya está cerrado, si queda una atención vigente cuya hora ya
 * pasó o si alguna cancelación se rechaza. El motivo opcional del cierre
 * queda solo en el acompañamiento, junto a quién cerró y cuándo; las
 * atenciones reciben el motivo fijo `ACCOMPANIMENT_CLOSURE_CANCEL_REASON`.
 */
export async function closeAccompaniment(
  deps: CloseAccompanimentDeps,
  input: CloseAccompanimentInput,
): Promise<ApiResult<AccompanimentClosureResult>> {
  const occurredAt = occurredNow(deps);
  const decided = await decideStatusChange(deps, input, "closed", occurredAt);
  if (decided.status === "error") return errResult(decided.error);

  const plan = await planClosure(deps.appointments, input.accompanimentId, occurredAt);
  if (plan === null || plan.unrecorded > 0) return conflict();

  for (const appointment of plan.future) {
    const cancelled = await cancelAuthorizedAppointment(deps, appointment, {
      target: "cancelled_by_cereti",
      actorId: decided.data.actorId,
      occurredAt,
      reason: ACCOMPANIMENT_CLOSURE_CANCEL_REASON,
    });
    if (!cancelled) return conflict();
  }

  await deps.accompaniments.persistStatusChange(input.accompanimentId, decided.data.change);
  return okResult({
    accompanimentId: input.accompanimentId,
    status: "closed",
    cancelledAppointments: plan.future.length,
  });
}
