import {
  APPOINTMENT_CONTRACT_VERSION,
  toAppointmentProjection,
  type Appointment,
  type AppointmentContractVersion,
  type AppointmentPage,
  type AppointmentProjection,
  type AppointmentStatus,
  type AppointmentView,
} from "../../domain/appointments/appointment";
import { isProfileActive } from "../../domain/authorization/permissions";
import {
  civilRangeToInstantRange,
  type InstantRange,
} from "../../domain/availability/availability";
import type { ModalityPreference } from "../../domain/requests/request";
import {
  conflictError,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import {
  authorizeAppointmentRead,
  type AuthorizableProfile,
  type AuthorizationReader,
} from "../authorization/authorize";

/**
 * Consulta de la agenda y del detalle de las atenciones (TI2-112).
 *
 * Capa de Aplicación: lee por puertos, no toca `ctx.db` y se prueba con dobles.
 * La vista de cada atención sale siempre de `authorizeAppointmentRead`, la
 * misma regla del acompañamiento (TI2-86), sin una política propia de agenda.
 * `toAppointmentProjection` recorta la fila antes de entregarla.
 *
 * Con `accompanimentId` se leen las atenciones de ese acompañamiento. Sin él se
 * lee la agenda propia, que solo tienen el Estudiante y el Profesional: el
 * Practicante lee por acompañamiento asignado y el Administrador no lee
 * atenciones. Cada fila de la agenda propia conserva la vista de su
 * acompañamiento, así una asignación revocada la saca de la lista.
 *
 * Un identificador inexistente, ajeno, revocado o sin forma responde el mismo
 * `unauthorized`. Una entrada inválida o un rango sobre el tope responden
 * `conflict`, sin lista cortada. El filtro por vista ocurre antes de paginar:
 * el cursor solo existe dentro de lo que la sesión puede ver.
 *
 * Opera con datos ficticios.
 */

/** Tope de atenciones por página: se rechaza el exceso, nunca se trunca en silencio. */
export const LIST_APPOINTMENTS_PAGE_LIMIT_MAX = 50;

/**
 * Lecturas de atenciones para la agenda y el detalle. Las de rango responden
 * `conflict` sobre el tope; ninguna autoriza ni entrega `studentId`.
 */
export interface AppointmentAgendaReader {
  listByStudent(studentId: string, range: InstantRange): Promise<ApiResult<readonly Appointment[]>>;
  listByProfessional(
    professionalId: string,
    range: InstantRange,
  ): Promise<ApiResult<readonly Appointment[]>>;
  listByAccompaniment(
    accompanimentId: string,
    range: InstantRange,
  ): Promise<ApiResult<readonly Appointment[]>>;
  getAppointment(appointmentId: string): Promise<Appointment | null>;
}

/** Dependencias de las consultas, todas por puerto. */
export interface AppointmentQueryDeps {
  readonly auth: AuthorizationReader;
  readonly appointments: AppointmentAgendaReader;
}

/** Entrada de la lista: sin `accompanimentId` es la agenda propia. */
export interface ListAppointmentsQuery {
  readonly tokenIdentifier: string | null;
  readonly accompanimentId?: string;
  /** Primer día civil del rango, en `timeZone`. */
  readonly from: string;
  /** Último día civil del rango, inclusivo, en `timeZone`. */
  readonly to: string;
  readonly timeZone: string;
  readonly limit: number;
  readonly cursor?: string;
  readonly version: AppointmentContractVersion;
}

/** Entrada del detalle de una atención. */
export interface GetAppointmentQuery {
  readonly tokenIdentifier: string | null;
  readonly appointmentId: string;
  readonly version: AppointmentContractVersion;
}

function denied<T>(): ApiResult<T> {
  return errResult(unauthorizedError());
}

function conflict<T>(): ApiResult<T> {
  return errResult(conflictError());
}

/** Rango de instantes de la entrada, o `null` cuando no es válido. */
function instantRangeOf(input: ListAppointmentsQuery): InstantRange | null {
  try {
    return civilRangeToInstantRange(input);
  } catch {
    return null;
  }
}

/** Atenciones de un acompañamiento con la vista de quien consulta. */
async function readAccompanimentAgenda(
  deps: AppointmentQueryDeps,
  tokenIdentifier: string | null,
  accompanimentId: string,
  range: InstantRange,
): Promise<ApiResult<readonly AppointmentProjection[]>> {
  const grant = await authorizeAppointmentRead(deps.auth, { tokenIdentifier, accompanimentId });
  if (grant.status === "error") return denied();
  const rows = await deps.appointments.listByAccompaniment(accompanimentId, range);
  if (rows.status === "error") return conflict();
  return okResult(rows.data.map((row) => toAppointmentProjection(row, grant.data.view)));
}

/** Filas de la agenda propia según el rol, o `null` si el rol no tiene agenda propia. */
async function readOwnRows(
  appointments: AppointmentAgendaReader,
  profile: AuthorizableProfile,
  range: InstantRange,
): Promise<ApiResult<readonly Appointment[]> | null> {
  switch (profile.role) {
    case "student":
      return await appointments.listByStudent(profile._id, range);
    case "professional":
      return await appointments.listByProfessional(profile._id, range);
    case "intern":
    case "admin":
      return null;
  }
}

/**
 * Agenda propia. Cada fila pasa por la autorización de su acompañamiento, una
 * vez por acompañamiento distinto: figurar en la atención no basta, y la de un
 * acompañamiento con la asignación revocada queda fuera.
 */
async function readOwnAgenda(
  deps: AppointmentQueryDeps,
  tokenIdentifier: string | null,
  range: InstantRange,
): Promise<ApiResult<readonly AppointmentProjection[]>> {
  if (tokenIdentifier === null) return denied();
  const profile = await deps.auth.findProfileByTokenIdentifier(tokenIdentifier);
  if (profile === null || !isProfileActive(profile)) return denied();
  const rows = await readOwnRows(deps.appointments, profile, range);
  if (rows === null) return denied();
  if (rows.status === "error") return conflict();

  const views = new Map<string, AppointmentView | null>();
  const projections: AppointmentProjection[] = [];
  for (const row of rows.data) {
    let view = views.get(row.accompanimentId);
    if (view === undefined) {
      const grant = await authorizeAppointmentRead(deps.auth, {
        tokenIdentifier,
        accompanimentId: row.accompanimentId,
      });
      view = grant.status === "ok" ? grant.data.view : null;
      views.set(row.accompanimentId, view);
    }
    if (view !== null) projections.push(toAppointmentProjection(row, view));
  }
  return okResult(projections);
}

/**
 * Cursor de cada posición de la lista: el identificador de la atención y una
 * huella FNV-1a de los identificadores hasta ella. Si el tramo entregado
 * conserva sus atenciones y su orden, lo pendiente sigue después de esa
 * posición. La huella detecta un cambio de orden, no protege un secreto.
 */
function positionCursors(items: readonly AppointmentProjection[]): readonly string[] {
  let hash = 0x811c9dc5;
  return items.map((item) => {
    for (const char of `${item.id};`) {
      hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
    }
    return `${item.id}.${hash.toString(36)}`;
  });
}

/**
 * Lista atenciones por rango civil y con paginación. El cursor es opaco y
 * describe el tramo ya entregado: si ese tramo cambió o el cursor no figura en
 * lo visible, responde `conflict` para reiniciar la consulta, nunca omite
 * atenciones en silencio. Sin atenciones responde una página vacía.
 */
export async function listAppointments(
  deps: AppointmentQueryDeps,
  input: ListAppointmentsQuery,
): Promise<ApiResult<AppointmentPage>> {
  if (input.version !== APPOINTMENT_CONTRACT_VERSION) return conflict();
  if (!Number.isInteger(input.limit) || input.limit < 1) return conflict();
  if (input.limit > LIST_APPOINTMENTS_PAGE_LIMIT_MAX) return conflict();
  const range = instantRangeOf(input);
  if (range === null) return conflict();

  const visible =
    input.accompanimentId === undefined
      ? await readOwnAgenda(deps, input.tokenIdentifier, range)
      : await readAccompanimentAgenda(deps, input.tokenIdentifier, input.accompanimentId, range);
  if (visible.status === "error") return visible;

  const cursors = positionCursors(visible.data);
  let startIndex = 0;
  if (input.cursor !== undefined) {
    const found = cursors.indexOf(input.cursor);
    if (found === -1) return conflict();
    startIndex = found + 1;
  }
  const window = visible.data.slice(startIndex, startIndex + input.limit + 1);
  const items = window.slice(0, input.limit);
  const hasMore = window.length > items.length;
  return okResult({
    items,
    hasMore,
    nextCursor: hasMore ? (cursors[startIndex + items.length - 1] ?? null) : null,
    version: APPOINTMENT_CONTRACT_VERSION,
  });
}

/**
 * Detalle de una atención con la vista de su acompañamiento. Una fila
 * inexistente, un identificador de otra tabla o sin forma y una atención sin
 * vista responden el mismo `unauthorized`.
 */
export async function getAppointment(
  deps: AppointmentQueryDeps,
  input: GetAppointmentQuery,
): Promise<ApiResult<AppointmentProjection>> {
  if (input.version !== APPOINTMENT_CONTRACT_VERSION) return conflict();
  const row = await deps.appointments.getAppointment(input.appointmentId);
  if (row === null) return denied();
  const grant = await authorizeAppointmentRead(deps.auth, {
    tokenIdentifier: input.tokenIdentifier,
    accompanimentId: row.accompanimentId,
  });
  if (grant.status === "error") return denied();
  return okResult(toAppointmentProjection(row, grant.data.view));
}

// ── TI2-122: listado acotado para las acciones de calendario ────────────────
//
// La agenda de TI2-112 pagina por rango y entrega la proyección completa. El
// detalle del acompañamiento necesita, además, un resumen mínimo y acotado para
// ofrecer las acciones de calendario sin duplicar la proyección ni exponer
// profesional, sala, notas o necesidades.

/** Resumen mínimo de una atención propia para el portal. */
export interface AppointmentCalendarSummary {
  readonly appointmentId: string;
  readonly status: AppointmentStatus;
  readonly startAt: number;
  readonly endAt: number;
  readonly modality: ModalityPreference;
  readonly calendarAdded: boolean;
}

/** Lectura acotada por acompañamiento, ordenada de la más reciente a la más antigua. */
export interface AppointmentListReader {
  listByAccompaniment(input: {
    readonly accompanimentId: string;
    readonly limit: number;
  }): Promise<readonly AppointmentCalendarSummary[]>;
}

/** Tope del listado: el detalle no pagina ni necesita historial ilimitado. */
export const APPOINTMENT_CALENDAR_LIST_LIMIT = 50;

/**
 * Lista las atenciones del acompañamiento cuando el rol puede leerlas.
 * Estudiante, Profesional y Practicante reciben lo que su vista permite;
 * Administrador y acompañamientos ajenos reciben la denegación genérica.
 */
export async function listAccompanimentAppointmentsUseCase(
  deps: {
    readonly auth: AuthorizationReader;
    readonly appointments: AppointmentListReader;
  },
  input: {
    readonly tokenIdentifier: string | null;
    readonly accompanimentId: string;
  },
): Promise<ApiResult<AppointmentCalendarSummary[]>> {
  const grant = await authorizeAppointmentRead(deps.auth, {
    tokenIdentifier: input.tokenIdentifier,
    accompanimentId: input.accompanimentId,
  });
  if (grant.status === "error") return denied();

  const items = await deps.appointments.listByAccompaniment({
    accompanimentId: input.accompanimentId,
    limit: APPOINTMENT_CALENDAR_LIST_LIMIT,
  });
  return okResult([...items]);
}
