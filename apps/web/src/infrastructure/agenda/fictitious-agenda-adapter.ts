import {
  NO_AVAILABILITY_ERROR_CODE,
  SPACE_CATALOG_CONTRACT_VERSION,
  toSpaceLabel,
  type Space,
} from "../../../../../convex/domain/index.ts";
import {
  type AgendaPort,
  type AgendaSlot,
  type ReserveSlotInput,
  type ReserveSlotResult,
  type SlotModalityFilter,
  type SlotSearchResult,
} from "../../application/agenda/agenda-port.ts";

/**
 * Adaptador ficticio de agenda (TI2-101).
 *
 * Temporal hasta TI2-123: devuelve fixtures con la forma del contrato, sin
 * reglas de compatibilidad ni persistencia. Todo es inventado. Regla
 * ficticia documentada: no hay cupos en línea publicados, así que filtrar
 * por esa modalidad responde `no_availability` (código canónico); el resto
 * filtra las filas por modalidad y responde `empty` sin filas.
 */

function midnightPlus(days: number): number {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function atDayHour(days: number, hour: number, minutes: number): number {
  return midnightPlus(days) + (hour * 60 + minutes) * 60_000;
}

function dateKey(days: number): string {
  const date = new Date(midnightPlus(days));
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const FICTIONAL_SPACES: Record<string, Space> = {
  "esp-1": {
    id: "esp-1",
    campus: "Campus Norte",
    building: "Edificio A",
    floor: "Piso 1",
    room: "Sala 101",
    accessConditions: "Acceso sin escaleras por rampa lateral.",
    arrivalInstructions:
      "Entrar por el acceso norte y seguir la señalización podotáctil hasta la sala.",
    version: SPACE_CATALOG_CONTRACT_VERSION,
  },
  "esp-2": {
    id: "esp-2",
    campus: "Campus Norte",
    building: "Edificio B",
    floor: "Piso 2",
    room: "Sala 205",
    accessConditions: "Ascensor disponible junto al acceso principal.",
    arrivalInstructions: "Subir al segundo piso y girar a la derecha al salir del ascensor.",
    version: SPACE_CATALOG_CONTRACT_VERSION,
  },
};

function slot(
  id: string,
  days: number,
  startHour: number,
  startMinute: number,
  durationMinutes: number,
  modality: "inPerson" | "online",
  spaceId?: string,
): AgendaSlot {
  const startAt = atDayHour(days, startHour, startMinute);
  return {
    id,
    professionalId: "pro-ficticio-1",
    date: dateKey(days),
    startAt,
    endAt: startAt + durationMinutes * 60_000,
    modality,
    ...(spaceId === undefined ? {} : { spaceLabel: toSpaceLabel(FICTIONAL_SPACES[spaceId]) }),
  };
}

const FICTIONAL_SLOTS: ReadonlyArray<AgendaSlot> = [
  slot("cupo-1", 2, 10, 0, 60, "inPerson", "esp-1"),
  slot("cupo-2", 3, 15, 0, 60, "inPerson", "esp-2"),
];

export function createFictitiousAgendaAdapter(): AgendaPort {
  return {
    async searchSlots(filter: { modality: SlotModalityFilter }): Promise<SlotSearchResult> {
      if (filter.modality === "online") {
        return { status: "no_availability", code: NO_AVAILABILITY_ERROR_CODE };
      }
      const slots =
        filter.modality === "all"
          ? FICTIONAL_SLOTS
          : FICTIONAL_SLOTS.filter((item) => item.modality === filter.modality);
      if (slots.length === 0) {
        return { status: "empty" };
      }
      return { status: "ok", slots };
    },
    // Reserva simulada (TI2-102): confirma los cupos publicados con la
    // proyección del contrato; un id ajeno responde falta de cupo con el
    // código canónico. El fallo técnico se prueba con rechazo y llegará con
    // la API real.
    async reserveSlot(input: ReserveSlotInput): Promise<ReserveSlotResult> {
      const slot = FICTIONAL_SLOTS.find((item) => item.id === input.slotId);
      if (slot === undefined) {
        return {
          status: "error",
          error: { code: NO_AVAILABILITY_ERROR_CODE, message: "El cupo ya no está disponible." },
        };
      }
      return {
        status: "confirmed",
        reservation: {
          id: `reserva-ficticia-${slot.id}`,
          slotId: slot.id,
          professionalId: slot.professionalId,
          modality: slot.modality,
          startAt: slot.startAt,
          endAt: slot.endAt,
        },
      };
    },
  };
}
