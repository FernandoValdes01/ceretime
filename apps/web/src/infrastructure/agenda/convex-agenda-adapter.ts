import type { ConvexReactClient } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { api } from "../../../../../convex/_generated/api";
import {
  AGENDA_TIME_ZONE,
  APPOINTMENT_CONTRACT_VERSION,
  AVAILABILITY_CONTRACT_VERSION,
  CONFLICT_ERROR_CODE,
  SPACE_CATALOG_CONTRACT_VERSION,
  UNAUTHORIZED_ERROR_CODE,
  UNAUTHORIZED_ERROR_MESSAGE,
  type AvailabilityBlock,
  type AvailabilityException,
  type PublicApiError,
  type Space,
} from "../../../../../convex/domain/index.ts";
import type {
  AgendaAppointment,
  AgendaAppointmentResult,
  AgendaPort,
  AgendaUnsubscribe,
  ChangeAppointmentStatusInput,
  ChangeAppointmentStatusResult,
  ListAppointmentsResult,
  ListAvailabilityResult,
  ListSpacesResult,
  ReserveSlotInput,
  ReserveSlotResult,
  SaveBlockInput,
  SaveBlockResult,
  SaveExceptionInput,
  SaveExceptionResult,
  SaveSpaceInput,
  SaveSpaceResult,
  SlotModalityFilter,
  SlotSearchResult,
} from "../../application/agenda/agenda-port.ts";
import { createFictitiousAgendaAdapter } from "./fictitious-agenda-adapter.ts";

/**
 * Adaptador Convex del puerto de agenda (TI2-125).
 *
 * Un solo adaptador vigente para las operaciones ya publicadas: el editor de
 * disponibilidad (TI2-111), la agenda/detalle del Profesional (TI2-112) y la
 * lectura del catálogo de espacios (TI2-99) leen contra
 * `api.presentation.*`; los guardados y la agenda escriben donde hay mutation
 * publicada. La búsqueda y la reserva del Estudiante (TI2-123) y la escritura
 * del catálogo de espacios (TI2-104) siguen delegadas al adaptador ficticio
 * mientras no tengan productor real; sus fixtures se identifican como tales
 * en la interfaz.
 *
 * El adaptador no decide autorización ni transiciones: resuelve la identidad en
 * el Backend, que también recorta la vista de cada atención. El cliente nunca
 * envía identidad, propiedad ni zona horaria. Los errores públicos
 * (`ConvexError({code, message})`) se conservan con solo esas dos claves; una
 * denegación se traduce a `denied` y un fallo no público a un mensaje genérico
 * sin propagar texto interno.
 *
 * Límites reales del contrato: las consultas de rango aceptan hasta 92 días
 * civiles y la agenda pagina de a 50 atenciones. La ventana se calcula con
 * `AGENDA_TIME_ZONE`, nunca con la zona del navegador, y la agenda se lee
 * completa por cursor para no truncar la lista en silencio.
 */

/** Tope de días civiles del contrato de disponibilidad y agenda. */
const AGENDA_WINDOW_DAYS = 92;

/** Tope de atenciones por página que acepta la API; nunca se envía más. */
const AGENDA_PAGE_LIMIT = 50;

/**
 * Tope de páginas que la vista acumula por rango. Con 50 por página cubre
 * 2.000 atenciones en 92 días; si se supera se muestra un error, no una lista
 * cortada en silencio.
 */
const AGENDA_MAX_PAGES = 40;

/**
 * Tope de espacios por página que acepta el catálogo (TI2-99) y tope de
 * páginas que la vista acumula. Con 100 por página cubre 1.000 salas; si se
 * supera se muestra un error, no un catálogo cortado en silencio.
 */
const SPACE_CATALOG_PAGE_LIMIT = 100;
const SPACE_CATALOG_MAX_PAGES = 10;

const TOO_MANY_APPOINTMENTS_MESSAGE =
  "La agenda tiene más atenciones de las que esta vista puede cargar en este rango.";
const TOO_MANY_SPACES_MESSAGE =
  "El catálogo de espacios tiene más salas de las que esta vista puede cargar.";

const LOAD_AVAILABILITY_FALLBACK = "No pudimos cargar la disponibilidad. Inténtalo de nuevo.";
const LOAD_AGENDA_FALLBACK = "No pudimos cargar la agenda. Inténtalo de nuevo.";
const LOAD_APPOINTMENT_FALLBACK = "No pudimos cargar la atención. Inténtalo de nuevo.";
const LOAD_SPACES_FALLBACK = "No pudimos cargar el catálogo de espacios. Inténtalo de nuevo.";
const SAVE_BLOCK_FALLBACK = "No pudimos guardar el bloque. Inténtalo de nuevo.";
const SAVE_EXCEPTION_FALLBACK = "No pudimos guardar la excepción. Inténtalo de nuevo.";
const CHANGE_STATUS_FALLBACK = "No pudimos registrar el cambio. Inténtalo de nuevo.";

/**
 * Cliente mínimo que necesita el adaptador. Se tipa con las firmas del cliente
 * de Convex para conservar los tipos generados y poder inyectar un doble en
 * pruebas; `watchQuery` es opcional porque el adaptador funciona sin
 * suscripciones.
 */
export interface ConvexAgendaClient {
  query: ConvexReactClient["query"];
  mutation: ConvexReactClient["mutation"];
  watchQuery?: ConvexReactClient["watchQuery"];
}

type AppointmentsPage = FunctionReturnType<typeof api.presentation.appointments.listAppointments>;
type AppointmentProjection = AppointmentsPage["items"][number];
type SpacesPage = FunctionReturnType<typeof api.presentation.spaces.listSpaces>;
type OwnAvailability = FunctionReturnType<typeof api.presentation.availability.listOwnAvailability>;
type AppointmentsArgs = {
  readonly from: string;
  readonly to: string;
  readonly limit: number;
  readonly version: typeof APPOINTMENT_CONTRACT_VERSION;
};

const AGENDA_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: AGENDA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Fecha civil `YYYY-MM-DD` de un instante en la zona de la agenda. */
function civilDateOf(epochMs: number): string {
  const parts = AGENDA_DATE_FORMAT.formatToParts(new Date(epochMs));
  const read = (type: "year" | "month" | "day"): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

/** Suma días a una fecha civil sin depender de la zona del navegador. */
function civilDatePlus(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  const shiftedYear = shifted.getUTCFullYear();
  const shiftedMonth = `${shifted.getUTCMonth() + 1}`.padStart(2, "0");
  const shiftedDay = `${shifted.getUTCDate()}`.padStart(2, "0");
  return `${shiftedYear}-${shiftedMonth}-${shiftedDay}`;
}

/** Ventana de disponibilidad: hoy y los 91 días siguientes (92 en total). */
function availabilityRange(nowMs: number): { readonly from: string; readonly to: string } {
  const from = civilDateOf(nowMs);
  return { from, to: civilDatePlus(from, AGENDA_WINDOW_DAYS - 1) };
}

/**
 * Ventana de la agenda: 45 días antes y 46 después de hoy, para revisar
 * atenciones recientes y próximas sin superar el tope de 92 días.
 */
function agendaRange(nowMs: number): { readonly from: string; readonly to: string } {
  const today = civilDateOf(nowMs);
  const before = Math.floor((AGENDA_WINDOW_DAYS - 1) / 2);
  const from = civilDatePlus(today, -before);
  return { from, to: civilDatePlus(from, AGENDA_WINDOW_DAYS - 1) };
}

function appointmentsArgs(nowMs: number): AppointmentsArgs {
  const range = agendaRange(nowMs);
  return {
    from: range.from,
    to: range.to,
    limit: AGENDA_PAGE_LIMIT,
    version: APPOINTMENT_CONTRACT_VERSION,
  };
}

/** Recorta una proyección a la representación de la agenda, sin inventar campos. */
function toAgendaAppointment(projection: AppointmentProjection): AgendaAppointment {
  return {
    id: projection.id,
    status: projection.status,
    modality: projection.modality,
    startAt: projection.startAt,
    endAt: projection.endAt,
    ...("spaceId" in projection && projection.spaceId !== undefined
      ? { spaceId: projection.spaceId }
      : {}),
    ...("originalStartAt" in projection && projection.originalStartAt !== undefined
      ? { originalStartAt: projection.originalStartAt }
      : {}),
    ...("cancelReason" in projection && projection.cancelReason !== undefined
      ? { cancelReason: projection.cancelReason }
      : {}),
  };
}

/** Error público del Backend, sin stack ni datos internos; `null` si no lo es. */
function publicErrorOf(error: unknown): PublicApiError | null {
  if (!(error instanceof ConvexError)) {
    return null;
  }
  const data: unknown = error.data;
  if (typeof data === "object" && data !== null) {
    const record = data as { code?: unknown; message?: unknown };
    if (typeof record.code === "string" && typeof record.message === "string") {
      return { code: record.code, message: record.message };
    }
  }
  // Sprint 1 conserva `ConvexError("No autorizado")` sin código.
  if (data === UNAUTHORIZED_ERROR_MESSAGE) {
    return { code: UNAUTHORIZED_ERROR_CODE, message: UNAUTHORIZED_ERROR_MESSAGE };
  }
  return null;
}

type ClassifiedError = { readonly denied: true } | { readonly error: PublicApiError };

/** Distingue denegación de error público; lo desconocido usa un mensaje seguro. */
function classifyError(error: unknown, fallbackMessage: string): ClassifiedError {
  const publicError = publicErrorOf(error);
  if (publicError?.code === UNAUTHORIZED_ERROR_CODE) {
    return { denied: true };
  }
  if (publicError !== null) {
    return { error: publicError };
  }
  return { error: { code: CONFLICT_ERROR_CODE, message: fallbackMessage } };
}

function mapAvailabilityError(error: unknown): ListAvailabilityResult {
  const classified = classifyError(error, LOAD_AVAILABILITY_FALLBACK);
  return "denied" in classified
    ? { status: "denied" }
    : { status: "error", message: classified.error.message };
}

function mapAppointmentsError(error: unknown): ListAppointmentsResult {
  const classified = classifyError(error, LOAD_AGENDA_FALLBACK);
  return "denied" in classified
    ? { status: "denied" }
    : { status: "error", message: classified.error.message };
}

function mapAppointmentError(error: unknown): AgendaAppointmentResult {
  const classified = classifyError(error, LOAD_APPOINTMENT_FALLBACK);
  return "denied" in classified
    ? { status: "denied" }
    : { status: "error", message: classified.error.message };
}

function mapStatusChangeError(error: unknown): ChangeAppointmentStatusResult {
  const classified = classifyError(error, CHANGE_STATUS_FALLBACK);
  return "denied" in classified
    ? { status: "denied" }
    : { status: "error", error: classified.error };
}

/** Convierte las proyecciones en la lista ordenada de la agenda. */
function toAppointmentsResult(items: ReadonlyArray<AppointmentProjection>): ListAppointmentsResult {
  if (items.length === 0) {
    return { status: "empty" };
  }
  const appointments = items
    .map(toAgendaAppointment)
    .sort((left, right) => left.startAt - right.startAt);
  return { status: "ok", appointments };
}

/**
 * Crea el adaptador Convex. `now` se inyecta en pruebas para fijar la ventana
 * civil; en producción usa el reloj del navegador solo para elegir el rango,
 * nunca para decidir reglas de negocio.
 */
export function createConvexAgendaAdapter(
  client: ConvexAgendaClient,
  now: () => number = Date.now,
): AgendaPort {
  // Operaciones aún sin API real: búsqueda y reserva del Estudiante
  // (TI2-123) y catálogo de espacios (TI2-104) siguen con fixtures.
  const simulated = createFictitiousAgendaAdapter();

  async function readOwnAvailability(): Promise<OwnAvailability> {
    const range = availabilityRange(now());
    return await client.query(api.presentation.availability.listOwnAvailability, {
      from: range.from,
      to: range.to,
      version: AVAILABILITY_CONTRACT_VERSION,
    });
  }

  async function readAvailability(): Promise<ListAvailabilityResult> {
    try {
      const own = await readOwnAvailability();
      if (own.blocks.length === 0 && own.exceptions.length === 0) {
        return { status: "empty" };
      }
      return {
        status: "ok",
        blocks: [...own.blocks] as ReadonlyArray<AvailabilityBlock>,
        exceptions: [...own.exceptions] as ReadonlyArray<AvailabilityException>,
      };
    } catch (error) {
      return mapAvailabilityError(error);
    }
  }

  async function saveBlock(input: SaveBlockInput): Promise<SaveBlockResult> {
    try {
      const { blockId } = await client.mutation(api.presentation.availability.publishBlock, {
        weekday: input.weekday,
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        slotMinutes: input.slotMinutes,
        modality: input.modality,
        ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
        version: AVAILABILITY_CONTRACT_VERSION,
      });
      // La mutación solo devuelve el identificador: se relee la disponibilidad
      // para responder la entidad real y no fabricar una copia local.
      const own = await readOwnAvailability();
      const block = own.blocks.find((item) => item.id === blockId);
      if (block === undefined) {
        return {
          status: "error",
          error: {
            code: CONFLICT_ERROR_CODE,
            message: "No pudimos confirmar el bloque guardado. Vuelve a cargar la disponibilidad.",
          },
        };
      }
      return { status: "saved", block };
    } catch (error) {
      const classified = classifyError(error, SAVE_BLOCK_FALLBACK);
      return "denied" in classified
        ? { status: "denied" }
        : { status: "error", error: classified.error };
    }
  }

  async function saveException(input: SaveExceptionInput): Promise<SaveExceptionResult> {
    try {
      const { exceptionId } = await client.mutation(
        api.presentation.availability.publishException,
        {
          date: input.date,
          kind: input.kind,
          ...(input.blockId === undefined ? {} : { blockId: input.blockId }),
          ...(input.windows === undefined ? {} : { windows: [...input.windows] }),
          version: AVAILABILITY_CONTRACT_VERSION,
        },
      );
      // La excepción se relee en su propia fecha: la lista solo trae el rango
      // consultado y la fecha elegida puede quedar fuera de la ventana del editor.
      const own = await client.query(api.presentation.availability.listOwnAvailability, {
        from: input.date,
        to: input.date,
        version: AVAILABILITY_CONTRACT_VERSION,
      });
      const exception = own.exceptions.find((item) => item.id === exceptionId);
      if (exception === undefined) {
        return {
          status: "error",
          error: {
            code: CONFLICT_ERROR_CODE,
            message:
              "No pudimos confirmar la excepción guardada. Vuelve a cargar la disponibilidad.",
          },
        };
      }
      return { status: "saved", exception };
    } catch (error) {
      const classified = classifyError(error, SAVE_EXCEPTION_FALLBACK);
      return "denied" in classified
        ? { status: "denied" }
        : { status: "error", error: classified.error };
    }
  }

  /**
   * Catálogo de espacios del Backend, completo por cursor.
   *
   * La agenda ya recibe identificadores reales de sala, así que las etiquetas
   * solo resuelven si el catálogo es el mismo que publica TI2-99. La escritura
   * sigue simulada porque no hay mutation publicada (TI2-104).
   */
  async function readSpaces(): Promise<ListSpacesResult> {
    try {
      const spaces: Space[] = [];
      let cursor: string | undefined;
      let pages = 0;
      for (;;) {
        const page: SpacesPage = await client.query(api.presentation.spaces.listSpaces, {
          limit: SPACE_CATALOG_PAGE_LIMIT,
          ...(cursor === undefined ? {} : { cursor }),
          version: SPACE_CATALOG_CONTRACT_VERSION,
        });
        spaces.push(...page.items);
        pages += 1;
        if (!page.hasMore || page.nextCursor === null) {
          break;
        }
        if (pages >= SPACE_CATALOG_MAX_PAGES) {
          return { status: "error", message: TOO_MANY_SPACES_MESSAGE };
        }
        cursor = page.nextCursor;
      }
      return spaces.length === 0 ? { status: "empty" } : { status: "ok", spaces };
    } catch (error) {
      const classified = classifyError(error, LOAD_SPACES_FALLBACK);
      return "denied" in classified
        ? { status: "denied" }
        : { status: "error", message: classified.error.message };
    }
  }

  async function readAppointment(appointmentId: string): Promise<AgendaAppointmentResult> {
    try {
      const projection = await client.query(api.presentation.appointments.getAppointment, {
        appointmentId,
        version: APPOINTMENT_CONTRACT_VERSION,
      });
      return { status: "ok", appointment: toAgendaAppointment(projection) };
    } catch (error) {
      return mapAppointmentError(error);
    }
  }

  /** Acumula las páginas visibles; el exceso de páginas es un error explícito. */
  async function readAllAppointmentPages(
    first: AppointmentsPage,
    args: AppointmentsArgs,
  ): Promise<ListAppointmentsResult> {
    try {
      const items: AppointmentProjection[] = [...first.items];
      let page = first;
      let pages = 1;
      while (page.hasMore && page.nextCursor !== null) {
        if (pages >= AGENDA_MAX_PAGES) {
          return { status: "error", message: TOO_MANY_APPOINTMENTS_MESSAGE };
        }
        page = await client.query(api.presentation.appointments.listAppointments, {
          ...args,
          cursor: page.nextCursor,
        });
        items.push(...page.items);
        pages += 1;
      }
      return toAppointmentsResult(items);
    } catch (error) {
      return mapAppointmentsError(error);
    }
  }

  async function listAppointments(): Promise<ListAppointmentsResult> {
    try {
      const args = appointmentsArgs(now());
      const first = await client.query(api.presentation.appointments.listAppointments, args);
      return await readAllAppointmentPages(first, args);
    } catch (error) {
      return mapAppointmentsError(error);
    }
  }

  async function changeAppointmentStatus(
    input: ChangeAppointmentStatusInput,
  ): Promise<ChangeAppointmentStatusResult> {
    try {
      if (input.to === "cancelled_by_cereti") {
        await client.mutation(api.presentation.appointments.cancelAppointment, {
          appointmentId: input.appointmentId,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          version: APPOINTMENT_CONTRACT_VERSION,
        });
      } else if (input.to === "completed" || input.to === "no_show") {
        await client.mutation(api.presentation.appointments.recordAppointmentAttendance, {
          appointmentId: input.appointmentId,
          outcome: input.to,
          version: APPOINTMENT_CONTRACT_VERSION,
        });
      } else {
        // El reagendamiento exige elegir un cupo (TI2-121) y la justificación
        // de inasistencia no está publicada (TI2-119): la UI no los ofrece y
        // el adaptador tampoco los simula.
        return {
          status: "error",
          error: {
            code: CONFLICT_ERROR_CODE,
            message: "Este cambio todavía no está disponible en la API.",
          },
        };
      }
      const updated = await readAppointment(input.appointmentId);
      if (updated.status === "ok") {
        return { status: "changed", appointment: updated.appointment };
      }
      if (updated.status === "denied") {
        return { status: "denied" };
      }
      return {
        status: "error",
        error: { code: CONFLICT_ERROR_CODE, message: updated.message },
      };
    } catch (error) {
      return mapStatusChangeError(error);
    }
  }

  /**
   * Suscripción de la agenda completa, página por página.
   *
   * Cada página cargada se suscribe con su propio cursor: un cambio en una
   * atención posterior a la primera página también llega a la vista. Las
   * páginas que dejan de usarse se dan de baja para no acumular
   * suscripciones cuando el rango se acorta.
   */
  function watchAppointments(
    onChange: (result: ListAppointmentsResult) => void,
  ): AgendaUnsubscribe {
    if (client.watchQuery === undefined) {
      void listAppointments().then(onChange);
      return () => {};
    }
    // `ConvexReactClient.watchQuery` usa `this.sync` internamente: se conserva
    // el receptor o el cliente real falla al ejecutarlo como función suelta.
    const watchQuery = client.watchQuery.bind(client);
    const args = appointmentsArgs(now());
    const pages = new Map<
      string,
      { readonly unsubscribe: () => void; readonly local: () => AppointmentsPage | undefined }
    >();
    let cancelled = false;
    let emitting = false;

    function stop(key: string) {
      const page = pages.get(key);
      if (page === undefined) {
        return;
      }
      page.unsubscribe();
      pages.delete(key);
    }

    function subscribe(cursor: string | undefined): AppointmentsPage | undefined {
      const key = cursor ?? "";
      const existing = pages.get(key);
      if (existing !== undefined) {
        return existing.local();
      }
      const watch = watchQuery(
        api.presentation.appointments.listAppointments,
        cursor === undefined ? args : { ...args, cursor },
      );
      const local = (): AppointmentsPage | undefined => {
        const value: AppointmentsPage | undefined = watch.localQueryResult();
        return value;
      };
      const unsubscribe = watch.onUpdate(emit);
      pages.set(key, { unsubscribe, local });
      return local();
    }

    function emit() {
      if (cancelled || emitting) {
        return;
      }
      emitting = true;
      try {
        const items: AppointmentProjection[] = [];
        const used = new Set<string>();
        let cursor: string | undefined;
        let loaded = 0;
        for (;;) {
          const key = cursor ?? "";
          const page = subscribe(cursor);
          used.add(key);
          if (page === undefined) {
            return;
          }
          items.push(...page.items);
          loaded += 1;
          if (!page.hasMore || page.nextCursor === null) {
            break;
          }
          if (loaded >= AGENDA_MAX_PAGES) {
            onChange({ status: "error", message: TOO_MANY_APPOINTMENTS_MESSAGE });
            return;
          }
          cursor = page.nextCursor;
        }
        for (const key of Array.from(pages.keys())) {
          if (!used.has(key)) {
            stop(key);
          }
        }
        onChange(toAppointmentsResult(items));
      } catch (error) {
        if (!cancelled) {
          onChange(mapAppointmentsError(error));
        }
      } finally {
        emitting = false;
      }
    }

    emit();
    return () => {
      cancelled = true;
      for (const key of Array.from(pages.keys())) {
        stop(key);
      }
    };
  }

  function watchAppointment(
    appointmentId: string,
    onChange: (result: AgendaAppointmentResult) => void,
  ): AgendaUnsubscribe {
    if (client.watchQuery === undefined) {
      void readAppointment(appointmentId).then(onChange);
      return () => {};
    }
    const watch = client.watchQuery(api.presentation.appointments.getAppointment, {
      appointmentId,
      version: APPOINTMENT_CONTRACT_VERSION,
    });
    let cancelled = false;
    const emit = () => {
      try {
        const local = watch.localQueryResult();
        if (local === undefined) {
          return;
        }
        if (!cancelled) {
          onChange({ status: "ok", appointment: toAgendaAppointment(local) });
        }
      } catch (error) {
        if (!cancelled) {
          onChange(mapAppointmentError(error));
        }
      }
    };
    const unsubscribe = watch.onUpdate(emit);
    emit();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }

  return {
    // Sin API real todavía: búsqueda y reserva del Estudiante (TI2-123) y
    // escritura del catálogo (TI2-104) conservan los fixtures declarados.
    searchSlots(filter: { modality: SlotModalityFilter }): Promise<SlotSearchResult> {
      return simulated.searchSlots(filter);
    },
    reserveSlot(input: ReserveSlotInput): Promise<ReserveSlotResult> {
      return simulated.reserveSlot(input);
    },
    listSpaces: readSpaces,
    saveSpace(input: SaveSpaceInput): Promise<SaveSpaceResult> {
      return simulated.saveSpace(input);
    },
    listAvailability: readAvailability,
    saveBlock,
    saveException,
    listAppointments,
    getAppointment: readAppointment,
    changeAppointmentStatus,
    watchAppointments,
    watchAppointment,
  };
}
