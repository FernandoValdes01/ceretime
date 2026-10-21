import {
  AVAILABILITY_CONTRACT_VERSION,
  NO_AVAILABILITY_ERROR_CODE,
  SPACE_CATALOG_CONTRACT_VERSION,
  toSpaceLabel,
  type AvailabilityBlock,
  type AvailabilityException,
  type Space,
} from "../../../../../convex/domain/index.ts";
import {
  type AgendaPort,
  type AgendaSlot,
  type ListAvailabilityResult,
  type ReserveSlotInput,
  type ReserveSlotResult,
  type SaveBlockInput,
  type SaveBlockResult,
  type SaveExceptionInput,
  type SaveExceptionResult,
  type SlotModalityFilter,
  type SlotSearchResult,
} from "../../application/agenda/agenda-port.ts";

/**
 * Adaptador ficticio de agenda (TI2-101, extendido TI2-102 y TI2-103).
 *
 * Temporal hasta TI2-123/TI2-125: devuelve fixtures con la forma del
 * contrato, sin reglas de compatibilidad, cruces, autorización ni
 * persistencia. Todo es inventado y se declara como tal en la interfaz.
 *
 * Reglas ficticias documentadas: no hay cupos en línea publicados, así que
 * filtrar por esa modalidad responde `no_availability` (código canónico);
 * el resto filtra las filas por modalidad y responde `empty` sin filas. La
 * reserva confirma los cupos publicados y responde falta de cupo ante un id
 * ajeno. La lectura del editor trae dos bloques y tres excepciones ficticios
 * (cancelación del día, cancelación de un bloque y agregado con ventana);
 * el guardado asigna identidad ficticia sin validar propiedad.
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

const FICTIONAL_PROFESSIONAL_ID = "pro-ficticio-1";

const FICTIONAL_SPACES: Record<string, Space> = {
  "esp-1": {
    id: "esp-1",
    campus: "Campus Norte",
    building: "Edificio A",
    floor: "Piso 1",
    room: "Sala 101",
    accessConditions: "Acceso sin escaleras por rampa lateral.",
    arrivalInstructions:
      "Entrar por el acceso norte y seguir la señalización táctil hasta la sala.",
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
    professionalId: FICTIONAL_PROFESSIONAL_ID,
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

const FICTIONAL_BLOCKS: ReadonlyArray<AvailabilityBlock> = [
  {
    id: "bloque-ficticio-1",
    professionalId: FICTIONAL_PROFESSIONAL_ID,
    weekday: 1,
    startMinute: 540,
    endMinute: 720,
    slotMinutes: 60,
    modality: "inPerson",
    spaceId: "esp-1",
    version: AVAILABILITY_CONTRACT_VERSION,
  },
  {
    id: "bloque-ficticio-2",
    professionalId: FICTIONAL_PROFESSIONAL_ID,
    weekday: 3,
    startMinute: 840,
    endMinute: 960,
    slotMinutes: 30,
    modality: "online",
    version: AVAILABILITY_CONTRACT_VERSION,
  },
];

const FICTIONAL_EXCEPTIONS: ReadonlyArray<AvailabilityException> = [
  {
    date: dateKey(4),
    kind: "cancelled",
    version: AVAILABILITY_CONTRACT_VERSION,
  },
  {
    date: dateKey(5),
    kind: "cancelled",
    blockId: "bloque-ficticio-1",
    version: AVAILABILITY_CONTRACT_VERSION,
  },
  {
    date: dateKey(6),
    kind: "added",
    windows: [
      {
        startMinute: 600,
        endMinute: 660,
        slotMinutes: 30,
        modality: "inPerson",
        spaceId: "esp-2",
      },
    ],
    version: AVAILABILITY_CONTRACT_VERSION,
  },
];

export function createFictitiousAgendaAdapter(): AgendaPort {
  let blockCounter = FICTIONAL_BLOCKS.length;
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
      const found = FICTIONAL_SLOTS.find((item) => item.id === input.slotId);
      if (found === undefined) {
        return {
          status: "error",
          error: { code: NO_AVAILABILITY_ERROR_CODE, message: "El cupo ya no está disponible." },
        };
      }
      return {
        status: "confirmed",
        reservation: {
          id: `reserva-ficticia-${found.id}`,
          slotId: found.id,
          professionalId: found.professionalId,
          modality: found.modality,
          startAt: found.startAt,
          endAt: found.endAt,
        },
      };
    },
    async listAvailability(): Promise<ListAvailabilityResult> {
      return { status: "ok", blocks: FICTIONAL_BLOCKS, exceptions: FICTIONAL_EXCEPTIONS };
    },
    async saveBlock(input: SaveBlockInput): Promise<SaveBlockResult> {
      blockCounter += 1;
      const block: AvailabilityBlock = {
        id: `bloque-ficticio-${blockCounter}`,
        professionalId: FICTIONAL_PROFESSIONAL_ID,
        weekday: input.weekday,
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        slotMinutes: input.slotMinutes,
        modality: input.modality,
        ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
        version: AVAILABILITY_CONTRACT_VERSION,
      };
      return { status: "saved", block };
    },
    async saveException(input: SaveExceptionInput): Promise<SaveExceptionResult> {
      return {
        status: "saved",
        exception: {
          date: input.date,
          kind: input.kind,
          ...(input.blockId === undefined ? {} : { blockId: input.blockId }),
          ...(input.windows === undefined ? {} : { windows: input.windows }),
          version: AVAILABILITY_CONTRACT_VERSION,
        },
      };
    },
  };
}
