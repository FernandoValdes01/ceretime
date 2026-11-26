import type { PaginationOptions, PaginationResult } from "convex/server";
import {
  conflictError,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import {
  canReadOwnPrivacyRequests,
  canRespondToPrivacyRequest,
} from "../../domain/authorization/permissions";
import type { PrivacyRequestStatus } from "../../domain/privacy/privacy_request";
import type { PrivacyProfileReader, PrivacyRequestReader } from "./ports";
import {
  toOwnProjection,
  toReviewProjection,
  type PrivacyRequestOwnProjection,
  type PrivacyRequestReviewProjection,
} from "./projection";

/**
 * Lecturas de solicitudes de derechos de privacidad (TI2-167).
 *
 * Capa de Aplicación: lee por puertos y no toca `ctx.db`. El titular sale del
 * perfil vinculado a la sesión, nunca de un identificador del cliente. El
 * Estudiante solo ve sus propias solicitudes; el Administrador ve la cola
 * completa con la identidad de quien presentó cada una. Cualquier otra
 * persona, una solicitud ajena o una inexistente reciben la misma
 * `unauthorized`, sin revelar si existe.
 *
 * La consulta no lee el reloj: `dueAt` es el vencimiento exclusivo y el
 * cliente lo compara con su hora. Una página se acota a
 * `PRIVACY_REQUEST_PAGE_LIMIT_MAX`; un tamaño no finito responde `conflict`.
 *
 * Opera con datos ficticios.
 */

/** Tope de solicitudes por página: se acota, nunca se trunca en silencio. */
export const PRIVACY_REQUEST_PAGE_LIMIT_MAX = 50;

/** Dependencias de las lecturas, todas por puerto. */
export interface PrivacyQueryDeps<RequestId extends string, UserId extends string> {
  readonly profiles: PrivacyProfileReader<UserId>;
  readonly requests: PrivacyRequestReader<RequestId, UserId>;
}

/** Vista que puede recibir quien consulta una solicitud concreta. */
export type PrivacyRequestProjection<RequestId extends string, UserId extends string> =
  | PrivacyRequestOwnProjection<RequestId>
  | PrivacyRequestReviewProjection<RequestId, UserId>;

function denied<T>(): ApiResult<T> {
  return errResult(unauthorizedError());
}

/**
 * Acota el tamaño de página sin perder `cursor`, `endCursor` ni los límites
 * opcionales del cliente. Un tamaño no finito no se puede acotar y se rechaza.
 */
function boundedPage(paginationOpts: PaginationOptions): PaginationOptions | null {
  if (!Number.isFinite(paginationOpts.numItems)) return null;
  return {
    ...paginationOpts,
    numItems: Math.min(
      Math.max(Math.floor(paginationOpts.numItems), 1),
      PRIVACY_REQUEST_PAGE_LIMIT_MAX,
    ),
  };
}

/**
 * Solicitudes propias del Estudiante, de la más reciente a la más antigua,
 * en cualquier estado. Cualquier otro rol recibe `unauthorized`.
 */
export async function listOwnPrivacyRequests<RequestId extends string, UserId extends string>(
  deps: PrivacyQueryDeps<RequestId, UserId>,
  input: { readonly tokenIdentifier: string | null; readonly paginationOpts: PaginationOptions },
): Promise<ApiResult<PaginationResult<PrivacyRequestOwnProjection<RequestId>>>> {
  const profile = await deps.profiles.findProfile(input.tokenIdentifier);
  if (profile === null || !canReadOwnPrivacyRequests(profile)) return denied();

  const page = boundedPage(input.paginationOpts);
  if (page === null) return errResult(conflictError());

  const result = await deps.requests.listByRequester(profile._id, page);
  return okResult({ ...result, page: result.page.map(toOwnProjection) });
}

/**
 * Solicitud concreta: la vista del titular si es propia, o la del
 * Administrador responsable. Una solicitud ajena o inexistente responde
 * `unauthorized` sin distinguir el caso.
 */
export async function getPrivacyRequest<RequestId extends string, UserId extends string>(
  deps: PrivacyQueryDeps<RequestId, UserId>,
  input: { readonly tokenIdentifier: string | null; readonly requestId: RequestId },
): Promise<ApiResult<PrivacyRequestProjection<RequestId, UserId>>> {
  const profile = await deps.profiles.findProfile(input.tokenIdentifier);
  if (profile === null) return denied();

  const record = await deps.requests.getRequest(input.requestId);
  if (record === null) return denied();

  if (record.requesterId === profile._id && canReadOwnPrivacyRequests(profile)) {
    return okResult(toOwnProjection(record));
  }
  if (canRespondToPrivacyRequest(profile)) {
    return okResult(toReviewProjection(record));
  }
  return denied();
}

/**
 * Cola de revisión del Administrador, ordenada por vencimiento efectivo. Con
 * `status` filtra ese estado; sin él recorre todos. Cualquier otro rol recibe
 * `unauthorized`.
 */
export async function listPrivacyRequests<RequestId extends string, UserId extends string>(
  deps: PrivacyQueryDeps<RequestId, UserId>,
  input: {
    readonly tokenIdentifier: string | null;
    readonly status?: PrivacyRequestStatus;
    readonly paginationOpts: PaginationOptions;
  },
): Promise<ApiResult<PaginationResult<PrivacyRequestReviewProjection<RequestId, UserId>>>> {
  const profile = await deps.profiles.findProfile(input.tokenIdentifier);
  if (profile === null || !canRespondToPrivacyRequest(profile)) return denied();

  const page = boundedPage(input.paginationOpts);
  if (page === null) return errResult(conflictError());

  const result =
    input.status === undefined
      ? await deps.requests.listByDeadline(page)
      : await deps.requests.listByStatus(input.status, page);
  return okResult({ ...result, page: result.page.map(toReviewProjection) });
}
