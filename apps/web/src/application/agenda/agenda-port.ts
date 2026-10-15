import {
  NO_AVAILABILITY_ERROR_CODE,
  type Appointment,
  type AvailabilityBlock,
  type AvailabilityException,
  type AvailabilityExceptionKind,
  type AvailabilitySlot,
  type AvailabilityWindow,
  type PublicApiError,
} from "../../../../../convex/domain/index.ts";

/**
 * Contrato de capacidades de agenda del cliente Web (TI2-101, TI2-102, TI2-103).
 *
 * Es únicamente el contrato para poder sustituir el adaptador ficticio por
 * la API real (TI2-123/TI2-125): deriva tipos compartidos y no implementa
 * reglas de disponibilidad, cruces ni autorización. TI2-102 extiende este
 * mismo archivo con la reserva y TI2-103 con bloques y excepciones; no crear
 * otro puerto por operación.
 */

/** Filtro de modalidad de la búsqueda; `all` es solo vista del cliente. */
export const SLOT_MODALITY_FILTER_VALUES = ["all", "inPerson", "online"] as const;

export type SlotModalityFilter = (typeof SLOT_MODALITY_FILTER_VALUES)[number];

/** Cupo consultable: subconjunto visible de `AvailabilitySlot` más etiqueta. */
export type AgendaSlot = Pick<
  AvailabilitySlot,
  "id" | "professionalId" | "date" | "startAt" | "endAt" | "modality"
> & {
  /** Resumen legible del espacio; ausente en modalidad en línea. */
  readonly spaceLabel?: string;
};

/** Respuesta tipada de la búsqueda: vacío y falta de cupo son distintos. */
export type SlotSearchResult =
  | { readonly status: "ok"; readonly slots: ReadonlyArray<AgendaSlot> }
  | { readonly status: "empty" }
  | {
      readonly status: "no_availability";
      readonly code: typeof NO_AVAILABILITY_ERROR_CODE;
    }
  | { readonly status: "error"; readonly message: string };

/** Selección que el formulario de reserva consume (TI2-102). */
export type AgendaSlotSelection = {
  readonly slotId: string;
};

/**
 * Entrada única del comando de reserva (TI2-102). Definida una sola vez
 * para búsqueda y formulario: no duplicar este comando.
 */
export type ReserveSlotInput = {
  readonly slotId: string;
};

/** Confirmación de reserva: proyección necesaria de `Appointment`. */
export type ReservationConfirmation = Pick<
  Appointment,
  "id" | "slotId" | "professionalId" | "modality" | "startAt" | "endAt"
>;

/** Respuesta tipada de la reserva: usa el error público compartido. */
export type ReserveSlotResult =
  | { readonly status: "confirmed"; readonly reservation: ReservationConfirmation }
  | { readonly status: "error"; readonly error: PublicApiError };

/**
 * Entrada del editor de bloques (TI2-103): forma tipada sin identidad ni
 * propiedad. El profesional dueño lo asigna el Backend; la interfaz nunca
 * envía `professionalId` como prueba de propiedad ni decide permisos de otro
 * profesional. `version` la fija el adaptador con el contrato vigente.
 */
export type SaveBlockInput = Pick<
  AvailabilityBlock,
  "weekday" | "startMinute" | "endMinute" | "slotMinutes" | "modality"
> & {
  readonly spaceId?: string;
};

/**
 * Entrada del editor de excepciones (TI2-103): fecha civil y clase con su
 * ventana propia cuando es agregado. Sin identidad de profesional por el
 * mismo motivo que los bloques.
 */
export type SaveExceptionInput = Pick<AvailabilityException, "date" | "kind"> & {
  readonly blockId?: string;
  readonly windows?: ReadonlyArray<AvailabilityWindow>;
};

/** Lectura simulada del editor: bloques y excepciones del profesional vigente. */
export type ListAvailabilityResult =
  | {
      readonly status: "ok";
      readonly blocks: ReadonlyArray<AvailabilityBlock>;
      readonly exceptions: ReadonlyArray<AvailabilityException>;
    }
  | { readonly status: "empty" }
  | { readonly status: "denied" }
  | { readonly status: "error"; readonly message: string };

/** Guardado simulado de un bloque: éxito tipado o error público compartido. */
export type SaveBlockResult =
  | { readonly status: "saved"; readonly block: AvailabilityBlock }
  | { readonly status: "denied" }
  | { readonly status: "error"; readonly error: PublicApiError };

/** Guardado simulado de una excepción: éxito tipado o error público compartido. */
export type SaveExceptionResult =
  | { readonly status: "saved"; readonly exception: AvailabilityException }
  | { readonly status: "denied" }
  | { readonly status: "error"; readonly error: PublicApiError };

/** Ventana del editor derivada del contrato, sin duplicar su forma. */
export type EditorWindow = AvailabilityWindow;

/** Clase de excepción derivada del contrato, sin duplicar literales. */
export type EditorExceptionKind = AvailabilityExceptionKind;

/** Capacidades de agenda que implementa el adaptador vigente. */
export interface AgendaPort {
  searchSlots(filter: { modality: SlotModalityFilter }): Promise<SlotSearchResult>;
  reserveSlot(input: ReserveSlotInput): Promise<ReserveSlotResult>;
  listAvailability(): Promise<ListAvailabilityResult>;
  saveBlock(input: SaveBlockInput): Promise<SaveBlockResult>;
  saveException(input: SaveExceptionInput): Promise<SaveExceptionResult>;
}
