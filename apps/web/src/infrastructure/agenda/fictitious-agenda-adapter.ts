import {
  AVAILABILITY_CONTRACT_VERSION,
  CONFLICT_ERROR_CODE,
  NO_AVAILABILITY_ERROR_CODE,
  SPACE_CATALOG_CONTRACT_VERSION,
  toSpaceLabel,
  transitionAppointment,
  type AvailabilityBlock,
  type AvailabilityException,
  type Space,
} from "../../../../../convex/domain/index.ts";
import {
  type AgendaAppointment,
  type AgendaAppointmentResult,
  type AgendaPort,
  type AgendaSlot,
  type BookingProfessionalsResult,
  type CancelReservationInput,
  type CancelReservationResult,
  type ChangeAppointmentStatusInput,
  type ChangeAppointmentStatusResult,
  type ListAppointmentsResult,
  type ListAvailabilityResult,
  type ListSpacesResult,
  type ReserveSlotInput,
  type ReserveSlotResult,
  type SaveBlockInput,
  type SaveBlockResult,
  type SaveExceptionInput,
  type SaveExceptionResult,
  type SaveSpaceInput,
  type SaveSpaceResult,
  type SlotModalityFilter,
  type SlotSearchResult,
} from "../../application/agenda/agenda-port.ts";

/**
 * Adaptador ficticio de agenda (TI2-101, extendido TI2-102, TI2-103, TI2-04,
 * TI2-113, TI2-115 y TI2-114).
 *
 * Temporal hasta TI2-123/TI2-125: devuelve fixtures con la forma del
 * contrato, sin compatibilidad, persistencia ni autorización. Todo es
 * inventado y se declara como tal en la interfaz.
 *
 * Reglas ficticias documentadas: no hay cupos en línea publicados, así que
 * filtrar por esa modalidad responde `no_availability` (código canónico);
 * el resto filtra las filas por modalidad y responde `empty` sin filas. La
 * reserva confirma los cupos publicados y responde falta de cupo tipada
 * ante un id ajeno; el cupo con toma reciente responde conflicto tipado con
 * el código canónico (escenario de respuesta declarado, no un motor de
 * ocupación ni de transición). La lectura del editor trae dos bloques y
 * tres excepciones ficticios (cancelación del día, cancelación de un
 * bloque y agregado con ventana); el guardado asigna identidad ficticia
 * sin validar propiedad.
 *
 * La cancelación visible (TI2-113) es un escenario tipado del adaptador: la
 * reserva ficticia entregada por la propia confirmación responde
 * `cancelled` y un identificador ajeno responde denegación sin revelar
 * existencia. No aplica mutation real ni persiste nada. La API de cancelación
 * ya existe en `convex/presentation/appointments.ts` (`cancelAppointment`,
 * TI2-121): lo pendiente es conectar esta interfaz Web al endpoint
 * (TI2-123/TI2-125), trabajo fuera del alcance de TI2-113.
 *
 * El catálogo de espacios (TI2-04) es ficticio y en memoria: la lectura
 * devuelve los espacios con su contrato v1 y el guardado actualiza un
 * espacio conocido o crea uno nuevo con identidad ficticia, sin validar
 * propiedad ni persistir nada. La escritura real del catálogo no está
 * entregada: TI2-99 entrega lectura, no escritura.
 *
 * Agenda del Profesional (TI2-115): nueve atenciones ficticias del mismo
 * profesional con estados variados del contrato. El cambio de estado no
 * agrega política local: valida con `transitionAppointment` del dominio (la
 * misma función que usará el Backend) y solo simula identidad y reloj.
 * La misma lectura sirve la demostración de la lista propia del Estudiante
 * (TI2-114), sin resolver rol en el cliente: cuando la conexión real llegue
 * (TI2-123), el Backend responde solo las atenciones del rol vigente. Un
 * identificador ajeno responde denegación genérica sin filtrar
 * existencia. Los cambios viven en memoria mientras dura el adaptador, sin
 * persistencia productiva.
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

/** Espacios vigentes del catálogo ficticio: el guardado simulado los actualiza. */
const fictionalSpaces: Record<string, Space> = { ...FICTIONAL_SPACES };

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
    ...(spaceId === undefined ? {} : { spaceLabel: toSpaceLabel(fictionalSpaces[spaceId]) }),
  };
}

const FICTIONAL_SLOTS: ReadonlyArray<AgendaSlot> = [
  slot("cupo-1", 2, 10, 0, 60, "inPerson", "esp-1"),
  slot("cupo-2", 3, 15, 0, 60, "inPerson", "esp-2"),
  // Escenario de conflicto (TI2-113): cupo publicado con una toma reciente;
  // la búsqueda lo lista y al reservarlo responde conflicto.
  slot("cupo-3", 2, 12, 0, 60, "inPerson", "esp-2"),
];

/**
 * Escenario de respuesta declarado (TI2-113): el cupo reservado que responde
 * conflicto con el código canónico, sin revelar quién tomó el slot ni
 * cuándo. Es una respuesta fija, no un motor de ocupación ni de transición.
 */
const FICTIONAL_CONFLICTING_SLOT_IDS: ReadonlyArray<string> = ["cupo-3"];

/**
 * Prefijo de la reserva ficticia que entrega la propia confirmación
 * (TI2-113): cancelar un identificador con este prefijo responde
 * `cancelled` y cualquier identificador ajeno responde denegación, también
 * sin revelar existencia.
 */
const FICTIONAL_RESERVATION_PREFIX = "reserva-ficticia-";

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

/** Instante relativo al reloj ficticio: `hours` puede ser negativo (pasado). */
function fromNow(hours: number): number {
  return Date.now() + hours * 3_600_000;
}

/**
 * Atenciones ficticias de la agenda (TI2-115 y TI2-114).
 *
 * Todos con el mismo profesional ficticio: la página no expone
 * acompañamientos de otros profesionales. Estados variados del contrato
 * para mostrar agenda y cambios: una programada futura, una programada ya
 * ocurrida (admite cierre), una reagendada con su fecha original, una
 * realizada, inasistencias en los tres desenlaces de justificación
 * (pendiente, justificada y no justificada), una cancelación por CERETI
 * con motivo propio y una cancelación por el Estudiante. La misma lista
 * sirve la demostración de la vista propia del Estudiante (TI2-114).
 */
const FICTIONAL_APPOINTMENTS: ReadonlyArray<AgendaAppointment> = [
  {
    id: "aten-ficticio-1",
    status: "scheduled",
    modality: "inPerson",
    spaceId: "esp-1",
    startAt: fromNow(24),
    endAt: fromNow(25),
  },
  {
    id: "aten-ficticio-2",
    status: "scheduled",
    modality: "inPerson",
    spaceId: "esp-2",
    startAt: fromNow(-26),
    endAt: fromNow(-25),
  },
  {
    id: "aten-ficticio-3",
    status: "rescheduled",
    modality: "online",
    startAt: fromNow(48),
    endAt: fromNow(49),
    originalStartAt: fromNow(4),
  },
  {
    id: "aten-ficticio-4",
    status: "completed",
    modality: "inPerson",
    spaceId: "esp-1",
    startAt: fromNow(-50),
    endAt: fromNow(-49),
  },
  {
    id: "aten-ficticio-5",
    status: "no_show",
    modality: "inPerson",
    spaceId: "esp-2",
    startAt: fromNow(-74),
    endAt: fromNow(-73),
  },
  {
    id: "aten-ficticio-6",
    status: "cancelled_by_cereti",
    modality: "inPerson",
    spaceId: "esp-1",
    startAt: fromNow(-122),
    endAt: fromNow(-121),
    cancelReason: "Jornada de capacitación del equipo.",
  },
  {
    id: "aten-ficticio-7",
    status: "cancelled_by_student",
    modality: "online",
    startAt: fromNow(-98),
    endAt: fromNow(-97),
  },
  {
    id: "aten-ficticio-8",
    status: "no_show_justified",
    modality: "inPerson",
    spaceId: "esp-1",
    startAt: fromNow(-146),
    endAt: fromNow(-145),
  },
  {
    id: "aten-ficticio-9",
    status: "no_show_unjustified",
    modality: "inPerson",
    spaceId: "esp-2",
    startAt: fromNow(-218),
    endAt: fromNow(-217),
  },
];

function appointmentsSorted(
  appointments: ReadonlyArray<AgendaAppointment>,
): ReadonlyArray<AgendaAppointment> {
  return [...appointments].sort((a, b) => a.startAt - b.startAt);
}

export function createFictitiousAgendaAdapter(): AgendaPort {
  let blockCounter = FICTIONAL_BLOCKS.length;
  // Estado simulado en memoria: la lista es la "respuesta" del Backend
  // ficticio; un cambio de estado la actualiza dentro del mismo adaptador.
  let appointments: ReadonlyArray<AgendaAppointment> = FICTIONAL_APPOINTMENTS;
  let spaceCounter = Object.keys(FICTIONAL_SPACES).length;
  return {
    async findBookingProfessionals(): Promise<BookingProfessionalsResult> {
      return { status: "ok", professionalIds: [FICTIONAL_SLOTS[0].professionalId] };
    },
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
    // Reserva simulada (TI2-102, estados TI2-113): confirma los cupos
    // publicados con la proyección del contrato; el cupo con toma reciente
    // responde conflicto y un id ajeno responde falta de cupo, ambos con el
    // código canónico. El fallo técnico se prueba con rechazo y llegará con
    // la API real.
    async reserveSlot(input: ReserveSlotInput): Promise<ReserveSlotResult> {
      const found = FICTIONAL_SLOTS.find((item) => item.id === input.slotId);
      if (found === undefined) {
        return { status: "no_availability", code: NO_AVAILABILITY_ERROR_CODE };
      }
      if (FICTIONAL_CONFLICTING_SLOT_IDS.includes(found.id)) {
        return { status: "conflict", code: CONFLICT_ERROR_CODE };
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
    // Cancelación visible simulada (TI2-113): el identificador que la propia
    // confirmación entregó responde `cancelled` sin mutation real y sin
    // persistir nada; un id ajeno responde denegación sin revelar existencia.
    async cancelReservation(input: CancelReservationInput): Promise<CancelReservationResult> {
      return input.reservationId.startsWith(FICTIONAL_RESERVATION_PREFIX)
        ? { status: "cancelled" }
        : { status: "denied" };
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
    // Agenda del Profesional (TI2-115): lectura y cambio de estado
    // simulados. La política de transición aplica `transitionAppointment`
    // del dominio compartido (no hay reglas locales); la identidad y el
    // reloj se simulan en el adaptador, como lo hará el Backend real.
    async listAppointments(): Promise<ListAppointmentsResult> {
      if (appointments.length === 0) {
        return { status: "empty" };
      }
      return { status: "ok", appointments: appointmentsSorted(appointments) };
    },
    async getAppointment(appointmentId: string): Promise<AgendaAppointmentResult> {
      const found = appointments.find((item) => item.id === appointmentId);
      if (found === undefined) {
        // Denegación genérica: un id desconocido o ajeno no filtra existencia.
        return { status: "denied" };
      }
      return { status: "ok", appointment: found };
    },
    async changeAppointmentStatus(
      input: ChangeAppointmentStatusInput,
    ): Promise<ChangeAppointmentStatusResult> {
      const index = appointments.findIndex((item) => item.id === input.appointmentId);
      if (index === -1) {
        return { status: "denied" };
      }
      const current = appointments[index];
      const result = transitionAppointment({
        from: current.status,
        to: input.to,
        // Identidad ficticia "derivada" acá, como el Backend real lo hará
        // desde la sesión; el cliente nunca envía autoridad.
        actorId: FICTIONAL_PROFESSIONAL_ID,
        occurredAt: Date.now(),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        currentStartAt: current.startAt,
        ...(current.originalStartAt === undefined
          ? {}
          : { currentOriginalStartAt: current.originalStartAt }),
      });
      if (result.status === "rejected") {
        return { status: "rejected", cause: result.cause };
      }
      const updated: AgendaAppointment = {
        ...current,
        status: input.to,
        startAt: result.effectiveStartAt,
        endAt: result.effectiveEndAt ?? current.endAt,
        ...(result.originalStartAt === undefined
          ? {}
          : { originalStartAt: result.originalStartAt }),
        ...(result.cancelReason === undefined ? {} : { cancelReason: result.cancelReason }),
      };
      appointments = appointments.map((item, position) => (position === index ? updated : item));
      return { status: "changed", appointment: updated };
    },
    async listSpaces(): Promise<ListSpacesResult> {
      const spaces = Object.values(fictionalSpaces).sort((a, b) => (a.id < b.id ? -1 : 1));
      return { status: "ok", spaces };
    },
    // Guardado simulado del catálogo (TI2-04): con id conocido actualiza el
    // espacio ficticio conservando su identidad; con id desconocido o sin id
    // crea uno con identidad ficticia. Sin validación de propiedad ni
    // persistencia real: la escritura del catálogo no está entregada.
    async saveSpace(input: SaveSpaceInput): Promise<SaveSpaceResult> {
      const id =
        input.id !== undefined && fictionalSpaces[input.id] !== undefined
          ? input.id
          : `esp-ficticio-${(spaceCounter += 1)}`;
      const space: Space = {
        id,
        campus: input.campus,
        building: input.building,
        floor: input.floor,
        room: input.room,
        accessConditions: input.accessConditions,
        arrivalInstructions: input.arrivalInstructions,
        version: SPACE_CATALOG_CONTRACT_VERSION,
      };
      fictionalSpaces[id] = space;
      return { status: "saved", space };
    },
  };
}
