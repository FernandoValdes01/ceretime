import {
  CONFLICT_ERROR_CODE,
  NO_AVAILABILITY_ERROR_CODE,
  type Appointment,
  type AvailabilityBlock,
  type AvailabilityException,
  type AvailabilityExceptionKind,
  type AvailabilitySlot,
  type AvailabilityWindow,
  type PublicApiError,
  type Space,
} from "../../../../../convex/domain/index.ts";

/**
 * Contrato de capacidades de agenda del cliente Web (TI2-101, TI2-102,
 * TI2-103, TI2-04, TI2-113).
 *
 * Es únicamente el contrato para poder sustituir el adaptador ficticio por
 * la API real (TI2-123/TI2-125): deriva tipos compartidos y no implementa
 * reglas de disponibilidad, cruces ni autorización. TI2-102 extiende este
 * mismo archivo con la reserva, TI2-103 con bloques y excepciones, TI2-04
 * con espacios y TI2-113 completa los estados de conflicto de la reserva y
 * agrega la cancelación visible; no crear otro puerto por operación.
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

/**
 * Respuesta tipada de la reserva (TI2-102, estados completados TI2-113):
 * confirmación, conflicto reciente, falta de cupo, denegación y fallo
 * técnico son estados distintos y no se confunden. Conflicto y falta de
 * cupo llevan el código canónico del dominio compartido; la denegación
 * llega sin motivo y sin revelar existencia, y el resto conserva el error
 * público compartido. El comando de reserva sigue siendo único.
 */
export type ReserveSlotResult =
  | { readonly status: "confirmed"; readonly reservation: ReservationConfirmation }
  | { readonly status: "conflict"; readonly code: typeof CONFLICT_ERROR_CODE }
  | { readonly status: "no_availability"; readonly code: typeof NO_AVAILABILITY_ERROR_CODE }
  | { readonly status: "denied" }
  | { readonly status: "error"; readonly error: PublicApiError };

/**
 * Entrada de la cancelación visible (TI2-113): referencia opaca a la
 * reserva confirmada, devuelta por el comprobante. La UI nunca prueba
 * propiedad con ella: la autorización efectiva es del Backend cuando la
 * cancelación real esté entregada.
 */
export type CancelReservationInput = {
  readonly reservationId: string;
};

/**
 * Resultado tipado de la cancelación visible (TI2-113): `cancelled` es una
 * constancia declarada del adaptador vigente y no afirma una mutation real;
 * la denegación llega sin motivo y el resto conserva el error público
 * compartido. Nunca revela datos de terceros ni motivo interno.
 */
export type CancelReservationResult =
  | { readonly status: "cancelled" }
  | { readonly status: "denied" }
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

/**
 * Entrada del editor de espacios (TI2-04): campos del contrato del catálogo
 * sin identidad propia ni versión. El adaptador vigente asigna `id` y
 * `version`; el identificador opcional solo referencia qué espacio ficticio
 * se actualiza y nunca prueba propiedad ni autorización del cliente.
 */
export type SaveSpaceInput = Pick<
  Space,
  "campus" | "building" | "floor" | "room" | "accessConditions" | "arrivalInstructions"
> & {
  readonly id?: string;
};

/** Lectura simulada del catálogo de espacios visible al Administrador. */
export type ListSpacesResult =
  | { readonly status: "ok"; readonly spaces: ReadonlyArray<Space> }
  | { readonly status: "empty" }
  | { readonly status: "denied" }
  | { readonly status: "error"; readonly message: string };

/** Guardado simulado de un espacio: éxito tipado o error público compartido. */
export type SaveSpaceResult =
  | { readonly status: "saved"; readonly space: Space }
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
  cancelReservation(input: CancelReservationInput): Promise<CancelReservationResult>;
  listAvailability(): Promise<ListAvailabilityResult>;
  saveBlock(input: SaveBlockInput): Promise<SaveBlockResult>;
  saveException(input: SaveExceptionInput): Promise<SaveExceptionResult>;
  listSpaces(): Promise<ListSpacesResult>;
  saveSpace(input: SaveSpaceInput): Promise<SaveSpaceResult>;
}
