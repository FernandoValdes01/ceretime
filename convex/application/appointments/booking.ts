import {
  expandAvailabilitySlots,
  type AvailabilitySlot,
} from "../../domain/availability/availability";
import {
  conflictError,
  errResult,
  noAvailabilityError,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import type { ModalityPreference } from "../../domain/requests/request";
import { assessCompatibility } from "../../domain/spaces/compatibility";
import { authorizeAppointmentBook, type AuthorizationReader } from "../authorization/authorize";
import { isValidTimeZone, resolveCompatibilityOption } from "../availability/availability";
import type {
  AccompanimentNeedsReader,
  AvailabilityReader,
  CompatibilitySpaceSource,
} from "../availability/ports";
import type { AppointmentOccupier, OccupySlotSuccess } from "./occupancy";

/**
 * Caso de uso único de reserva de un cupo compatible (TI2-98).
 *
 * Capa de Aplicación: autoriza al Estudiante dueño del acompañamiento,
 * revalida el cupo contra la disponibilidad vigente y consume la ocupación
 * atómica de TI2-84/TI2-96. No crea entrada pública (TI2-111), no toca
 * `ctx.db` ni repite la búsqueda de TI2-97: recibe puertos por parámetro y se
 * prueba con dobles en memoria. Reserva y atención son la misma entidad
 * (`appointments`), sin tabla ni contrato paralelo.
 *
 * La selección del cliente no es prueba de nada: el horario, la modalidad y
 * la sala se vuelven a derivar de los bloques y excepciones vigentes dentro
 * de la misma operación transaccional que escribe. Una sala retirada, un
 * bloque desactivado, una excepción cancelada o una necesidad no cubierta
 * responden `no_availability` sin escribir. La contención de estudiante,
 * profesional o sala la decide la ocupación atómica y responde `conflict`
 * sin revelar qué recurso estaba ocupado. Toda denegación de autorización
 * usa el mismo error genérico, sin filtrar existencia.
 *
 * Opera con datos ficticios.
 */

/** Entrada de reserva: el cupo elegido más la identidad de la sesión. */
export interface BookAppointmentInput {
  readonly tokenIdentifier: string | null;
  readonly accompanimentId: string;
  readonly professionalId: string;
  readonly modality: ModalityPreference;
  /** Referencia opaca al espacio; obligatoria en presencial y ausente en línea. */
  readonly spaceId?: string;
  /** Inicio del cupo como milésimas de segundo epoch (vocabulario TI2-87). */
  readonly startAt: number;
  /** Fin del cupo como milésimas de segundo epoch (vocabulario TI2-87). */
  readonly endAt: number;
  /** Zona horaria IANA con la que se expandió el cupo seleccionado. */
  readonly timeZone: string;
}

/** Dependencias de la reserva, todas por puerto para probar con dobles. */
export interface BookAppointmentDeps {
  readonly auth: AuthorizationReader;
  readonly availability: AvailabilityReader;
  readonly needs: AccompanimentNeedsReader;
  readonly compatibility: CompatibilitySpaceSource;
  readonly occupier: AppointmentOccupier;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = dateFormatters.get(timeZone);
  if (cached !== undefined) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  dateFormatters.set(timeZone, created);
  return created;
}

function civilDateOfInstant(epochMs: number, timeZone: string): string {
  const parts = dateFormatterFor(timeZone)
    .formatToParts(new Date(epochMs))
    .reduce<Record<string, string>>((accumulator, part) => {
      accumulator[part.type] = part.value;
      return accumulator;
    }, {});
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
}

function isUsableInstant(value: number): boolean {
  return Number.isFinite(value) && value > 0 && !Number.isNaN(new Date(value).getTime());
}

function normalizeSpaceId(spaceId: string | undefined): string | undefined {
  if (spaceId === undefined) return undefined;
  const trimmed = spaceId.trim();
  return trimmed === "" ? undefined : trimmed;
}

function denied<T>(): ApiResult<T> {
  return errResult(unauthorizedError());
}

function conflict<T>(): ApiResult<T> {
  return errResult(conflictError());
}

function noAvailability<T>(): ApiResult<T> {
  return errResult(noAvailabilityError());
}

/**
 * Relee disponibilidad y devuelve el cupo vigente que coincide exactamente
 * con la selección. Un bloque retirado, una excepción cancelada, un horario
 * que ya no existe o una modalidad/sala distinta responden `no_availability`;
 * una lectura truncada o inválida responde `conflict`.
 */
async function findCurrentSlot(
  deps: BookAppointmentDeps,
  input: BookAppointmentInput,
  spaceId: string | undefined,
  date: string,
): Promise<ApiResult<AvailabilitySlot>> {
  const [blocksResult, exceptionsResult] = await Promise.all([
    deps.availability.listActiveBlocks(input.professionalId),
    deps.availability.listExceptions({
      professionalId: input.professionalId,
      from: date,
      to: date,
    }),
  ]);
  if (blocksResult.status === "error" || exceptionsResult.status === "error") {
    return conflict();
  }

  let expanded: AvailabilitySlot[];
  try {
    expanded = expandAvailabilitySlots({
      professionalId: input.professionalId,
      blocks: blocksResult.data,
      exceptions: exceptionsResult.data,
      from: date,
      to: date,
      timeZone: input.timeZone,
    });
  } catch {
    return conflict();
  }

  const selected = expanded.find(
    (slot) =>
      slot.startAt === input.startAt &&
      slot.endAt === input.endAt &&
      slot.modality === input.modality &&
      slot.spaceId === spaceId,
  );
  return selected === undefined ? noAvailability() : { status: "ok", data: selected };
}

/**
 * Reserva un cupo propio, activo y compatible.
 *
 * Valida la forma de la entrada, autoriza con TI2-86, revalida la
 * disponibilidad y la compatibilidad con las necesidades vigentes, y solo
 * entonces pide la ocupación atómica. La atención creada usa el estudiante
 * de la sesión, nunca un identificador enviado por el cliente, y conserva
 * como fecha efectiva el inicio del cupo revalidado.
 */
export async function bookAppointment(
  deps: BookAppointmentDeps,
  input: BookAppointmentInput,
): Promise<ApiResult<OccupySlotSuccess>> {
  if (
    input.accompanimentId.trim() === "" ||
    input.professionalId.trim() === "" ||
    (input.modality !== "inPerson" && input.modality !== "online") ||
    !isUsableInstant(input.startAt) ||
    !isUsableInstant(input.endAt) ||
    input.startAt >= input.endAt ||
    !isValidTimeZone(input.timeZone)
  ) {
    return conflict();
  }

  const spaceId = normalizeSpaceId(input.spaceId);
  if (
    (input.modality === "inPerson" && spaceId === undefined) ||
    (input.modality === "online" && spaceId !== undefined)
  ) {
    return conflict();
  }

  const grant = await authorizeAppointmentBook(deps.auth, {
    tokenIdentifier: input.tokenIdentifier,
    accompanimentId: input.accompanimentId,
  });
  if (grant.status === "error") return denied();

  const date = civilDateOfInstant(input.startAt, input.timeZone);
  const current = await findCurrentSlot(deps, input, spaceId, date);
  if (current.status === "error") return current;

  const needs = await deps.needs.findAccompanimentNeeds(input.accompanimentId);
  if (needs === null) return conflict();

  const onlineSupports =
    current.data.modality === "online" ? await deps.compatibility.listOnlineSupports() : [];
  const option = await resolveCompatibilityOption(deps.compatibility, onlineSupports, current.data);
  if (option === null) return noAvailability();
  if (!assessCompatibility(needs.needs, option).compatible) return noAvailability();

  return await deps.occupier.occupySlot({
    accompanimentId: input.accompanimentId,
    studentId: grant.data.callerId,
    professionalId: current.data.professionalId,
    modality: current.data.modality,
    ...(current.data.spaceId === undefined ? {} : { spaceId: current.data.spaceId }),
    startAt: current.data.startAt,
    endAt: current.data.endAt,
  });
}
