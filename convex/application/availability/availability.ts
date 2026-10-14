import {
  AVAILABILITY_CONTRACT_VERSION,
  expandAvailabilitySlots,
  isValidCivilDate,
  type AvailabilityBlock,
  type AvailabilityException,
  type AvailabilitySlot,
  type AvailabilitySlotPage,
} from "../../domain/availability/availability";
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

/**
 * Casos de uso de disponibilidad (TI2-97).
 *
 * Capa de Aplicación: publica bloques y excepciones del profesional y
 * consulta cupos compatibles para un acompañamiento activo. No crea
 * entrada pública (`query`/`mutation` de TI2-111) ni toca `ctx.db`
 * (repositorios de TI2-95): recibe puertos por parámetro y se prueba con
 * dobles en memoria. Opera con datos ficticios.
 *
 * Autorización (TI2-86): escribir exige profesional vigente sobre su
 * propia disponibilidad; leer exige acompañamiento activo con pertenencia
 * (estudiante dueño) o asignación vigente (profesional asignado). Toda
 * denegación responde el mismo error genérico, sin revelar existencia.
 *
 * Búsqueda: combina recurrencia y excepciones (TI2-81), compatibilidad de
 * modalidad y espacio con las necesidades vigentes sin rebajarlas (TI2-82),
 * ocupación por puerto (TI2-84/TI2-96) y ausencia de cupo con coordinación
 * por el canal oficial (TI2-88, referencia mínima `accompanimentId`).
 * El rango se acota a `MAX_EXPANSION_DAYS` y la página a
 * `SEARCH_AVAILABILITY_PAGE_LIMIT_MAX`: nunca se expone el calendario
 * completo en una sola respuesta.
 */

/** Tope de cupos por página: se rechaza el exceso, nunca se trunca en silencio. */
export const SEARCH_AVAILABILITY_PAGE_LIMIT_MAX = 50;

/** Bloque guardado: contrato de TI2-87 más la vigencia que persiste TI2-95. */
export type StoredAvailabilityBlock = AvailabilityBlock & { readonly isActive: boolean };

/** Excepción guardada: contrato más identificador, profesional y motivo. */
export type StoredAvailabilityException = AvailabilityException & {
  readonly id: string;
  readonly professionalId: string;
  readonly reason?: string;
};

/** Rango civil inclusivo para listar excepciones de un profesional. */
export interface AvailabilityExceptionRange {
  readonly professionalId: string;
  readonly from: string;
  readonly to: string;
}

/**
 * Lecturas de disponibilidad. Un identificador inexistente o de otra tabla
 * responde igual que uno sin datos. Las listas fallan con `conflict` cuando
 * superan su tope o el rango es inválido, en vez de devolver una lista
 * cortada. Lo cumple TI2-95; acá solo se fija la firma para los dobles.
 */
export interface AvailabilityReader {
  getBlock(blockId: string): Promise<StoredAvailabilityBlock | null>;
  listActiveBlocks(professionalId: string): Promise<ApiResult<readonly StoredAvailabilityBlock[]>>;
  getException(exceptionId: string): Promise<StoredAvailabilityException | null>;
  listExceptions(
    range: AvailabilityExceptionRange,
  ): Promise<ApiResult<readonly StoredAvailabilityException[]>>;
}

/**
 * Escrituras de disponibilidad. Validan integridad, no autorización: el
 * caso de uso llama antes a TI2-86. Responden `conflict` sin escribir
 * cuando una referencia no existe o lo guardado haría fallar la expansión
 * de TI2-81. Lo cumple TI2-95.
 */
export interface AvailabilityWriter {
  insertBlock(
    block: Omit<AvailabilityBlock, "id" | "version">,
  ): Promise<ApiResult<{ readonly blockId: string }>>;
  updateBlock(
    blockId: string,
    block: Omit<AvailabilityBlock, "id" | "professionalId" | "version">,
  ): Promise<ApiResult<null>>;
  setBlockActive(blockId: string, isActive: boolean): Promise<ApiResult<null>>;
  insertException(
    exception: Omit<StoredAvailabilityException, "id" | "version">,
  ): Promise<ApiResult<{ readonly exceptionId: string }>>;
  removeException(exceptionId: string): Promise<ApiResult<null>>;
}

/**
 * Necesidades vigentes del acompañamiento, resueltas por Infraestructura
 * desde el acompañamiento. `null` cuando el acompañamiento no existe.
 * Provisional: el acompañamiento persiste las necesidades como texto y su
 * resolución a identificadores la concreta TI2-95; acá solo se consumen
 * sin rebajarlas.
 */
export interface AccompanimentNeedsSource {
  getAccompanimentNeeds(accompanimentId: string): Promise<readonly AccessNeed[] | null>;
}

/**
 * Opción de compatibilidad de un cupo, resuelta desde el catálogo: el
 * espacio con vigencia y condiciones para lo presencial, los apoyos de la
 * plataforma para lo en línea. `null` cuando el espacio falta o se retiró.
 * Lo concreta TI2-95/TI2-99; la política es de TI2-82.
 */
export interface SlotCompatibilitySource {
  resolveCompatibilityOption(slot: AvailabilitySlot): Promise<CompatibilityOption | null>;
}

/** Intervalo ocupado en vocabulario TI2-87 (milisegundos epoch). */
export interface OccupiedInterval {
  readonly startAt: number;
  readonly endAt: number;
}

/**
 * Ocupación del profesional en el rango, en vocabulario TI2-87. Los cruces
 * completos los agrega TI2-96 sobre este mismo puerto. Lo cumple TI2-84.
 */
export interface SlotOccupancySource {
  listOccupiedIntervals(
    professionalId: string,
    from: string,
    to: string,
  ): Promise<readonly OccupiedInterval[]>;
}

function denied<T>(): ApiResult<T> {
  return errResult(unauthorizedError());
}

function conflict<T>(): ApiResult<T> {
  return errResult(conflictError());
}

function isValidTimeZone(timeZone: string): boolean {
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

/** Dependencias de la búsqueda, todas por puerto para probar con dobles. */
export interface SearchAvailabilityDeps {
  readonly auth: AuthorizationReader;
  readonly availability: AvailabilityReader;
  readonly needs: AccompanimentNeedsSource;
  readonly compatibility: SlotCompatibilitySource;
  readonly occupancy: SlotOccupancySource;
}

function overlaps(slot: AvailabilitySlot, interval: OccupiedInterval): boolean {
  return slot.startAt < interval.endAt && interval.startAt < slot.endAt;
}

/**
 * Consulta cupos compatibles para un acompañamiento activo.
 *
 * Autoriza con TI2-86 (acompañamiento activo con pertenencia o asignación
 * vigente; pausado, cerrado, revocado, practicante o administrador se
 * deniegan), expande con TI2-81, descuenta ocupación (TI2-84/TI2-96) y
 * filtra por compatibilidad con las necesidades vigentes sin rebajarlas
 * (TI2-82). Sin opción compatible y libre responde `no_availability`
 * (TI2-88) con la referencia mínima `accompanimentId` de la entrada, sin
 * crear reserva incompatible. Rango y página acotados: la consulta nunca
 * expone el calendario completo.
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

  const [blocksResult, exceptionsResult, needs] = await Promise.all([
    deps.availability.listActiveBlocks(input.professionalId),
    deps.availability.listExceptions({
      professionalId: input.professionalId,
      from: input.from,
      to: input.to,
    }),
    deps.needs.getAccompanimentNeeds(input.accompanimentId),
  ]);
  if (blocksResult.status === "error" || exceptionsResult.status === "error") {
    return conflict();
  }
  if (needs === null) return conflict();

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

  const occupied = await deps.occupancy.listOccupiedIntervals(
    input.professionalId,
    input.from,
    input.to,
  );
  const free = expanded.filter((slot) => !occupied.some((interval) => overlaps(slot, interval)));

  const compatible: AvailabilitySlot[] = [];
  for (const slot of free) {
    const option = await deps.compatibility.resolveCompatibilityOption(slot);
    if (option === null) continue;
    if (assessCompatibility(needs, option).compatible) compatible.push(slot);
  }

  let startIndex = 0;
  if (input.cursor !== undefined) {
    const found = compatible.findIndex((slot) => slot.id === input.cursor);
    startIndex = found === -1 ? 0 : found + 1;
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
