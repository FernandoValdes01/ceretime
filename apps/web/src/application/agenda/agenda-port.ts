import {
  NO_AVAILABILITY_ERROR_CODE,
  type AvailabilitySlot,
} from "../../../../../convex/domain/index.ts";

/**
 * Contrato de capacidades de agenda del cliente Web (TI2-101).
 *
 * Es únicamente el contrato para poder sustituir el adaptador ficticio por
 * la API real (TI2-123): deriva tipos compartidos y no implementa reglas de
 * disponibilidad, cruces ni autorización. TI2-102 extiende este mismo
 * archivo con la reserva; no crear otro puerto por operación.
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

/** Selección que TI2-102 consume para el formulario de reserva. */
export type AgendaSlotSelection = {
  readonly slotId: string;
};

/** Capacidades de agenda que implementa el adaptador vigente. */
export interface AgendaPort {
  searchSlots(filter: { modality: SlotModalityFilter }): Promise<SlotSearchResult>;
}
