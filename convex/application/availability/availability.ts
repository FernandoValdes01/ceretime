import {
  AVAILABILITY_CONTRACT_VERSION,
  expandAvailabilitySlots,
  isValidCivilDate,
  type AvailabilityBlock,
  type AvailabilitySlot,
  type AvailabilitySlotPage,
} from "../../domain/availability/availability";
import { isProfessionalBookable } from "../../domain/authorization/permissions";
import {
  conflictError,
  errResult,
  noAvailabilityError,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import type { AccessNeed } from "../../domain/requests/request";
import { assessCompatibility, type CompatibilityOption } from "../../domain/spaces/compatibility";
import {
  authorizeAvailabilityEdit,
  authorizeAvailabilityRead,
  type AuthorizationReader,
} from "../authorization/authorize";
import type {
  AccompanimentNeedsReader,
  AvailabilityReader,
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
 * espacio con las necesidades vigentes sin rebajarlas (TI2-82). Sin opción compatible y
 * libre responde `no_availability` (TI2-88) con la referencia mínima
 * `accompanimentId` de la entrada, sin crear reserva incompatible. Rango
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

function isValidSearchRange(from: string, to: string): boolean {
  return isValidCivilDate(from) && isValidCivilDate(to) && from <= to;
}

/** Entrada de publicación de un bloque propio, sin profesional del cliente. */
export type PublishBlockInput = Omit<AvailabilityBlock, "id" | "professionalId" | "version">;

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
 */
export async function updateAvailabilityBlock(
  auth: AuthorizationReader,
  store: AvailabilityReader & AvailabilityWriter,
  input: {
    readonly tokenIdentifier: string | null;
    readonly blockId: string;
    readonly block: PublishBlockInput;
  },
): Promise<ApiResult<null>> {
  const existing = await store.getBlock(input.blockId);
  if (existing === null) return denied();
  const grant = await authorizeAvailabilityEdit(auth, {
    tokenIdentifier: input.tokenIdentifier,
    professionalId: existing.professionalId,
  });
  if (grant.status === "error") return denied();
  return store.updateBlock(input.blockId, input.block);
}

/**
 * Activa o retira un bloque propio sin borrarlo. La reactivación exige que
 * la sala siga vigente; esa comprobación vive en el repositorio (TI2-95).
 */
export async function setAvailabilityBlockActive(
  auth: AuthorizationReader,
  store: AvailabilityReader & AvailabilityWriter,
  input: {
    readonly tokenIdentifier: string | null;
    readonly blockId: string;
    readonly isActive: boolean;
  },
): Promise<ApiResult<null>> {
  const existing = await store.getBlock(input.blockId);
  if (existing === null) return denied();
  const grant = await authorizeAvailabilityEdit(auth, {
    tokenIdentifier: input.tokenIdentifier,
    professionalId: existing.professionalId,
  });
  if (grant.status === "error") return denied();
  return store.setBlockActive(input.blockId, input.isActive);
}

/** Entrada de publicación de una excepción propia, sin profesional del cliente. */
export type PublishExceptionInput = Omit<
  StoredAvailabilityException,
  "id" | "professionalId" | "version"
>;

/**
 * Publica una excepción puntual propia (cancelación o agregado). El dueño
 * sale del actor autorizado, nunca del cliente.
 */
export async function publishAvailabilityException(
  auth: AuthorizationReader,
  store: AvailabilityWriter,
  input: { readonly tokenIdentifier: string | null; readonly exception: PublishExceptionInput },
): Promise<ApiResult<{ readonly exceptionId: string }>> {
  const grant = await authorizeAvailabilityEdit(auth, {
    tokenIdentifier: input.tokenIdentifier,
    professionalId: null,
  });
  if (grant.status === "error") return denied();
  return store.insertException({ professionalId: grant.data.callerId, ...input.exception });
}

/**
 * Retira una excepción propia. Una excepción ajena o inexistente se deniega
 * igual, sin filtrar existencia.
 */
export async function removeAvailabilityException(
  auth: AuthorizationReader,
  store: AvailabilityReader & AvailabilityWriter,
  input: { readonly tokenIdentifier: string | null; readonly exceptionId: string },
): Promise<ApiResult<null>> {
  const existing = await store.getException(input.exceptionId);
  if (existing === null) return denied();
  const grant = await authorizeAvailabilityEdit(auth, {
    tokenIdentifier: input.tokenIdentifier,
    professionalId: existing.professionalId,
  });
  if (grant.status === "error") return denied();
  return store.removeException(input.exceptionId);
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
 * Verdadero cuando el profesional buscado podría atender la reserva: rol
 * profesional, cuenta habilitada y vigente, y asignación activa en este
 * acompañamiento. Es la misma regla de dominio que revalida la reserva de
 * TI2-98, así la búsqueda no expone la agenda de quien no atiende el
 * acompañamiento ni ofrece cupos que la reserva rechazaría (TI2-111).
 */
async function isBookableProfessional(
  auth: AuthorizationReader,
  accompanimentId: string,
  professionalId: string,
): Promise<boolean> {
  const [profile, assignments] = await Promise.all([
    auth.getProfileById(professionalId),
    auth.findActiveAssignments(accompanimentId, professionalId),
  ]);
  return (
    profile !== null &&
    isProfessionalBookable({
      role: profile.role,
      institutionalStatus: profile.institutionalStatus,
      accountStatus: profile.accountStatus,
      hasActiveProfessionalAssignment: assignments.some(
        (assignment) =>
          assignment.accompanimentId === accompanimentId &&
          assignment.userId === profile._id &&
          assignment.assignedRole === "professional" &&
          assignment.status === "active",
      ),
    })
  );
}

/**
 * Consulta cupos compatibles para un acompañamiento activo.
 *
 * Autoriza con TI2-86 (acompañamiento activo con pertenencia o asignación
 * vigente; pausado, cerrado, revocado, practicante o administrador se
 * deniegan), exige que el profesional buscado sea reservable para ese
 * acompañamiento (si no, `no_availability` sin leer su disponibilidad),
 * expande con TI2-81, descuenta la ocupación del profesional, del
 * estudiante y de la sala (TI2-84/TI2-96) y
 * filtra por compatibilidad con las necesidades vigentes sin rebajarlas
 * (TI2-82). Sin opción compatible y libre responde `no_availability`
 * (TI2-88) con la referencia mínima `accompanimentId` de la entrada, sin
 * crear reserva incompatible. Rango y página acotados: la consulta nunca
 * expone el calendario completo. Un cursor ausente en la lista vigente
 * responde `conflict` para reiniciar la búsqueda.
 */
export async function searchAvailabilitySlots(
  deps: SearchAvailabilityDeps,
  input: SearchAvailabilityInput,
): Promise<ApiResult<AvailabilitySlotPage>> {
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
  });
  if (grant.status === "error") return denied();
  // Un profesional no asignado, revocado o sin cuenta vigente responde igual
  // que uno sin cupos, antes de leer su disponibilidad.
  if (!(await isBookableProfessional(deps.auth, input.accompanimentId, input.professionalId))) {
    return errResult(noAvailabilityError());
  }

  const [blocksResult, exceptionsResult, needsEntry, onlineSupports, accompaniment] =
    await Promise.all([
      deps.availability.listActiveBlocks(input.professionalId),
      deps.availability.listExceptions({
        professionalId: input.professionalId,
        from: input.from,
        to: input.to,
      }),
      deps.needs.findAccompanimentNeeds(input.accompanimentId),
      deps.compatibility.listOnlineSupports(),
      deps.auth.getAccompaniment(input.accompanimentId),
    ]);
  if (blocksResult.status === "error" || exceptionsResult.status === "error") {
    return conflict();
  }
  if (needsEntry === null || accompaniment === null) return conflict();

  let expanded: AvailabilitySlot[];
  try {
    expanded = expandAvailabilitySlots({
      professionalId: input.professionalId,
      blocks: blocksResult.data,
      exceptions: exceptionsResult.data,
      from: input.from,
      to: input.to,
      timeZone: input.timeZone,
    });
  } catch {
    return conflict();
  }

  const compatible: AvailabilitySlot[] = [];
  for (const slot of expanded) {
    // Los mismos recursos que comprueba la reserva: el profesional, el
    // estudiante del acompañamiento (también cuando busca el profesional) y
    // la sala del cupo presencial.
    const occupied = await deps.occupancy.isSlotOccupied({
      professionalId: input.professionalId,
      studentId: accompaniment.studentId,
      ...(slot.spaceId === undefined ? {} : { spaceId: slot.spaceId }),
      startAt: slot.startAt,
      endAt: slot.endAt,
    });
    if (occupied) continue;
    const option = await resolveCompatibilityOption(deps.compatibility, onlineSupports, slot);
    if (option === null) continue;
    if (assessCompatibility(needsEntry.needs, option).compatible) compatible.push(slot);
  }

  let startIndex = 0;
  if (input.cursor !== undefined) {
    const found = compatible.findIndex((slot) => slot.id === input.cursor);
    if (found === -1) return conflict();
    startIndex = found + 1;
  }
  const window = compatible.slice(startIndex, startIndex + input.limit + 1);
  const items = window.slice(0, input.limit);
  const hasMore = window.length > items.length;
  if (items.length === 0) return errResult(noAvailabilityError());
  return okResult({
    items,
    hasMore,
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    version: AVAILABILITY_CONTRACT_VERSION,
  });
}
