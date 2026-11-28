import {
  AVAILABILITY_CONTRACT_VERSION,
  type AvailabilitySearchResult,
  type AvailabilitySlot,
  type SearchedAvailabilitySlot,
} from "../../domain/availability/availability";
import {
  civilWeekOf,
  compareSlotPositions,
  decodeSlotCursor,
  encodeSlotCursor,
  equivalentSlotKey,
  preferredSlotOrder,
  type SlotSearchPosition,
} from "../../domain/availability/accompaniment_slots";
import {
  decideNoCompatibleSlotReason,
  toOfficialChannelCoordination,
} from "../../domain/availability/official_channel";
import {
  conflictError,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import type { CompatibilityOption } from "../../domain/spaces/compatibility";
import { authorizeAvailabilityRead, type AuthorizationReader } from "../authorization/authorize";
import {
  classifySlotCompatibility,
  expandProfessionalSlots,
  findBookableProfessionalIds,
  isCandidateSlotOccupied,
  isValidSearchRange,
  isValidTimeZone,
  SEARCH_AVAILABILITY_PAGE_LIMIT_MAX,
  toSearchedSlot,
} from "./availability";
import type {
  AccompanimentNeedsReader,
  AvailabilityReader,
  BookableProfessionalSource,
  CompatibilitySpaceSource,
  ProfessionalLoadReader,
  SlotOccupancyReader,
} from "./ports";

/**
 * Búsqueda de horarios por acompañamiento (TI4-84, la parte de Convex de
 * TI4-70).
 *
 * Reúne en el servidor a los profesionales reservables del acompañamiento,
 * en vez de que el cliente pida todas las páginas de cada uno. Ordena los
 * cupos por inicio, agrupa los equivalentes y elige con la regla fija de
 * `preferredSlotOrder`, así Web y Mobile ofrecen lo mismo. La compatibilidad
 * se evalúa sobre toda la ventana, que es lectura de catálogo, pero la
 * ocupación se comprueba solo hasta llenar la página: la página siguiente
 * empieza en el cursor y no vuelve a comprobar la anterior.
 *
 * Un profesional cuya disponibilidad no se puede leer o expandir se omite, y
 * los demás siguen ofreciendo sus cupos. Solo si fallan todos responde
 * `conflict`. La autorización es la de `searchSlots` (TI2-86).
 */

/** Entrada de la búsqueda por acompañamiento. */
export interface SearchAccompanimentSlotsInput {
  readonly tokenIdentifier: string | null;
  readonly accompanimentId: string;
  readonly from: string;
  readonly to: string;
  readonly timeZone: string;
  readonly limit: number;
  readonly cursor?: string;
  readonly version: string;
}

/** Dependencias de la búsqueda por acompañamiento, todas por puerto. */
export interface SearchAccompanimentSlotsDeps {
  readonly auth: AuthorizationReader;
  readonly professionals: BookableProfessionalSource;
  readonly availability: AvailabilityReader;
  readonly needs: AccompanimentNeedsReader;
  readonly compatibility: CompatibilitySpaceSource;
  readonly occupancy: SlotOccupancyReader;
  readonly load: ProfessionalLoadReader;
}

/** Cupo compatible con su opción de catálogo, antes de comprobar la ocupación. */
type CompatibleCandidate = {
  readonly slot: AvailabilitySlot;
  readonly option: CompatibilityOption;
};

/** Cupos equivalentes de varios profesionales, en una misma posición. */
type SlotGroup = SlotSearchPosition & { readonly candidates: CompatibleCandidate[] };

function conflict<T>(): ApiResult<T> {
  return errResult(conflictError());
}

/**
 * Cupos compatibles y libres de los profesionales reservables de un
 * acompañamiento activo, agrupados y paginados (TI4-84).
 *
 * Responde la misma forma que `searchSlots`. Sin ningún cupo compatible y
 * libre en la primera página responde `no_compatible_slot`, con el motivo de
 * lo descartado entre todos los profesionales: si alguno tenía cupos
 * compatibles pero ocupados, `slots_occupied`; si solo hubo cupos que no
 * cubren las necesidades, `needs_not_met`; si no hay cupos publicados ni
 * profesionales reservables, `no_published_slots`. Tras el último cupo, la
 * página siguiente llega vacía. Un cursor que esta búsqueda no emitió
 * responde `conflict`.
 */
export async function searchAccompanimentSlots(
  deps: SearchAccompanimentSlotsDeps,
  input: SearchAccompanimentSlotsInput,
): Promise<ApiResult<AvailabilitySearchResult>> {
  if (input.version !== AVAILABILITY_CONTRACT_VERSION) return conflict();
  if (!Number.isInteger(input.limit) || input.limit < 1) return conflict();
  if (input.limit > SEARCH_AVAILABILITY_PAGE_LIMIT_MAX) return conflict();
  if (!isValidSearchRange(input.from, input.to)) return conflict();
  if (!isValidTimeZone(input.timeZone)) return conflict();
  if (input.accompanimentId.trim() === "") return conflict();
  const after = input.cursor === undefined ? null : decodeSlotCursor(input.cursor);
  if (input.cursor !== undefined && after === null) return conflict();

  // Misma autorización que `searchSlots`, incluido el bloqueo temporal de las
  // atenciones (TI2-168).
  const grant = await authorizeAvailabilityRead(deps.auth, {
    tokenIdentifier: input.tokenIdentifier,
    accompanimentId: input.accompanimentId,
    privacyCategory: "appointments",
  });
  if (grant.status === "error") return errResult(unauthorizedError());

  const professionalIds = await findBookableProfessionalIds(deps, input.accompanimentId);
  if (professionalIds === null) return conflict();
  const [needsEntry, onlineSupports, accompaniment] = await Promise.all([
    deps.needs.findAccompanimentNeeds(input.accompanimentId),
    deps.compatibility.listOnlineSupports(),
    deps.auth.getAccompaniment(input.accompanimentId),
  ]);
  if (needsEntry === null || accompaniment === null) return conflict();

  // Compatibilidad sobre toda la ventana: decide los grupos y el motivo de la
  // ausencia. La ocupación, más costosa, se comprueba después y solo lo justo.
  const groups = new Map<string, SlotGroup>();
  let incompatible = 0;
  let readable = 0;
  for (const professionalId of professionalIds) {
    const expanded = await expandProfessionalSlots(deps.availability, {
      professionalId,
      from: input.from,
      to: input.to,
      timeZone: input.timeZone,
    });
    if (expanded === null) continue;
    readable += 1;
    for (const slot of expanded) {
      const compatibility = await classifySlotCompatibility(
        deps.compatibility,
        { needs: needsEntry.needs, onlineSupports },
        slot,
      );
      if (compatibility.status === "unavailable") continue;
      if (compatibility.status === "incompatible") {
        if (compatibility.unmetNeeds) incompatible += 1;
        continue;
      }
      const key = equivalentSlotKey(slot);
      const group = groups.get(key) ?? { startAt: slot.startAt, key, candidates: [] };
      group.candidates.push({ slot, option: compatibility.option });
      groups.set(key, group);
    }
  }
  if (professionalIds.length > 0 && readable === 0) return conflict();

  const ordered = [...groups.values()]
    .filter((group) => after === null || compareSlotPositions(group, after) > 0)
    .sort(compareSlotPositions);

  const loads = new Map<string, number>();
  const weekLoad = async (professionalId: string, startAt: number) => {
    const week = civilWeekOf(startAt, input.timeZone);
    const cacheKey = `${professionalId}|${week.startAt}`;
    const cached = loads.get(cacheKey);
    if (cached !== undefined) return cached;
    const count = await deps.load.countProfessionalAppointments({ professionalId, ...week });
    loads.set(cacheKey, count);
    return count;
  };

  const items: {
    readonly position: SlotSearchPosition;
    readonly slot: SearchedAvailabilitySlot;
  }[] = [];
  let occupied = 0;
  for (const group of ordered) {
    if (items.length > input.limit) break;
    // La carga semanal solo decide entre varios profesionales del mismo grupo.
    const groupLoads = new Map<string, number>();
    if (group.candidates.length > 1) {
      for (const candidate of group.candidates) {
        const { professionalId } = candidate.slot;
        groupLoads.set(professionalId, await weekLoad(professionalId, group.startAt));
      }
    }
    const preferred = preferredSlotOrder(
      group.candidates.map((candidate) => ({
        ...candidate,
        professionalId: candidate.slot.professionalId,
      })),
      (professionalId) => groupLoads.get(professionalId) ?? 0,
    );
    for (const { slot, option } of preferred) {
      if (await isCandidateSlotOccupied(deps.occupancy, slot, accompaniment.studentId)) {
        occupied += 1;
        continue;
      }
      items.push({
        position: { startAt: group.startAt, key: group.key },
        slot: toSearchedSlot(slot, option),
      });
      break;
    }
  }

  if (items.length === 0 && after === null) {
    return okResult({
      status: "no_compatible_slot",
      coordination: toOfficialChannelCoordination(
        input.accompanimentId,
        decideNoCompatibleSlotReason({ occupied, incompatible }),
      ),
      version: AVAILABILITY_CONTRACT_VERSION,
    });
  }
  const page = items.slice(0, input.limit);
  const hasMore = items.length > page.length;
  const last = page[page.length - 1];
  return okResult({
    status: "available",
    items: page.map((item) => item.slot),
    hasMore,
    nextCursor: hasMore && last !== undefined ? encodeSlotCursor(last.position) : null,
    version: AVAILABILITY_CONTRACT_VERSION,
  });
}
