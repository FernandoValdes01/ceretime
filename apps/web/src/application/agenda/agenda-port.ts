import {
  NO_AVAILABILITY_ERROR_CODE,
  type Appointment,
  type AppointmentRejectionCause,
  type AppointmentStatus,
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
 * TI2-103, TI2-04, TI2-115).
 *
 * Es únicamente el contrato para poder sustituir el adaptador ficticio por
 * la API real (TI2-123/TI2-125): deriva tipos compartidos y no implementa
 * reglas de disponibilidad, cruces, transiciones ni autorización. TI2-102
 * extiende este mismo archivo con la reserva, TI2-103 con bloques y
 * excepciones, TI2-04 con espacios y TI2-115 con la agenda del Profesional;
 * no crear otro puerto por operación.
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

/**
 * Atención leída por la agenda del Profesional (TI2-115).
 *
 * Proyección mínima derivada del contrato de atención, sin duplicar su
 * forma: campos de agenda más los que la propia vista necesita (fecha
 * original conservada y motivo de cancelación propios). No trae identidad
 * del estudiante: el Backend decide qué datos de acompañamiento aparecen y
 * nunca se filtran necesidades de acceso de terceros ni notas internas.
 */
export type AgendaAppointment = Pick<
  Appointment,
  | "id"
  | "status"
  | "modality"
  | "startAt"
  | "endAt"
  | "spaceId"
  | "originalStartAt"
  | "cancelReason"
>;

/** Lista simulada de las atenciones del Profesional vigente. */
export type ListAppointmentsResult =
  | { readonly status: "ok"; readonly appointments: ReadonlyArray<AgendaAppointment> }
  | { readonly status: "empty" }
  | { readonly status: "denied" }
  | { readonly status: "error"; readonly message: string };

/** Lectura de una atención por identificador. Un id ajeno o desconocido es denegación genérica, sin filtrar existencia. */
export type AgendaAppointmentResult =
  | { readonly status: "ok"; readonly appointment: AgendaAppointment }
  | { readonly status: "denied" }
  | { readonly status: "error"; readonly message: string };

/**
 * Entrada del cambio de estado de una atención (TI2-115).
 *
 * El destino es un estado del contrato de dominio y la política de
 * transiciones vive ahí (`APPOINTMENT_TRANSITIONS`): este puerto no decide
 * transiciones ni autorización. El motivo viaja solo cuando el destino de
 * dominio lo exige (cancelación CERETI); el Backend lo exige de nuevo.
 */
export type ChangeAppointmentStatusInput = {
  readonly appointmentId: string;
  readonly to: AppointmentStatus;
  readonly reason?: string;
};

/**
 * Resultado del cambio de estado simulado.
 *
 * `rejected` trae la causa canónica del dominio
 * (`APPOINTMENT_REJECTION_CAUSES`), `denied` la denegación del Backend y
 * `error` el error público compartido.
 */
export type ChangeAppointmentStatusResult =
  | { readonly status: "changed"; readonly appointment: AgendaAppointment }
  | { readonly status: "rejected"; readonly cause: AppointmentRejectionCause }
  | { readonly status: "denied" }
  | { readonly status: "error"; readonly error: PublicApiError };

/** Capacidades de agenda que implementa el adaptador vigente. */
export interface AgendaPort {
  searchSlots(filter: { modality: SlotModalityFilter }): Promise<SlotSearchResult>;
  reserveSlot(input: ReserveSlotInput): Promise<ReserveSlotResult>;
  listAvailability(): Promise<ListAvailabilityResult>;
  saveBlock(input: SaveBlockInput): Promise<SaveBlockResult>;
  saveException(input: SaveExceptionInput): Promise<SaveExceptionResult>;
  listAppointments(): Promise<ListAppointmentsResult>;
  getAppointment(appointmentId: string): Promise<AgendaAppointmentResult>;
  changeAppointmentStatus(
    input: ChangeAppointmentStatusInput,
  ): Promise<ChangeAppointmentStatusResult>;
  listSpaces(): Promise<ListSpacesResult>;
  saveSpace(input: SaveSpaceInput): Promise<SaveSpaceResult>;
}
