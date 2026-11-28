import {
  addCivilDays,
  civilDateOfInstant,
  civilWeekday,
  midnightToEpochMs,
} from "../calendar/civil_days";
import type { AvailabilitySlot } from "./availability";

/**
 * Búsqueda de horarios por acompañamiento (TI4-84, TI4-70).
 *
 * Dominio puro. El Estudiante reserva una hora, no elige profesional: los
 * cupos equivalentes de varios profesionales (misma hora de inicio y de
 * término, modalidad y sala) se muestran una sola vez, y el servidor elige con
 * una regla fija, para que Web y Mobile ofrezcan lo mismo: el profesional con
 * menos atenciones esa semana y, si empatan, el de menor identificador.
 */

/** Clave de los cupos equivalentes: misma hora de inicio y término, modalidad y sala. */
export function equivalentSlotKey(
  slot: Pick<AvailabilitySlot, "startAt" | "endAt" | "modality" | "spaceId">,
): string {
  return JSON.stringify([slot.startAt, slot.endAt, slot.modality, slot.spaceId ?? null]);
}

/** Posición estable de la búsqueda: el inicio y la clave del último grupo entregado. */
export type SlotSearchPosition = { readonly startAt: number; readonly key: string };

/** Orden de los grupos: por inicio y, dentro del mismo inicio, por clave. */
export function compareSlotPositions(a: SlotSearchPosition, b: SlotSearchPosition): number {
  if (a.startAt !== b.startAt) return a.startAt - b.startAt;
  if (a.key === b.key) return 0;
  return a.key < b.key ? -1 : 1;
}

/**
 * Cursor opaco con la posición del último grupo entregado. No depende de que
 * ese cupo siga libre: la página siguiente empieza en el primer grupo
 * posterior, aunque el último se haya ocupado entre consultas.
 */
export function encodeSlotCursor(position: SlotSearchPosition): string {
  return JSON.stringify({ v: 1, startAt: position.startAt, key: position.key });
}

/** Lee el cursor, o `null` si no lo emitió esta búsqueda. */
export function decodeSlotCursor(cursor: string): SlotSearchPosition | null {
  try {
    const parsed: unknown = JSON.parse(cursor);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (record.v !== 1) return null;
    if (typeof record.startAt !== "number" || !Number.isFinite(record.startAt)) return null;
    if (typeof record.key !== "string") return null;
    return { startAt: record.startAt, key: record.key };
  } catch {
    return null;
  }
}

/** Semana civil, de lunes a lunes, que contiene el instante en la zona dada. */
export function civilWeekOf(
  epochMs: number,
  timeZone: string,
): { readonly startAt: number; readonly endAt: number } {
  const date = civilDateOfInstant(epochMs, timeZone);
  const monday = addCivilDays(date, -((civilWeekday(date) + 6) % 7));
  return {
    startAt: midnightToEpochMs(monday, timeZone),
    endAt: midnightToEpochMs(addCivilDays(monday, 7), timeZone),
  };
}

/**
 * Profesionales de un grupo en el orden en que se ofrecen: menos atenciones
 * esa semana y, si empatan, menor identificador. El orden no depende de cómo
 * llegaron los candidatos.
 */
export function preferredSlotOrder<Slot extends Pick<AvailabilitySlot, "professionalId">>(
  candidates: readonly Slot[],
  weekLoad: (professionalId: string) => number,
): Slot[] {
  return [...candidates].sort((a, b) => {
    const load = weekLoad(a.professionalId) - weekLoad(b.professionalId);
    if (load !== 0) return load;
    if (a.professionalId === b.professionalId) return 0;
    return a.professionalId < b.professionalId ? -1 : 1;
  });
}
