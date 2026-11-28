import {
  AVAILABILITY_CONTRACT_VERSION,
  expandAvailabilitySlots,
  isValidCivilDate,
  type AvailabilityBlock,
  type AvailabilitySearchResult,
  type AvailabilitySlot,
  type SearchedAvailabilitySlot,
} from "../../domain/availability/availability";
import {
  decideNoCompatibleSlotReason,
  toOfficialChannelCoordination,
  type NoCompatibleSlotReason,
} from "../../domain/availability/official_channel";
import {
  conflictError,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import {
  isAppointmentStillBookable,
  notifyAvailabilityImpact,
  type ImpactedAppointmentInput,
} from "../appointments/impact";
import type { NotificationEventRecorder } from "../notifications/ports";
import type { AccessNeed } from "../../domain/requests/request";
import { assessCompatibility, type CompatibilityOption } from "../../domain/spaces/compatibility";
import { toSpaceFields } from "../../domain/spaces/space";
import {
  authorizeAvailabilityEdit,
  authorizeAvailabilityRead,
  isBookableProfessional,
  type AuthorizationReader,
} from "../authorization/authorize";
import type {
  AccompanimentNeedsReader,
  AvailabilityReader,
  BookableProfessionalSource,
  AvailabilityWriter,
  CompatibilitySpaceSource,
  SlotOccupancyReader,
  StoredAvailabilityException,
} from "./ports";

/**
 * Casos de uso de disponibilidad (TI2-97).
 *
 * Capa de Aplicación: publica y lee los bloques y excepciones propios del
 * profesional y consulta cupos compatibles para un acompañamiento activo. No crea
 * entrada pública (`query`/`mutation` de TI2-111) ni toca `ctx.db`
 * (repositorios de TI2-95): recibe puertos por parámetro y se prueba con
 * dobles en memoria. La única definición de cada puerto vive en
 * `./ports` (acordada con TI2-95); acá solo se consumen. Opera con datos
 * ficticios.
 *
 * Autorización (TI2-86): escribir exige profesional vigente sobre su
 * propia disponibilidad; leer exige acompañamiento activo con pertenencia
 * (estudiante dueño) o asignación vigente (profesional asignado). Toda
 * denegación responde el mismo error genérico, sin revelar existencia.
 *
 * Búsqueda: solo expone cupos de un profesional reservable para el
 * acompañamiento (TI2-111), y combina recurrencia y excepciones (TI2-81),
 * ocupación por puerto (TI2-84/TI2-96) y compatibilidad de modalidad y
 * espacio con las necesidades vigentes sin rebajarlas (TI2-82). Sin opción
 * compatible y libre responde el resultado explícito `no_compatible_slot`
 * (TI2-144) con su motivo, el código de referencia y los canales oficiales,
 * sin crear reserva incompatible. Rango
 * y página acotados: la consulta nunca expone el calendario completo. Un
 * cursor que ya no figura (cupo ocupado o incompatible entre consultas)
 * responde `conflict` para reiniciar la búsqueda, nunca repite resultados
 * en silencio.
 */

/** Tope de cupos por página: se rechaza el exceso, nunca se trunca en silencio. */
export const SEARCH_AVAILABILITY_PAGE_LIMIT_MAX = 50;

function denied<T>(): ApiResult<T> {
  return errResult(unauthorizedError());
}

function conflict<T>(): ApiResult<T> {
  return errResult(conflictError());
}

/** Valida una zona horaria IANA no vacía, compartida por búsqueda y reserva. */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.trim() === "") return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Rango civil de búsqueda: dos fechas válidas, la primera no posterior a la segunda. */
export function isValidSearchRange(from: string, to: string): boolean {
  return isValidCivilDate(from) && isValidCivilDate(to) && from <= to;
}

/** Entrada de publicación de un bloque propio, sin profesional del cliente. */
export type PublishBlockInput = Omit<AvailabilityBlock, "id" | "professionalId" | "version">;

/**
 * Impacto de un cambio de disponibilidad sobre atenciones futuras (TI2-156).
 *
 * Obligatorio: sin él el caso de uso no avisa. `future` lista por participante
 * (responsable o adicional, TI2-142); `now` solo lo fijan las pruebas.
 */
export interface AvailabilityChangeImpactDeps {
  readonly future: {
    listResponsibleByWeekdays(
      professionalId: string,
      weekdays: readonly number[],
      now: number,
      pageSize?: number,
    ): Promise<{
      readonly complete: boolean;
      readonly appointments: readonly ImpactedAppointmentInput[];
    }>;
    listResponsibleByDate(
      professionalId: string,
      date: string,
      now: number,
    ): Promise<{
      readonly complete: boolean;
      readonly appointments: readonly ImpactedAppointmentInput[];
    }>;
    listAdditionalByWeekdays(
      professionalId: string,
      weekdays: readonly number[],
      now: number,
      pageSize?: number,
    ): Promise<{
      readonly complete: boolean;
      readonly appointments: readonly ImpactedAppointmentInput[];
    }>;
    listAdditionalByDate(
      professionalId: string,
      date: string,
      now: number,
      pageSize?: number,
    ): Promise<{
      readonly complete: boolean;
      readonly appointments: readonly ImpactedAppointmentInput[];
    }>;
  };
  readonly needs: {
    findNeedsAt(
      accompanimentId: string,
      at: number,
    ): Promise<{
      readonly _id: string;
      readonly needs: readonly { readonly id: string; readonly label: string }[];
    } | null>;
  };
  readonly compatibility: CompatibilitySpaceSource;
  readonly notifications: NotificationEventRecorder;
  readonly now?: () => number;
}

async function collectAvailabilityCandidates(
  future: AvailabilityChangeImpactDeps["future"],
  professionalId: string,
  weekdays: readonly number[],
  now: number,
): Promise<
  | { readonly complete: true; readonly appointments: ImpactedAppointmentInput[] }
  | { readonly complete: false }
> {
  const responsible = await future.listResponsibleByWeekdays(professionalId, weekdays, now);
  if (!responsible.complete) return { complete: false };
  const seen = new Map<string, ImpactedAppointmentInput>();
  for (const appointment of responsible.appointments) seen.set(appointment.id, appointment);
  const additional = await future.listAdditionalByWeekdays(professionalId, weekdays, now);
  if (!additional.complete) return { complete: false };
  for (const appointment of additional.appointments) seen.set(appointment.id, appointment);
  return { complete: true, appointments: [...seen.values()] };
}

async function collectAvailabilityCandidatesByDate(
  future: AvailabilityChangeImpactDeps["future"],
  professionalId: string,
  date: string,
  now: number,
): Promise<
  | { readonly complete: true; readonly appointments: ImpactedAppointmentInput[] }
  | { readonly complete: false }
> {
  const responsible = await future.listResponsibleByDate(professionalId, date, now);
  if (!responsible.complete) return { complete: false };
  const additional = await future.listAdditionalByDate(professionalId, date, now);
  if (!additional.complete) return { complete: false };
  const seen = new Map<string, ImpactedAppointmentInput>();
  for (const appointment of [...responsible.appointments, ...additional.appointments]) {
    seen.set(appointment.id, appointment);
  }
  return { complete: true, appointments: [...seen.values()] };
}

async function evaluateAllBookable(
  deps: {
    readonly auth: AuthorizationReader;
    readonly availability: AvailabilityReader;
    readonly needs: AvailabilityChangeImpactDeps["needs"];
    readonly compatibility: CompatibilitySpaceSource;
  },
  appointments: readonly ImpactedAppointmentInput[],
): Promise<{ readonly ok: true; readonly byId: Map<string, boolean> } | { readonly ok: false }> {
  const byId = new Map<string, boolean>();
  for (const appointment of appointments) {
    const result = await isAppointmentStillBookable(
      {
        auth: deps.auth,
        availability: deps.availability,
        needs: deps.needs,
        compatibility: deps.compatibility,
      },
      appointment,
    );
    if (result.status === "error") return { ok: false };
    byId.set(appointment.id, result.data);
  }
  return { ok: true, byId };
}

/**
 * Publica un bloque recurrente propio. El dueño sale del actor autorizado,
 * nunca del cliente. Requiere profesional vigente (TI2-86).
 */
export async function publishAvailabilityBlock(
  auth: AuthorizationReader,
  store: AvailabilityWriter,
  input: { readonly tokenIdentifier: string | null; readonly block: PublishBlockInput },
): Promise<ApiResult<{ readonly blockId: string }>> {
  const grant = await authorizeAvailabilityEdit(auth, {
    tokenIdentifier: input.tokenIdentifier,
    professionalId: null,
  });
  if (grant.status === "error") return denied();
  return store.insertBlock({ professionalId: grant.data.callerId, ...input.block });
}

/**
 * Reemplaza la ventana de un bloque propio. El dueño se lee en el servidor
 * desde la fila guardada: un bloque ajeno o inexistente se deniega igual,
 * sin filtrar existencia.
 *
 * Compara antes y después en la misma transacción y avisa solo lo que pasa de
 * reservable a no reservable, sin borrar ni cancelar. Acota a los días de la
 * semana del bloque viejo y del nuevo para no bloquear una agenda llena.
 */
export async function updateAvailabilityBlock(
  auth: AuthorizationReader,
  store: AvailabilityReader & AvailabilityWriter,
  input: {
    readonly tokenIdentifier: string | null;
    readonly blockId: string;
    readonly block: PublishBlockInput;
  },
  impact: AvailabilityChangeImpactDeps,
): Promise<ApiResult<null>> {
  const existing = await store.getBlock(input.blockId);
  if (existing === null) return denied();
  const grant = await authorizeAvailabilityEdit(auth, {
    tokenIdentifier: input.tokenIdentifier,
    professionalId: existing.professionalId,
  });
  if (grant.status === "error") return denied();
  const now = impact.now === undefined ? Date.now() : impact.now();
  const weekdays = [...new Set([existing.weekday, input.block.weekday])];
  const candidates = await collectAvailabilityCandidates(
    impact.future,
    existing.professionalId,
    weekdays,
    now,
  );
  if (!candidates.complete) return errResult(conflictError());
  const slotDeps = {
    auth,
    availability: store as AvailabilityReader,
    needs: impact.needs,
    compatibility: impact.compatibility,
  };
  const before = await evaluateAllBookable(slotDeps, candidates.appointments);
  if (!before.ok) return errResult(conflictError());
  const written = await store.updateBlock(input.blockId, input.block);
  if (written.status === "error") return written;
  const after = await evaluateAllBookable(slotDeps, candidates.appointments);
  if (!after.ok) return errResult(conflictError());
  const newly = candidates.appointments.filter(
    (appointment) =>
      before.byId.get(appointment.id) === true && after.byId.get(appointment.id) === false,
  );
  await notifyAvailabilityImpact(impact.notifications, newly, {
    actorId: grant.data.callerId,
    occurredAt: now,
  });
  return written;
}

/**
 * Activa o retira un bloque propio sin borrarlo. La reactivación exige que
 * la sala siga vigente; esa comprobación vive en el repositorio (TI2-95).
 *
 * Solo avisa lo que deja de estar cubierto: reactivar no avisa.
 */
export async function setAvailabilityBlockActive(
  auth: AuthorizationReader,
  store: AvailabilityReader & AvailabilityWriter,
  input: {
    readonly tokenIdentifier: string | null;
    readonly blockId: string;
    readonly isActive: boolean;
  },
  impact: AvailabilityChangeImpactDeps,
): Promise<ApiResult<null>> {
  const existing = await store.getBlock(input.blockId);
  if (existing === null) return denied();
  const grant = await authorizeAvailabilityEdit(auth, {
    tokenIdentifier: input.tokenIdentifier,
    professionalId: existing.professionalId,
  });
  if (grant.status === "error") return denied();
  const now = impact.now === undefined ? Date.now() : impact.now();
  const candidates = await collectAvailabilityCandidates(
    impact.future,
    existing.professionalId,
    [existing.weekday],
    now,
  );
  if (!candidates.complete) return errResult(conflictError());
  const slotDeps = {
    auth,
    availability: store as AvailabilityReader,
    needs: impact.needs,
    compatibility: impact.compatibility,
  };
  const before = await evaluateAllBookable(slotDeps, candidates.appointments);
  if (!before.ok) return errResult(conflictError());
  const written = await store.setBlockActive(input.blockId, input.isActive);
  if (written.status === "error") return written;
  const after = await evaluateAllBookable(slotDeps, candidates.appointments);
  if (!after.ok) return errResult(conflictError());
  const newly = candidates.appointments.filter(
    (appointment) =>
      before.byId.get(appointment.id) === true && after.byId.get(appointment.id) === false,
  );
  await notifyAvailabilityImpact(impact.notifications, newly, {
    actorId: grant.data.callerId,
    occurredAt: now,
  });
  return written;
}

/** Entrada de publicación de una excepción propia, sin profesional del cliente. */
export type PublishExceptionInput = Omit<
  StoredAvailabilityException,
  "id" | "professionalId" | "version"
>;

/**
 * Publica una excepción puntual propia (cancelación o agregado). El dueño
 * sale del actor autorizado, nunca del cliente. Solo la cancelación puede
 * dejar futuras sin cobertura y se avisa con antes/después en su fecha; el
 * agregado solo suma disponibilidad y no avisa.
 */
export async function publishAvailabilityException(
  auth: AuthorizationReader,
  store: AvailabilityReader & AvailabilityWriter,
  input: { readonly tokenIdentifier: string | null; readonly exception: PublishExceptionInput },
  impact: AvailabilityChangeImpactDeps,
): Promise<ApiResult<{ readonly exceptionId: string }>> {
  const grant = await authorizeAvailabilityEdit(auth, {
    tokenIdentifier: input.tokenIdentifier,
    professionalId: null,
  });
  if (grant.status === "error") return denied();
  if (input.exception.kind !== "cancelled") {
    return store.insertException({ professionalId: grant.data.callerId, ...input.exception });
  }
  const now = impact.now === undefined ? Date.now() : impact.now();
  const candidates = await collectAvailabilityCandidatesByDate(
    impact.future,
    grant.data.callerId,
    input.exception.date,
    now,
  );
  if (!candidates.complete) return errResult(conflictError());
  const slotDeps = {
    auth,
    availability: store as AvailabilityReader,
    needs: impact.needs,
    compatibility: impact.compatibility,
  };
  const before = await evaluateAllBookable(slotDeps, candidates.appointments);
  if (!before.ok) return errResult(conflictError());
  const written = await store.insertException({
    professionalId: grant.data.callerId,
    ...input.exception,
  });
  if (written.status === "error") return written;
  const after = await evaluateAllBookable(slotDeps, candidates.appointments);
  if (!after.ok) return errResult(conflictError());
  const newly = candidates.appointments.filter(
    (appointment) =>
      before.byId.get(appointment.id) === true && after.byId.get(appointment.id) === false,
  );
  await notifyAvailabilityImpact(impact.notifications, newly, {
    actorId: grant.data.callerId,
    occurredAt: now,
  });
  return written;
}

/**
 * Retira una excepción propia. Acota a su fecha: retirar una ventana agregada
 * puede dejar futuras sin cobertura y se avisa, retirar una cancelación solo
 * agrega disponibilidad y no avisa a nadie nuevo.
 */
export async function removeAvailabilityException(
  auth: AuthorizationReader,
  store: AvailabilityReader & AvailabilityWriter,
  input: { readonly tokenIdentifier: string | null; readonly exceptionId: string },
  impact: AvailabilityChangeImpactDeps,
): Promise<ApiResult<null>> {
  const existing = await store.getException(input.exceptionId);
  if (existing === null) return denied();
  const grant = await authorizeAvailabilityEdit(auth, {
    tokenIdentifier: input.tokenIdentifier,
    professionalId: existing.professionalId,
  });
  if (grant.status === "error") return denied();
  const now = impact.now === undefined ? Date.now() : impact.now();
  const candidates = await collectAvailabilityCandidatesByDate(
    impact.future,
    existing.professionalId,
    existing.date,
    now,
  );
  if (!candidates.complete) return errResult(conflictError());
  const slotDeps = {
    auth,
    availability: store as AvailabilityReader,
    needs: impact.needs,
    compatibility: impact.compatibility,
  };
  const before = await evaluateAllBookable(slotDeps, candidates.appointments);
  if (!before.ok) return errResult(conflictError());
  const written = await store.removeException(input.exceptionId);
  if (written.status === "error") return written;
  const after = await evaluateAllBookable(slotDeps, candidates.appointments);
  if (!after.ok) return errResult(conflictError());
  const newly = candidates.appointments.filter(
    (appointment) =>
      before.byId.get(appointment.id) === true && after.byId.get(appointment.id) === false,
  );
  await notifyAvailabilityImpact(impact.notifications, newly, {
    actorId: grant.data.callerId,
    occurredAt: now,
  });
  return written;
}

/** Disponibilidad propia: bloques vigentes y excepciones del rango pedido. */
export interface OwnAvailability {
  readonly blocks: readonly AvailabilityBlock[];
  readonly exceptions: readonly StoredAvailabilityException[];
}

/**
 * Lee la disponibilidad propia para editarla (TI2-111): los bloques vigentes
 * y las excepciones de un rango civil inclusivo de hasta `MAX_EXPANSION_DAYS`
 * días. El profesional sale del actor autorizado, nunca del cliente, así que
 * solo lee lo suyo; requiere profesional vigente como la escritura (TI2-86).
 * Un rango inválido o un tope de lectura superado responde `conflict` sin
 * lista cortada. Los bloques salen en la forma del contrato, sin la vigencia:
 * todos los listados están vigentes.
 */
export async function listOwnAvailability(
  auth: AuthorizationReader,
  store: AvailabilityReader,
  input: { readonly tokenIdentifier: string | null; readonly from: string; readonly to: string },
): Promise<ApiResult<OwnAvailability>> {
  const grant = await authorizeAvailabilityEdit(auth, {
    tokenIdentifier: input.tokenIdentifier,
    professionalId: null,
  });
  if (grant.status === "error") return denied();
  const [blocks, exceptions] = await Promise.all([
    store.listActiveBlocks(grant.data.callerId),
    store.listExceptions({ professionalId: grant.data.callerId, from: input.from, to: input.to }),
  ]);
  if (blocks.status === "error" || exceptions.status === "error") return conflict();
  return okResult({
    blocks: blocks.data.map(({ isActive: _isActive, ...block }) => block),
    exceptions: exceptions.data,
  });
}

/** Entrada de búsqueda de cupos para un acompañamiento activo. */
export interface SearchAvailabilityInput {
  readonly tokenIdentifier: string | null;
  readonly accompanimentId: string;
  readonly professionalId: string;
  readonly from: string;
  readonly to: string;
  readonly timeZone: string;
  readonly limit: number;
  readonly cursor?: string;
  readonly version: string;
}

/** Dependencias de la búsqueda, todas por puerto de `./ports` para probar con dobles. */
export interface SearchAvailabilityDeps {
  readonly auth: AuthorizationReader;
  readonly availability: AvailabilityReader;
  readonly needs: AccompanimentNeedsReader;
  readonly compatibility: CompatibilitySpaceSource;
  readonly occupancy: SlotOccupancyReader;
}

/**
 * Opción de compatibilidad de un cupo desde el catálogo: el espacio con
 * vigencia y condiciones para lo presencial, los apoyos de la plataforma
 * para lo en línea. `null` cuando el cupo presencial no trae sala o la
 * sala se retiró del catálogo.
 *
 * La comparten la búsqueda (TI2-97) y la reserva (TI2-98): ambas evalúan
 * la misma opción con `assessCompatibility` y no rebajan necesidades.
 */
export async function resolveCompatibilityOption(
  compatibility: CompatibilitySpaceSource,
  onlineSupports: readonly AccessNeed[],
  slot: AvailabilitySlot,
): Promise<CompatibilityOption | null> {
  if (slot.modality === "online") return { modality: "online", onlineSupports };
  if (slot.spaceId === undefined) return null;
  const space = await compatibility.findCompatibilitySpace(slot.spaceId);
  if (space === null) return null;
  return { modality: "inPerson", space };
}

/**
 * Cupos de un profesional en el rango: bloques vigentes y excepciones
 * expandidos con TI2-81, o `null` si su disponibilidad no se pudo leer o
 * expandir. La comparten la búsqueda de un profesional y la del
 * acompañamiento (TI4-84).
 */
export async function expandProfessionalSlots(
  availability: AvailabilityReader,
  input: {
    readonly professionalId: string;
    readonly from: string;
    readonly to: string;
    readonly timeZone: string;
  },
): Promise<AvailabilitySlot[] | null> {
  const [blocks, exceptions] = await Promise.all([
    availability.listActiveBlocks(input.professionalId),
    availability.listExceptions({
      professionalId: input.professionalId,
      from: input.from,
      to: input.to,
    }),
  ]);
  if (blocks.status === "error" || exceptions.status === "error") return null;
  try {
    return expandAvailabilitySlots({
      professionalId: input.professionalId,
      blocks: blocks.data,
      exceptions: exceptions.data,
      from: input.from,
      to: input.to,
      timeZone: input.timeZone,
    });
  } catch {
    return null;
  }
}

/**
 * Compatibilidad de un cupo con las necesidades vigentes (TI2-82), sin
 * rebajarlas. `unavailable` es una sala sin catálogo: no se ofrece a nadie y
 * no es una necesidad sin cubrir, así que no cambia el motivo de la ausencia.
 * `incompatible` cuenta para `needs_not_met` solo cuando faltan necesidades.
 */
export async function classifySlotCompatibility(
  compatibility: CompatibilitySpaceSource,
  context: {
    readonly needs: readonly AccessNeed[];
    readonly onlineSupports: readonly AccessNeed[];
  },
  slot: AvailabilitySlot,
): Promise<
  | { readonly status: "compatible"; readonly option: CompatibilityOption }
  | { readonly status: "incompatible"; readonly unmetNeeds: boolean }
  | { readonly status: "unavailable" }
> {
  const option = await resolveCompatibilityOption(compatibility, context.onlineSupports, slot);
  if (option === null) return { status: "unavailable" };
  const decision = assessCompatibility(context.needs, option);
  if (decision.compatible) return { status: "compatible", option };
  return {
    status: "incompatible",
    unmetNeeds: decision.issues.some((issue) => issue.code === "unmet_needs"),
  };
}

/**
 * Si el cupo cruza una atención del profesional, del estudiante del
 * acompañamiento o de la sala: los mismos recursos que comprueba la reserva.
 */
export async function isCandidateSlotOccupied(
  occupancy: SlotOccupancyReader,
  slot: AvailabilitySlot,
  studentId: string,
): Promise<boolean> {
  return await occupancy.isSlotOccupied({
    professionalId: slot.professionalId,
    studentId,
    ...(slot.spaceId === undefined ? {} : { spaceId: slot.spaceId }),
    startAt: slot.startAt,
    endAt: slot.endAt,
  });
}

/** Cupo ofrecido: el presencial suma la ubicación y el acceso de su sala. */
export function toSearchedSlot(
  slot: AvailabilitySlot,
  option: CompatibilityOption,
): SearchedAvailabilitySlot {
  return option.space === undefined ? slot : { ...slot, space: toSpaceFields(option.space.space) };
}

/**
 * Profesionales reservables del acompañamiento (TI2-123), o `null` si la
 * lectura acotada de candidatos no alcanzó. Única regla para el listado y la
 * búsqueda por acompañamiento (TI4-84).
 */
export async function findBookableProfessionalIds(
  deps: { readonly auth: AuthorizationReader; readonly professionals: BookableProfessionalSource },
  accompanimentId: string,
): Promise<string[] | null> {
  const candidates = await deps.professionals.listActiveProfessionalIds(accompanimentId);
  if (candidates === null) return null;
  const bookable = await Promise.all(
    candidates.map((professionalId) =>
      isBookableProfessional(deps.auth, { accompanimentId, professionalId }),
    ),
  );
  return candidates.filter((_, index) => bookable[index]);
}

/**
 * Consulta cupos compatibles para un acompañamiento activo.
 *
 * Autoriza con TI2-86 (acompañamiento activo con pertenencia o asignación
 * vigente; pausado, cerrado, revocado, practicante o administrador se
 * deniegan), exige que el profesional buscado sea reservable para ese
 * acompañamiento (si no, `no_compatible_slot` con `no_published_slots` sin
 * leer su disponibilidad, igual que uno sin agenda), expande con TI2-81,
 * descuenta la ocupación del profesional, del estudiante y de la sala
 * (TI2-84/TI2-96) y filtra por compatibilidad con las necesidades vigentes
 * sin rebajarlas (TI2-82). Cada cupo presencial ofrecido trae la ubicación y
 * el acceso de su sala.
 *
 * Sin opción compatible y libre responde `no_compatible_slot` (TI2-144): el
 * motivo sale de lo descartado (`decideNoCompatibleSlotReason`) y el código
 * de referencia, del acompañamiento, sin datos personales. Rango y página
 * acotados: la consulta nunca expone el calendario completo. Un cursor
 * ausente en la lista vigente responde `conflict` para reiniciar la
 * búsqueda; tras el último cupo, la página siguiente llega vacía.
 */
export async function searchAvailabilitySlots(
  deps: SearchAvailabilityDeps,
  input: SearchAvailabilityInput,
): Promise<ApiResult<AvailabilitySearchResult>> {
  if (input.version !== AVAILABILITY_CONTRACT_VERSION) return conflict();
  if (!Number.isInteger(input.limit) || input.limit < 1) return conflict();
  if (input.limit > SEARCH_AVAILABILITY_PAGE_LIMIT_MAX) return conflict();
  if (!isValidSearchRange(input.from, input.to)) return conflict();
  if (!isValidTimeZone(input.timeZone)) return conflict();
  if (input.accompanimentId.trim() === "" || input.professionalId.trim() === "") {
    return conflict();
  }

  const grant = await authorizeAvailabilityRead(deps.auth, {
    tokenIdentifier: input.tokenIdentifier,
    accompanimentId: input.accompanimentId,
    privacyCategory: "appointments",
  });
  if (grant.status === "error") return denied();
  // Un profesional no asignado, revocado o sin cuenta vigente responde igual
  // que uno sin cupos, antes de leer su disponibilidad.
  if (
    !(await isBookableProfessional(deps.auth, {
      accompanimentId: input.accompanimentId,
      professionalId: input.professionalId,
    }))
  ) {
    return noCompatibleSlot(input.accompanimentId, "no_published_slots");
  }

  const [expanded, needsEntry, onlineSupports, accompaniment] = await Promise.all([
    expandProfessionalSlots(deps.availability, input),
    deps.needs.findAccompanimentNeeds(input.accompanimentId),
    deps.compatibility.listOnlineSupports(),
    deps.auth.getAccompaniment(input.accompanimentId),
  ]);
  if (expanded === null || needsEntry === null || accompaniment === null) return conflict();

  const compatible: SearchedAvailabilitySlot[] = [];
  // Lo descartado solo decide el motivo de la ausencia; nunca se ofrece.
  // La compatibilidad se evalúa antes que la ocupación: un cupo ocupado solo
  // cuenta como `occupied` si cubría las necesidades, así el motivo no depende
  // de cuánto ocupan otras personas.
  const discarded = { occupied: 0, incompatible: 0 };
  for (const slot of expanded) {
    const compatibility = await classifySlotCompatibility(
      deps.compatibility,
      { needs: needsEntry.needs, onlineSupports },
      slot,
    );
    if (compatibility.status === "unavailable") continue;
    if (compatibility.status === "incompatible") {
      if (compatibility.unmetNeeds) discarded.incompatible += 1;
      continue;
    }
    // El estudiante del acompañamiento se revisa también cuando busca el profesional.
    if (await isCandidateSlotOccupied(deps.occupancy, slot, accompaniment.studentId)) {
      discarded.occupied += 1;
      continue;
    }
    compatible.push(toSearchedSlot(slot, compatibility.option));
  }

  let startIndex = 0;
  if (input.cursor !== undefined) {
    const found = compatible.findIndex((slot) => slot.id === input.cursor);
    if (found === -1) return conflict();
    startIndex = found + 1;
  }
  if (compatible.length === 0) {
    return noCompatibleSlot(input.accompanimentId, decideNoCompatibleSlotReason(discarded));
  }
  const window = compatible.slice(startIndex, startIndex + input.limit + 1);
  const items = window.slice(0, input.limit);
  const hasMore = window.length > items.length;
  return okResult({
    status: "available",
    items,
    hasMore,
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    version: AVAILABILITY_CONTRACT_VERSION,
  });
}

/** Ausencia explícita de horario compatible, con su motivo, referencia y canales (TI2-144). */
function noCompatibleSlot(
  accompanimentId: string,
  reason: NoCompatibleSlotReason,
): ApiResult<AvailabilitySearchResult> {
  return okResult({
    status: "no_compatible_slot",
    coordination: toOfficialChannelCoordination(accompanimentId, reason),
    version: AVAILABILITY_CONTRACT_VERSION,
  });
}

/** Profesionales con quienes se puede reservar en un acompañamiento. */
export interface BookableProfessionals {
  readonly professionalIds: readonly string[];
  readonly version: typeof AVAILABILITY_CONTRACT_VERSION;
}

/**
 * Profesionales reservables de un acompañamiento activo (TI2-123): permite la
 * primera reserva, cuando aún no hay atenciones de donde conocer al profesional.
 *
 * Usa la misma autorización que la búsqueda de cupos y la misma regla
 * `isBookableProfessional`, así no entrega a quien la búsqueda rechazaría. Solo
 * expone identificadores, los mismos que ya trae cada cupo. Sin profesionales
 * responde una lista vacía: no es falta de cupo.
 */
export async function listBookableProfessionals(
  deps: {
    readonly auth: AuthorizationReader;
    readonly professionals: BookableProfessionalSource;
  },
  input: { readonly tokenIdentifier: string | null; readonly accompanimentId: string },
): Promise<ApiResult<BookableProfessionals>> {
  const grant = await authorizeAvailabilityRead(deps.auth, {
    tokenIdentifier: input.tokenIdentifier,
    accompanimentId: input.accompanimentId,
    privacyCategory: "appointments",
  });
  if (grant.status === "error") return denied();
  const professionalIds = await findBookableProfessionalIds(deps, input.accompanimentId);
  if (professionalIds === null) return conflict();
  return okResult({ professionalIds, version: AVAILABILITY_CONTRACT_VERSION });
}
