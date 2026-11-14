import { INITIAL_APPOINTMENT_STATUS } from "../../domain/appointments/appointment";
import { normalizeOnlineSupports } from "../../domain/appointments/online_access";
import {
  isAppointmentProfessional,
  normalizeAppointmentProfessionals,
} from "../../domain/appointments/participants";
import {
  expandAvailabilitySlots,
  slotsCoverInterval,
  type AvailabilitySlot,
} from "../../domain/availability/availability";
import {
  conflictError,
  errResult,
  noAvailabilityError,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import type { AccessNeed, ModalityPreference } from "../../domain/requests/request";
import { assessCompatibility } from "../../domain/spaces/compatibility";
import {
  authorizeAppointmentBook,
  isBookableProfessional,
  type AuthorizationReader,
} from "../authorization/authorize";
import { isValidTimeZone, resolveCompatibilityOption } from "../availability/availability";
import type {
  AccompanimentNeedsReader,
  AvailabilityReader,
  CompatibilitySpaceSource,
} from "../availability/ports";
import { auditAppointmentChange, type AppointmentAuditRecorder } from "./audit";
import type { AppointmentOccupier, OccupySlotSuccess } from "./occupancy";

/**
 * Reserva de un cupo compatible (TI2-98).
 *
 * Capa de Aplicación: autoriza al Estudiante dueño del acompañamiento,
 * revalida el cupo contra la disponibilidad vigente y consume la ocupación
 * atómica de TI2-84/TI2-96. No crea entrada pública (TI2-111), no toca
 * `ctx.db` ni repite la búsqueda de TI2-97: recibe puertos por parámetro y se
 * prueba con dobles en memoria. Reserva y atención son la misma entidad
 * (`appointments`), sin tabla ni contrato paralelo.
 *
 * La selección del cliente no es prueba de nada: el Profesional debe seguir
 * asignado activamente al acompañamiento y tener cuenta habilitada y vigente,
 * y el horario, la modalidad y la sala se vuelven a derivar de los bloques y
 * excepciones vigentes dentro de la misma operación transaccional que escribe.
 * Un Profesional no reservable, una sala retirada, un bloque desactivado, una
 * excepción cancelada o una necesidad no cubierta responden `no_availability`
 * sin escribir. La contención de estudiante, profesional o sala la decide la
 * ocupación atómica y responde `conflict` sin revelar qué recurso estaba
 * ocupado. Toda denegación de autorización usa el mismo error genérico, sin
 * filtrar existencia.
 *
 * `resolveBookableSlot` es la revalidación compartida con el reagendamiento
 * de TI2-109: ambos casos de uso aceptan solo un cupo vigente y compatible,
 * sin duplicar la regla en dos módulos.
 *
 * Coordinación con varios profesionales (TI2-142): el Profesional asignado
 * también reserva, en nombre del Estudiante dueño, y puede sumar profesionales
 * adicionales y apoyos de la atención en línea. Cada adicional debe ser
 * reservable y tener disponibilidad vigente de la misma modalidad durante toda
 * la atención (`confirmAdditionalProfessionals`); la ocupación atómica
 * comprueba los cruces de todos. El Estudiante reserva como antes: no elige
 * profesionales adicionales ni declara apoyos.
 *
 * Opera con datos ficticios.
 */

/** Forma del cupo elegido, sin identidad ni acompañamiento. */
export interface SlotSelectionShape {
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

/** Cupo elegido más el acompañamiento que lo admite. */
export interface SlotSelectionInput extends SlotSelectionShape {
  readonly accompanimentId: string;
  /**
   * Apoyos ya normalizados que la atención en línea declara (TI2-142). Se
   * suman a los de la plataforma para cubrir las necesidades vigentes.
   */
  readonly onlineSupports?: readonly AccessNeed[];
}

/** Entrada de reserva: el cupo elegido más la identidad de la sesión. */
export interface BookAppointmentInput extends SlotSelectionInput {
  readonly tokenIdentifier: string | null;
  /** Profesionales que acompañan al responsable; solo los elige un Profesional. */
  readonly additionalProfessionalIds?: readonly string[];
}

/** Dependencias de la revalidación de cupo, compartidas con TI2-109. */
export interface SlotSelectionDeps {
  readonly auth: AuthorizationReader;
  readonly availability: AvailabilityReader;
  readonly needs: AccompanimentNeedsReader;
  readonly compatibility: CompatibilitySpaceSource;
}

/** Dependencias de la reserva, todas por puerto para probar con dobles. */
export interface BookAppointmentDeps extends SlotSelectionDeps {
  readonly occupier: AppointmentOccupier;
  readonly audit: AppointmentAuditRecorder;
  /** Reloj del servidor para el evento de auditoría; las pruebas lo fijan. */
  readonly now?: () => number;
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
 * Verdadero cuando la forma del cupo es inválida antes de autorizar. La
 * relación entre modalidad y sala se comprueba en `resolveBookableSlot`, para
 * que una petición sin identidad no reciba detalles de forma.
 */
export function slotSelectionProblem(input: SlotSelectionShape): boolean {
  return (
    input.professionalId.trim() === "" ||
    (input.modality !== "inPerson" && input.modality !== "online") ||
    !isUsableInstant(input.startAt) ||
    !isUsableInstant(input.endAt) ||
    input.startAt >= input.endAt ||
    !isValidTimeZone(input.timeZone)
  );
}

/**
 * Cupos vigentes del profesional en la fecha civil, releídos de sus bloques y
 * excepciones. Una lectura truncada o una expansión inválida responden
 * `conflict`, nunca una lista cortada.
 */
async function expandProfessionalSlots(
  deps: SlotSelectionDeps,
  professionalId: string,
  date: string,
  timeZone: string,
): Promise<ApiResult<AvailabilitySlot[]>> {
  const [blocksResult, exceptionsResult] = await Promise.all([
    deps.availability.listActiveBlocks(professionalId),
    deps.availability.listExceptions({ professionalId, from: date, to: date }),
  ]);
  if (blocksResult.status === "error" || exceptionsResult.status === "error") {
    return conflict();
  }
  try {
    return okResult(
      expandAvailabilitySlots({
        professionalId,
        blocks: blocksResult.data,
        exceptions: exceptionsResult.data,
        from: date,
        to: date,
        timeZone,
      }),
    );
  } catch {
    return conflict();
  }
}

/**
 * Relee disponibilidad y devuelve el cupo vigente que coincide exactamente
 * con la selección. Un bloque retirado, una excepción cancelada, un horario
 * que ya no existe o una modalidad/sala distinta responden `no_availability`;
 * una lectura truncada o inválida responde `conflict`.
 */
async function findCurrentSlot(
  deps: SlotSelectionDeps,
  input: SlotSelectionInput,
  spaceId: string | undefined,
  date: string,
): Promise<ApiResult<AvailabilitySlot>> {
  const current = await expandProfessionalSlots(deps, input.professionalId, date, input.timeZone);
  if (current.status === "error") return current;

  const selected = current.data.find(
    (slot) =>
      slot.startAt === input.startAt &&
      slot.endAt === input.endAt &&
      slot.modality === input.modality &&
      slot.spaceId === spaceId,
  );
  return selected === undefined ? noAvailability() : { status: "ok", data: selected };
}

/**
 * Revalida el Profesional, el cupo y la compatibilidad con las necesidades
 * vigentes. Es la parte común de reservar y reagendar: el cliente elige, pero
 * solo se escribe lo que sigue disponible y cubre las necesidades actuales.
 * La sala se exige en presencial y se prohíbe en línea antes de leer nada.
 */
export async function resolveBookableSlot(
  deps: SlotSelectionDeps,
  input: SlotSelectionInput,
): Promise<ApiResult<AvailabilitySlot>> {
  const spaceId = normalizeSpaceId(input.spaceId);
  if (
    (input.modality === "inPerson" && spaceId === undefined) ||
    (input.modality === "online" && spaceId !== undefined)
  ) {
    return conflict();
  }

  if (
    !(await isBookableProfessional(deps.auth, {
      accompanimentId: input.accompanimentId,
      professionalId: input.professionalId,
    }))
  ) {
    return noAvailability();
  }

  const date = civilDateOfInstant(input.startAt, input.timeZone);
  const current = await findCurrentSlot(deps, input, spaceId, date);
  if (current.status === "error") return current;

  const needs = await deps.needs.findAccompanimentNeeds(input.accompanimentId);
  if (needs === null) return conflict();

  const onlineSupports =
    current.data.modality === "online"
      ? [...(await deps.compatibility.listOnlineSupports()), ...(input.onlineSupports ?? [])]
      : [];
  const option = await resolveCompatibilityOption(deps.compatibility, onlineSupports, current.data);
  if (option === null) return noAvailability();
  if (!assessCompatibility(needs.needs, option).compatible) return noAvailability();

  return { status: "ok", data: current.data };
}

/**
 * Confirma que cada profesional adicional puede atender el cupo ya revalidado
 * del responsable (TI2-142): sigue siendo reservable en el acompañamiento y su
 * disponibilidad vigente de la misma modalidad cubre todo el intervalo, aunque
 * esté partida en cupos de otra duración. La sala la fija el cupo del
 * responsable. Un adicional que no cumple responde `no_availability`, igual
 * que un responsable no reservable; los cruces los decide la ocupación.
 */
export async function confirmAdditionalProfessionals(
  deps: SlotSelectionDeps,
  input: {
    readonly accompanimentId: string;
    readonly slot: AvailabilitySlot;
    readonly additionalProfessionalIds: readonly string[];
    readonly timeZone: string;
  },
): Promise<ApiResult<null>> {
  const date = civilDateOfInstant(input.slot.startAt, input.timeZone);
  for (const professionalId of input.additionalProfessionalIds) {
    if (
      !(await isBookableProfessional(deps.auth, {
        accompanimentId: input.accompanimentId,
        professionalId,
      }))
    ) {
      return noAvailability();
    }
    const slots = await expandProfessionalSlots(deps, professionalId, date, input.timeZone);
    if (slots.status === "error") return slots;
    const sameModality = slots.data.filter((slot) => slot.modality === input.slot.modality);
    if (!slotsCoverInterval(sameModality, input.slot)) return noAvailability();
  }
  return okResult(null);
}

/**
 * Reserva un cupo propio, activo y compatible.
 *
 * Valida la forma de la entrada, autoriza con TI2-86, revalida la
 * disponibilidad y la compatibilidad con las necesidades vigentes, y solo
 * entonces pide la ocupación atómica. La atención creada usa el Estudiante
 * dueño del acompañamiento leído en el servidor (el de la sesión, si reserva
 * él), nunca un identificador enviado por el cliente, y conserva
 * como fecha efectiva el inicio del cupo revalidado. Una reserva exitosa
 * deja su evento mínimo de auditoría (TI2-128) en la misma mutation.
 */
export async function bookAppointment(
  deps: BookAppointmentDeps,
  input: BookAppointmentInput,
): Promise<ApiResult<OccupySlotSuccess>> {
  if (input.accompanimentId.trim() === "" || slotSelectionProblem(input)) {
    return conflict();
  }

  const grant = await authorizeAppointmentBook(deps.auth, {
    tokenIdentifier: input.tokenIdentifier,
    accompanimentId: input.accompanimentId,
  });
  if (grant.status === "error") return denied();

  // El Estudiante reserva su atención como antes: elegir otros profesionales
  // o declarar apoyos es coordinación del personal autorizado.
  const requestedAdditional = input.additionalProfessionalIds ?? [];
  const requestedSupports = input.onlineSupports ?? [];
  if (
    grant.data.actor === "student" &&
    (requestedAdditional.length > 0 || requestedSupports.length > 0)
  ) {
    return denied();
  }

  const professionals = normalizeAppointmentProfessionals({
    professionalId: input.professionalId,
    additionalProfessionalIds: requestedAdditional,
  });
  if (professionals.status === "rejected") return conflict();
  // Quien coordina participa: un Profesional no agenda una atención ajena.
  if (
    grant.data.actor === "professional" &&
    !isAppointmentProfessional(grant.data.callerId, professionals)
  ) {
    return denied();
  }

  const supports = normalizeOnlineSupports(input.modality, requestedSupports);
  if (supports.status === "rejected") return conflict();

  const slot = await resolveBookableSlot(deps, {
    ...input,
    professionalId: professionals.professionalId,
    onlineSupports: supports.supports,
  });
  if (slot.status === "error") return slot;

  const additional = await confirmAdditionalProfessionals(deps, {
    accompanimentId: input.accompanimentId,
    slot: slot.data,
    additionalProfessionalIds: professionals.additionalProfessionalIds,
    timeZone: input.timeZone,
  });
  if (additional.status === "error") return additional;

  const occupied = await deps.occupier.occupySlot({
    accompanimentId: input.accompanimentId,
    studentId: grant.data.studentId,
    professionalId: slot.data.professionalId,
    modality: slot.data.modality,
    ...(slot.data.spaceId === undefined ? {} : { spaceId: slot.data.spaceId }),
    startAt: slot.data.startAt,
    endAt: slot.data.endAt,
    ...(professionals.additionalProfessionalIds.length === 0
      ? {}
      : { additionalProfessionalIds: professionals.additionalProfessionalIds }),
    ...(supports.supports.length === 0 ? {} : { onlineSupports: supports.supports }),
  });
  if (occupied.status === "error") return occupied;

  await auditAppointmentChange(deps.audit, {
    action: "booked",
    actorId: grant.data.callerId,
    appointmentId: occupied.data.appointmentId,
    result: INITIAL_APPOINTMENT_STATUS,
    occurredAt: deps.now === undefined ? Date.now() : deps.now(),
  });
  return occupied;
}
