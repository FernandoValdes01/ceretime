import {
  CONFLICT_ERROR_CODE,
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
 * TI2-103, TI2-04, TI2-113, TI2-115).
 *
 * Es únicamente el contrato para poder sustituir el adaptador ficticio por
 * la API real (TI2-123/TI2-125): deriva tipos compartidos y no implementa
 * reglas de disponibilidad, cruces, transiciones ni autorización. TI2-102
 * extiende este mismo archivo con la reserva, TI2-103 con bloques y
 * excepciones, TI2-04 con espacios, TI2-113 completa los desenlaces de la
 * reserva y agrega la cancelación visible, y TI2-115 con la agenda del
 * Profesional; no crear otro puerto por operación. La vista propia del Estudiante (TI2-114) reutiliza
 * `listAppointments`/`getAppointment` sin capacidades nuevas: el rol queda
 * resuelto por el Backend.
 */

/** Filtro de modalidad de la búsqueda; `all` es solo vista del cliente. */
export const SLOT_MODALITY_FILTER_VALUES = ["all", "inPerson", "online"] as const;

export type SlotModalityFilter = (typeof SLOT_MODALITY_FILTER_VALUES)[number];

/** Cupo consultable: subconjunto visible de `AvailabilitySlot` más etiqueta. */
export type AgendaSlot = Pick<
  AvailabilitySlot,
  "id" | "professionalId" | "date" | "startAt" | "endAt" | "modality"
> & {
  /** Referencia opaca del espacio: la reserva la reenvía, la UI no la imprime. */
  readonly spaceId?: string;
  /** Resumen legible del espacio; ausente en modalidad en línea. */
  readonly spaceLabel?: string;
};

/**
 * Contexto que exige la API real para buscar (TI2-123). Es opcional porque el
 * adaptador ficticio no lo usa; el adaptador Convex responde error sin él. La
 * autorización de ambos identificadores es del Backend.
 */
export type SlotSearchContext = {
  readonly accompanimentId: string;
  readonly professionalIds: ReadonlyArray<string>;
};

/**
 * Profesionales con quienes reservar en un acompañamiento (TI2-123). `none`
 * indica que no hay ninguno reservable: no se inventa uno.
 */
export type BookingProfessionalsResult =
  | { readonly status: "ok"; readonly professionalIds: ReadonlyArray<string> }
  | { readonly status: "none" }
  | { readonly status: "denied" }
  | { readonly status: "error"; readonly message: string };

/** Filtro de la búsqueda de cupos. */
export type SlotSearchFilter = {
  readonly modality: SlotModalityFilter;
  readonly context?: SlotSearchContext;
};

/**
 * Respuesta tipada de la búsqueda: vacío, falta de cupo y denegación son
 * distintos. La denegación llega sin motivo y sin revelar existencia.
 */
export type SlotSearchResult =
  | { readonly status: "ok"; readonly slots: ReadonlyArray<AgendaSlot> }
  | { readonly status: "empty" }
  | {
      readonly status: "no_availability";
      readonly code: typeof NO_AVAILABILITY_ERROR_CODE;
    }
  | { readonly status: "denied" }
  | { readonly status: "error"; readonly message: string };

/** Selección que el formulario de reserva consume (TI2-102). */
export type AgendaSlotSelection = {
  readonly slotId: string;
};

/**
 * Entrada única del comando de reserva (TI2-102). Definida una sola vez
 * para búsqueda y formulario: no duplicar este comando. `booking` lleva lo que
 * exige la API real (TI2-123): el cupo elegido en la búsqueda y su
 * acompañamiento; el adaptador Convex responde error sin él.
 */
export type ReserveSlotInput = {
  readonly slotId: string;
  readonly booking?: {
    readonly accompanimentId: string;
    readonly slot: AgendaSlot;
  };
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
 * propiedad con ella: la autorización efectiva es del Backend.
 */
export type CancelReservationInput = {
  readonly reservationId: string;
};

/**
 * Resultado tipado de la cancelación visible (TI2-113): la denegación llega sin motivo y el resto conserva el error público
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

/** Lectura del editor: bloques y excepciones del profesional vigente. */
export type ListAvailabilityResult =
  | {
      readonly status: "ok";
      readonly blocks: ReadonlyArray<AvailabilityBlock>;
      readonly exceptions: ReadonlyArray<AvailabilityException>;
    }
  | { readonly status: "empty" }
  | { readonly status: "denied" }
  | { readonly status: "error"; readonly message: string };

/** Guardado de un bloque: éxito tipado o error público compartido. */
export type SaveBlockResult =
  | { readonly status: "saved"; readonly block: AvailabilityBlock }
  | { readonly status: "denied" }
  | { readonly status: "error"; readonly error: PublicApiError };

/** Guardado de una excepción: éxito tipado o error público compartido. */
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

/**
 * Lectura simulada del catálogo de espacios: la edita el Administrador y la
 * lee cualquier cuenta vigente (`space:read`), como la agenda del Profesional.
 */
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
 * Atención leída por la agenda del Profesional (TI2-115); la misma lectura
 * sirve la vista propia del Estudiante (TI2-114).
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

/** Lista de las atenciones propias del rol vigente (Profesional en TI2-115, Estudiante en TI2-114); el Backend resuelve el rol. */
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
 * Resultado del cambio de estado.
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

/** Cancela una suscripción reactiva del puerto. */
export type AgendaUnsubscribe = () => void;

/** Capacidades de agenda que implementa el adaptador vigente. */
export interface AgendaPort {
  findBookingProfessionals(accompanimentId: string): Promise<BookingProfessionalsResult>;
  searchSlots(filter: SlotSearchFilter): Promise<SlotSearchResult>;
  reserveSlot(input: ReserveSlotInput): Promise<ReserveSlotResult>;
  cancelReservation(input: CancelReservationInput): Promise<CancelReservationResult>;
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
  /**
   * Suscripción opcional a la agenda. La implementa la API real para reflejar
   * cambios sin recargar la vista; el adaptador ficticio puede omitirla y las
   * páginas caen a la lectura puntual.
   */
  watchAppointments?(onChange: (result: ListAppointmentsResult) => void): AgendaUnsubscribe;
  /** Suscripción opcional al detalle de una atención. */
  watchAppointment?(
    appointmentId: string,
    onChange: (result: AgendaAppointmentResult) => void,
  ): AgendaUnsubscribe;
}
