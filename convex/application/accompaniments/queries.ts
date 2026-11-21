import type { PaginationOptions, UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { isPersonalProfessionalActive } from "../../domain/accounts/enablement";
import {
  CONFLICT_ERROR_CODE,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import {
  findActiveAssignmentsForUser,
  findProfileByTokenIdentifier,
  getAccompanimentById,
  getUserById,
  listActiveProfessionalAssignments,
  takeProfessionalProfiles,
  paginateInternalNotes,
  paginateOwnedAccompaniments,
  queryAssignedRowsAfter,
} from "../../infrastructure/accompaniments/repository";
import {
  AUTHORIZATION_DENIED_MESSAGE,
  authorizeAccompanimentRead,
  authorizeInternalNoteRead,
  listingScopeForRole,
  type AuthorizableAssignment,
} from "../authorization/authorize";
import {
  toAccompanimentProjection,
  type AccompanimentProjection,
  type AccompanimentView,
} from "../../domain/accompaniments/accompaniment";

/**
 * Casos de uso de lectura de acompañamientos (S2).
 *
 * Capa de Aplicación: recibe la identidad ya resuelta en Presentación con
 * `ctx.auth.getUserIdentity()`, carga el perfil y los datos con
 * Infraestructura, y delega cada decisión en Dominio. Nunca acepta un
 * `userId` del cliente como prueba: el llamante siempre sale del perfil
 * vinculado al `tokenIdentifier` del servidor.
 *
 * Toda denegación (sin identidad, sin perfil, cuenta inhabilitada, fuera de
 * alcance, acompañamiento inexistente o acceso general de Administrador)
 * lanza el mismo error genérico, sin exponer el motivo ni la existencia del
 * recurso. Opera con datos ficticios.
 */

function deny(): never {
  throw new ConvexError(AUTHORIZATION_DENIED_MESSAGE);
}

function toAuthorizableProfile(profile: Doc<"users">) {
  return {
    _id: profile._id,
    role: profile.role,
    institutionalStatus: profile.institutionalStatus,
    accountStatus: profile.accountStatus,
  };
}

function toAuthorizableAssignments(
  rows: ReadonlyArray<Doc<"accompanimentAssignments">>,
): AuthorizableAssignment[] {
  return rows.map((assignment) => ({
    accompanimentId: assignment.accompanimentId,
    userId: assignment.userId,
    assignedRole: assignment.assignedRole,
    status: assignment.status,
  }));
}

/**
 * Vista de acompañamiento con `Id` de Convex: la proyección del dominio
 * (`convex/domain`) instanciada con los identificadores tipados. La forma
 * vive una sola vez en el dominio; acá solo se fija el tipo de id.
 */
export type AccompanimentViewResult = AccompanimentProjection<
  Id<"accompaniments">,
  Id<"users">,
  Id<"requests">
>;

function projectView(
  accompaniment: Doc<"accompaniments">,
  view: AccompanimentView,
): AccompanimentViewResult {
  return toAccompanimentProjection(accompaniment, view);
}

/**
 * Perfil vigente del llamante. La habilitación sola no concede acceso a
 * ningún acompañamiento; solo verifica que la cuenta puede operar.
 */
async function requireAuthorizedProfile(
  ctx: QueryCtx,
  identity: UserIdentity | null,
): Promise<Doc<"users">> {
  if (identity === null) deny();
  const profile = await findProfileByTokenIdentifier(ctx, identity?.tokenIdentifier ?? "");
  if (profile === null) deny();
  if (profile.institutionalStatus !== "enabled" || profile.accountStatus !== "active") deny();
  return profile;
}

/**
 * Lee un acompañamiento con vista completa o minimizada según el rol.
 * El Administrador siempre recibe denegación, sin acceso general.
 */
export async function getAccompanimentDetail(
  ctx: QueryCtx,
  identity: UserIdentity | null,
  args: { readonly accompanimentId: Id<"accompaniments"> },
): Promise<AccompanimentViewResult> {
  const profile = await requireAuthorizedProfile(ctx, identity);

  const accompaniment = await getAccompanimentById(ctx, args.accompanimentId);
  if (accompaniment === null) deny();

  const assignments = toAuthorizableAssignments(
    await findActiveAssignmentsForUser(ctx, args.accompanimentId, profile._id),
  );
  const view = authorizeAccompanimentRead({
    profile: toAuthorizableProfile(profile),
    accompaniment: { _id: accompaniment._id, studentId: accompaniment.studentId },
    assignments,
  });
  if (view === null) deny();

  return projectView(accompaniment, view);
}

/** Lista los acompañamientos propios del Estudiante, paginado. */
export async function listOwnedAccompanimentsUseCase(
  ctx: QueryCtx,
  identity: UserIdentity | null,
  args: { readonly paginationOpts: PaginationOptions },
) {
  const profile = await requireAuthorizedProfile(ctx, identity);
  if (listingScopeForRole(profile.role).kind !== "owned") deny();

  const result = await paginateOwnedAccompaniments(ctx, profile._id, args.paginationOpts);
  const views: AccompanimentViewResult[] = [];
  for (const accompaniment of result.page) {
    const view = authorizeAccompanimentRead({
      profile: toAuthorizableProfile(profile),
      accompaniment: { _id: accompaniment._id, studentId: accompaniment.studentId },
      assignments: [],
    });
    if (view !== null) views.push(projectView(accompaniment, view));
  }
  return { ...result, page: views };
}

export type AssignedListResult = {
  readonly items: AccompanimentViewResult[];
  readonly hasMore: boolean;
  readonly lastId: Id<"accompaniments"> | null;
};

/**
 * Lista los acompañamientos asignados al Profesional o Practicante con
 * paginación keyset sobre el acompañamiento. El índice ordena por esa
 * columna, así que las filas duplicadas quedan adyacentes y el cursor las
 * excluye enteras: a diferencia de paginar filas y deduplicar por invocación,
 * ningún duplicado puede repetirse en otra página ni consumir su espacio.
 * Estudiante y Administrador reciben denegación.
 */
export async function listAssignedAccompanimentsUseCase(
  ctx: QueryCtx,
  identity: UserIdentity | null,
  args: { readonly limit: number; readonly after?: Id<"accompaniments"> },
): Promise<AssignedListResult> {
  const profile = await requireAuthorizedProfile(ctx, identity);
  const scope = listingScopeForRole(profile.role);
  if (scope.kind !== "assigned") deny();
  if (!Number.isFinite(args.limit)) deny();

  const limit = Math.min(Math.max(Math.floor(args.limit), 1), 100);
  const seen = new Map<string, Doc<"accompaniments">>();
  let cursor: Id<"accompaniments"> | undefined = args.after;
  let scanned: Id<"accompaniments"> | undefined = undefined;
  let exhausted = false;
  for (let round = 0; round < 10 && seen.size <= limit; round++) {
    const rows = await queryAssignedRowsAfter(ctx, {
      userId: profile._id,
      assignedRole: scope.assignedRole,
      cursor,
      take: 51,
    });
    if (rows.length === 0) {
      exhausted = true;
      break;
    }
    for (const row of rows) {
      if (seen.has(row.accompanimentId)) continue;
      const accompaniment = await getAccompanimentById(ctx, row.accompanimentId);
      if (accompaniment === null) continue;
      seen.set(row.accompanimentId, accompaniment);
    }
    cursor = rows[rows.length - 1].accompanimentId;
    scanned = cursor;
    if (rows.length < 51) {
      exhausted = true;
      break;
    }
  }

  const distinct = [...seen.values()];
  const views: AccompanimentViewResult[] = [];
  for (const accompaniment of distinct.slice(0, limit)) {
    const assignments = toAuthorizableAssignments(
      await findActiveAssignmentsForUser(ctx, accompaniment._id, profile._id),
    );
    const view = authorizeAccompanimentRead({
      profile: toAuthorizableProfile(profile),
      accompaniment: { _id: accompaniment._id, studentId: accompaniment.studentId },
      assignments,
    });
    if (view !== null) views.push(projectView(accompaniment, view));
  }
  const last = views[views.length - 1];
  return {
    items: views,
    hasMore: distinct.length > limit || !exhausted,
    // Cursor de avance independiente de lo devuelto: si todo lo barrido
    // fueron referencias a acompañamientos borrados, `items` viene vacío
    // pero el consumidor igual avanza con lo barrido en vez de ciclarse.
    lastId: last === undefined ? (scanned ?? null) : last._id,
  };
}

export type InternalNoteResult = {
  readonly _id: Id<"followUpNotes">;
  readonly accompanimentId: Id<"accompaniments">;
  readonly body: string;
};

/**
 * Lee notas internas breves, paginadas. Solo Profesional con asignación
 * activa. Estudiante, Practicante y Administrador siempre reciben
 * denegación.
 */
export async function getInternalNotesUseCase(
  ctx: QueryCtx,
  identity: UserIdentity | null,
  args: {
    readonly accompanimentId: Id<"accompaniments">;
    readonly paginationOpts: PaginationOptions;
  },
) {
  const profile = await requireAuthorizedProfile(ctx, identity);

  const accompaniment = await getAccompanimentById(ctx, args.accompanimentId);
  if (accompaniment === null) deny();

  const assignments = toAuthorizableAssignments(
    await findActiveAssignmentsForUser(ctx, args.accompanimentId, profile._id),
  );
  const allowed = authorizeInternalNoteRead({
    profile: toAuthorizableProfile(profile),
    accompaniment: { _id: accompaniment._id, studentId: accompaniment.studentId },
    assignments,
  });
  if (!allowed) deny();

  const result = await paginateInternalNotes(ctx, args.accompanimentId, args.paginationOpts);
  const page: InternalNoteResult[] = result.page.map((note) => ({
    _id: note._id,
    accompanimentId: note.accompanimentId,
    body: note.body,
  }));
  return { ...result, page };
}

/** Tope de profesionales que se ofrecen para asignar; `assignableComplete` avisa si hay más. */
export const MAX_ASSIGNABLE_PROFESSIONALS = 100;

export type AccompanimentProfessional = {
  readonly userId: Id<"users">;
  readonly fullName: string;
};

export type AssignedProfessional = AccompanimentProfessional & {
  /** `asignadoEn` de ASIGNACIONES_PROFESIONALES; falta en filas anteriores a TI2-140. */
  readonly assignedAt?: number;
  /** La asignación es de quien consulta. */
  readonly isCaller: boolean;
};

export type AccompanimentProfessionals = {
  readonly assigned: readonly AssignedProfessional[];
  readonly assignable: readonly AccompanimentProfessional[];
  readonly assignableComplete: boolean;
};

const byName = (a: AccompanimentProfessional, b: AccompanimentProfessional) =>
  a.fullName.localeCompare(b.fullName, "es");

/**
 * Profesionales del acompañamiento para cambiarlos (TI2-165).
 *
 * Solo un profesional de personal, habilitado y vigente, con asignación
 * profesional activa sobre ese acompañamiento: la misma regla que exige
 * `assignAccompanimentAccess` para conceder. Entrega los asignados
 * (ASIGNACIONES_PROFESIONALES del MER) y los profesionales de personal
 * habilitados que todavía no lo están, con su nombre (`nombre` de USUARIOS),
 * sin correo ni otros datos. Cualquier otro caso responde `unauthorized`
 * genérico; un acompañamiento con más asignaciones que el tope responde
 * `conflict` en vez de una lista incompleta.
 */
export async function listAccompanimentProfessionalsUseCase(
  ctx: QueryCtx,
  identity: UserIdentity | null,
  args: { readonly accompanimentId: Id<"accompaniments"> },
): Promise<ApiResult<AccompanimentProfessionals>> {
  if (identity === null) return errResult(unauthorizedError());
  const caller = await findProfileByTokenIdentifier(ctx, identity.tokenIdentifier);
  if (caller === null || !isPersonalProfessionalActive(caller)) {
    return errResult(unauthorizedError());
  }
  const accompaniment = await getAccompanimentById(ctx, args.accompanimentId);
  if (accompaniment === null) return errResult(unauthorizedError());
  const own = await findActiveAssignmentsForUser(ctx, args.accompanimentId, caller._id);
  if (!own.some((row) => row.assignedRole === "professional")) {
    return errResult(unauthorizedError());
  }

  const rows = await listActiveProfessionalAssignments(ctx, args.accompanimentId);
  if (rows === null) {
    return errResult({
      code: CONFLICT_ERROR_CODE,
      message: "El acompañamiento tiene demasiadas asignaciones para mostrarlas completas.",
    });
  }
  const assigned: AssignedProfessional[] = [];
  for (const row of rows) {
    const user = await getUserById(ctx, row.userId);
    if (user === null) continue;
    assigned.push({
      userId: user._id,
      fullName: user.fullName,
      ...(row.grantedAt === undefined ? {} : { assignedAt: row.grantedAt }),
      isCaller: user._id === caller._id,
    });
  }

  const assignedIds = new Set<string>(assigned.map((item) => item.userId));
  const profiles = await takeProfessionalProfiles(ctx, MAX_ASSIGNABLE_PROFESSIONALS);
  const assignable = profiles
    .slice(0, MAX_ASSIGNABLE_PROFESSIONALS)
    .filter((user) => isPersonalProfessionalActive(user) && !assignedIds.has(user._id))
    .map((user) => ({ userId: user._id, fullName: user.fullName }));

  return okResult({
    assigned: assigned.sort(byName),
    assignable: assignable.sort(byName),
    assignableComplete: profiles.length <= MAX_ASSIGNABLE_PROFESSIONALS,
  });
}
