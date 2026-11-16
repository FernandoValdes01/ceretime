import type { AppointmentStatus } from "../../domain/appointments/appointment";
import {
  decideOnlineAccessUpdate,
  toOnlineAccessView,
  type OnlineAccessView,
} from "../../domain/appointments/online_access";
import {
  conflictError,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import {
  notificationEventsForOnlineAccess,
  type NotificationEvent,
} from "../../domain/notifications/notification";
import type { ModalityPreference } from "../../domain/requests/request";
import {
  authorizeAppointmentOnlineAccess,
  type AuthorizationReader,
} from "../authorization/authorize";

/**
 * Acceso privado de la atención en línea (TI2-142).
 *
 * Capa de Aplicación: un profesional de la atención agrega o reemplaza el
 * enlace de Google Meet, y el Estudiante dueño y los profesionales lo leen.
 * Las reglas viven en el dominio (`decideOnlineAccessUpdate` y
 * `toOnlineAccessView`); acá se ordena la lectura, la autorización, la
 * escritura y el aviso, con puertos que Infraestructura cumple dentro de la
 * misma mutation. No genera el enlace con Google Calendar ni con la API de
 * Meet: lo entrega el profesional.
 */

/** Atención leída para su acceso en línea, con todos sus profesionales. */
export interface OnlineAccessAppointment {
  readonly id: string;
  readonly accompanimentId: string;
  readonly studentId: string;
  readonly professionalId: string;
  readonly additionalProfessionalIds: readonly string[];
  readonly modality: ModalityPreference;
  readonly status: AppointmentStatus;
  /** Enlace canónico guardado; ausente mientras esté pendiente. */
  readonly privateAccessReference?: string;
}

/**
 * Lectura de la atención. Un identificador inexistente o de otra tabla
 * responde igual que una atención ajena (`null`).
 */
export interface OnlineAccessReader {
  getAppointment(appointmentId: string): Promise<OnlineAccessAppointment | null>;
}

/** Lectura más escritura del enlace, dentro de la misma mutation. */
export interface OnlineAccessStore extends OnlineAccessReader {
  /** Verdadero cuando otra atención ya guarda el mismo enlace canónico. */
  isReferenceInUse(reference: string, exceptAppointmentId: string): Promise<boolean>;
  saveReference(appointmentId: string, reference: string): Promise<void>;
}

/** Registro de los eventos de aviso que produjo la política (TI2-105/TI2-118). */
export interface NotificationEventRecorder {
  record(events: readonly NotificationEvent[]): Promise<void>;
}

export interface OnlineAccessReadDeps {
  readonly auth: AuthorizationReader;
  readonly appointments: OnlineAccessReader;
}

export interface OnlineAccessUpdateDeps extends OnlineAccessReadDeps {
  readonly appointments: OnlineAccessStore;
  readonly notifications: NotificationEventRecorder;
  /** Reloj del servidor para el aviso; las pruebas lo fijan. */
  readonly now?: () => number;
}

/** Atención y sesión de quien consulta o escribe. */
export interface OnlineAccessRequest {
  readonly tokenIdentifier: string | null;
  readonly appointmentId: string;
}

function denied<T>(): ApiResult<T> {
  return errResult(unauthorizedError());
}

function conflict<T>(): ApiResult<T> {
  return errResult(conflictError());
}

/**
 * Lee la atención y autoriza a quien llama. Una atención inexistente, ajena o
 * de un acompañamiento no activo se deniega igual, sin revelar cuál faltó.
 */
async function loadAuthorizedAppointment(
  deps: OnlineAccessReadDeps,
  request: OnlineAccessRequest,
): Promise<
  ApiResult<{ readonly appointment: OnlineAccessAppointment; readonly callerId: string }>
> {
  const appointmentId = request.appointmentId.trim();
  if (appointmentId === "") return denied();
  const appointment = await deps.appointments.getAppointment(appointmentId);
  if (appointment === null) return denied();
  const grant = await authorizeAppointmentOnlineAccess(deps.auth, {
    tokenIdentifier: request.tokenIdentifier,
    appointment: {
      _id: appointment.id,
      accompanimentId: appointment.accompanimentId,
      studentId: appointment.studentId,
      professionalId: appointment.professionalId,
      additionalProfessionalIds: appointment.additionalProfessionalIds,
    },
  });
  if (grant.status === "error") return denied();
  return okResult({ appointment, callerId: grant.data.callerId });
}

/**
 * Agrega o reemplaza el enlace privado de una atención en línea.
 *
 * Solo un profesional de la atención; el Estudiante recibe `unauthorized`
 * igual que un tercero. Una atención presencial o que ya no está vigente, un
 * enlace inválido o un enlace que otra atención ya usa responden `conflict`
 * sin escribir: un enlace por atención, no una sala fija reutilizada. Un
 * reintento con el mismo enlace no escribe ni vuelve a avisar; agregar o
 * reemplazar avisa al Estudiante en la misma mutation.
 */
export async function setOnlineAccessLink(
  deps: OnlineAccessUpdateDeps,
  input: OnlineAccessRequest & { readonly link: string },
): Promise<ApiResult<{ readonly appointmentId: string }>> {
  const loaded = await loadAuthorizedAppointment(deps, input);
  if (loaded.status === "error") return loaded;
  const { appointment, callerId } = loaded.data;

  const decision = decideOnlineAccessUpdate(appointment, callerId, input.link);
  if (decision.status === "rejected") {
    return decision.cause === "actor_not_professional" ? denied() : conflict();
  }
  if (decision.change === "unchanged") return okResult({ appointmentId: appointment.id });

  if (await deps.appointments.isReferenceInUse(decision.link, appointment.id)) return conflict();
  await deps.appointments.saveReference(appointment.id, decision.link);
  await deps.notifications.record(
    notificationEventsForOnlineAccess(
      {
        appointmentId: appointment.id,
        studentId: appointment.studentId,
        professionalId: appointment.professionalId,
      },
      deps.now === undefined ? Date.now() : deps.now(),
    ),
  );
  return okResult({ appointmentId: appointment.id });
}

/**
 * Entrega el estado del acceso en línea a un participante de la atención: el
 * enlace solo cuando está disponible y la atención sigue vigente. Quien no
 * participa recibe `unauthorized`, sin saber si la atención existe ni si tiene
 * enlace.
 */
export async function getOnlineAccess(
  deps: OnlineAccessReadDeps,
  input: OnlineAccessRequest,
): Promise<ApiResult<OnlineAccessView>> {
  const loaded = await loadAuthorizedAppointment(deps, input);
  if (loaded.status === "error") return loaded;
  const view = toOnlineAccessView(loaded.data.appointment, loaded.data.callerId);
  return view === null ? denied() : okResult(view);
}
