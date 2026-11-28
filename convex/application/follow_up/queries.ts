import {
  conflictError,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import {
  FOLLOW_UP_CONTRACT_VERSION,
  toFollowUpProjection,
  type FollowUpContractVersion,
  type FollowUpProjection,
  type FollowUpView,
} from "../../domain/follow_up/follow_up";
import { authorizeFollowUpRead, type AuthorizationReader } from "../authorization/authorize";
import type { FollowUpAppointmentReader, FollowUpRecordReader, StoredFollowUp } from "./ports";

/**
 * Lectura del registro de seguimiento por atención y por acompañamiento
 * (TI2-146).
 *
 * Capa de Aplicación: lee por puertos y no toca `ctx.db`. La vista sale de
 * `authorizeFollowUpRead` (TI2-127): `professional` para el Profesional
 * asignado, `shared` para el Estudiante dueño y `minimized` para el
 * Practicante asignado; el Administrador no lee seguimiento.
 * `toFollowUpProjection` recorta cada registro antes de entregarlo.
 *
 * La nota interna solo se resuelve desde `followUpNotes` cuando la vista es
 * `professional`; para las otras vistas ni siquiera se lee. Una atención o un
 * acompañamiento inexistente, ajeno o sin forma responde el mismo
 * `unauthorized`.
 *
 * Opera con datos ficticios.
 */

/** Tope de atenciones por página: se rechaza el exceso, nunca se trunca. */
export const LIST_FOLLOW_UP_PAGE_LIMIT_MAX = 20;

/** Dependencias de las lecturas, todas por puerto. */
export interface FollowUpQueryDeps {
  readonly auth: AuthorizationReader;
  readonly appointments: FollowUpAppointmentReader;
  readonly followUp: FollowUpRecordReader;
}

/** Página publicada: los registros con la vista de quien consulta. */
export interface FollowUpProjectionPage {
  readonly items: readonly FollowUpProjection[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  readonly version: FollowUpContractVersion;
}

/** Proyecta un registro con la vista concedida; la nota, solo para `professional`. */
async function project(
  reader: FollowUpRecordReader,
  stored: StoredFollowUp,
  view: FollowUpView,
): Promise<FollowUpProjection> {
  const appointment = { status: stored.appointmentStatus, startsAt: stored.appointmentStartsAt };
  if (view !== "professional" || stored.internalNoteId === undefined) {
    return toFollowUpProjection(stored.record, appointment, view);
  }
  const internalNote = await reader.readInternalNote(
    stored.internalNoteId,
    stored.record.accompanimentId,
  );
  const record = internalNote === null ? stored.record : { ...stored.record, internalNote };
  return toFollowUpProjection(record, appointment, view);
}

/**
 * Registro de seguimiento de una atención con la vista del rol, o `null`
 * cuando la atención aún no tiene seguimiento.
 */
export async function getFollowUpRecord(
  deps: FollowUpQueryDeps,
  query: { readonly tokenIdentifier: string | null; readonly appointmentId: string },
): Promise<ApiResult<FollowUpProjection | null>> {
  const appointment = await deps.appointments.getAppointment(query.appointmentId);
  if (appointment === null) return errResult(unauthorizedError());

  const grant = await authorizeFollowUpRead(deps.auth, {
    tokenIdentifier: query.tokenIdentifier,
    accompanimentId: appointment.accompanimentId,
    privacyCategory: "appointments",
  });
  if (grant.status === "error") return grant;

  const stored = await deps.followUp.findByAppointment(appointment.id);
  if (stored === null) return okResult(null);
  return okResult(await project(deps.followUp, stored, grant.data.view));
}

/**
 * Historial de seguimiento de un acompañamiento con la vista del rol. Solo
 * recorre atenciones de ese acompañamiento, así que no mezcla historiales.
 */
export async function listAccompanimentFollowUpRecords(
  deps: FollowUpQueryDeps,
  query: {
    readonly tokenIdentifier: string | null;
    readonly accompanimentId: string;
    readonly limit: number;
    readonly cursor?: string;
  },
): Promise<ApiResult<FollowUpProjectionPage>> {
  if (
    !Number.isInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > LIST_FOLLOW_UP_PAGE_LIMIT_MAX
  ) {
    return errResult(conflictError());
  }

  const grant = await authorizeFollowUpRead(deps.auth, {
    tokenIdentifier: query.tokenIdentifier,
    accompanimentId: query.accompanimentId,
    privacyCategory: "appointments",
  });
  if (grant.status === "error") return grant;

  const page = await deps.followUp.listByAccompaniment(query.accompanimentId, {
    limit: query.limit,
    cursor: query.cursor ?? null,
  });
  // Un cursor de otra consulta, por ejemplo de otro acompañamiento o
  // alterado: el cliente reinicia el historial sin cursor.
  if (page === null) return errResult(conflictError());
  const items: FollowUpProjection[] = [];
  for (const stored of page.items) {
    items.push(await project(deps.followUp, stored, grant.data.view));
  }
  return okResult({
    items,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    version: FOLLOW_UP_CONTRACT_VERSION,
  });
}
