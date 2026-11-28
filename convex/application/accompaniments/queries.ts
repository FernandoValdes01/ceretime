import type { PaginationOptions, UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  authorizeAccompanimentRead,
  deniedPublicError,
  authorizeInternalNoteRead,
  listingScopeForRole,
  type AuthorizableAssignment,
} from "../authorization/authorize";
import {
  toAccompanimentProjection,
  type AccompanimentProjection,
  type AccompanimentView,
} from "../../domain/accompaniments/accompaniment";
import type { AccompanimentReadStore } from "./ports";

/**
 * Casos de uso de lectura de acompañamientos (S2).
 *
 * Capa de Aplicación: recibe la identidad ya resuelta en Presentación con
 * `ctx.auth.getUserIdentity()`, carga el perfil y los datos por el puerto
 * `AccompanimentReadStore`, y delega cada decisión en Dominio. Nunca acepta un
 * `userId` del cliente como prueba: el llamante siempre sale del perfil
 * vinculado al `tokenIdentifier` del servidor.
 *
 * Toda denegación (sin identidad, sin perfil, cuenta inhabilitada, fuera de
 * alcance, acompañamiento inexistente o acceso general de Administrador)
 * lanza el mismo `{ code: "unauthorized", message: "No autorizado" }` del
 * contrato común (TI2-88), sin exponer el motivo ni la existencia del recurso.
 * Hasta TI4-84 la denegación viajaba como texto en `error.data`. Opera con
 * datos ficticios.
 */

function deny(): never {
  throw new ConvexError({ ...deniedPublicError() });
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
  store: AccompanimentReadStore,
  identity: UserIdentity | null,
): Promise<Doc<"users">> {
  if (identity === null) deny();
  const profile = await store.findProfileByTokenIdentifier(identity?.tokenIdentifier ?? "");
  if (profile === null) deny();
  if (profile.institutionalStatus !== "enabled" || profile.accountStatus !== "active") deny();
  return profile;
}

/**
 * Lee un acompañamiento con vista completa o minimizada según el rol.
 * El Administrador siempre recibe denegación, sin acceso general.
 */
export async function getAccompanimentDetail(
  store: AccompanimentReadStore,
  identity: UserIdentity | null,
  args: { readonly accompanimentId: Id<"accompaniments"> },
): Promise<AccompanimentViewResult> {
  const profile = await requireAuthorizedProfile(store, identity);

  const accompaniment = await store.getAccompanimentById(args.accompanimentId);
  if (accompaniment === null) deny();

  const assignments = toAuthorizableAssignments(
    await store.findActiveAssignmentsForUser(args.accompanimentId, profile._id),
  );
  const view = authorizeAccompanimentRead({
    profile: toAuthorizableProfile(profile),
    accompaniment: { _id: accompaniment._id, studentId: accompaniment.studentId },
    assignments,
  });
  if (view === null) deny();

  return projectView(accompaniment, view);
}

/**
 * Lista los acompañamientos propios del Estudiante, paginado. Con `status`
 * solo trae los de ese estado (TI4-84); sin él, todos, como antes.
 */
export async function listOwnedAccompanimentsUseCase(
  store: AccompanimentReadStore,
  identity: UserIdentity | null,
  args: {
    readonly paginationOpts: PaginationOptions;
    readonly status?: Doc<"accompaniments">["status"];
  },
) {
  const profile = await requireAuthorizedProfile(store, identity);
  if (listingScopeForRole(profile.role).kind !== "owned") deny();

  const result = await store.paginateOwnedAccompaniments(
    profile._id,
    args.paginationOpts,
    args.status,
  );
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
  store: AccompanimentReadStore,
  identity: UserIdentity | null,
  args: { readonly limit: number; readonly after?: Id<"accompaniments"> },
): Promise<AssignedListResult> {
  const profile = await requireAuthorizedProfile(store, identity);
  const scope = listingScopeForRole(profile.role);
  if (scope.kind !== "assigned") deny();
  if (!Number.isFinite(args.limit)) deny();

  const limit = Math.min(Math.max(Math.floor(args.limit), 1), 100);
  const seen = new Map<string, Doc<"accompaniments">>();
  let cursor: Id<"accompaniments"> | undefined = args.after;
  let scanned: Id<"accompaniments"> | undefined = undefined;
  let exhausted = false;
  for (let round = 0; round < 10 && seen.size <= limit; round++) {
    const rows = await store.queryAssignedRowsAfter({
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
      const accompaniment = await store.getAccompanimentById(row.accompanimentId);
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
      await store.findActiveAssignmentsForUser(accompaniment._id, profile._id),
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
  store: AccompanimentReadStore,
  identity: UserIdentity | null,
  args: {
    readonly accompanimentId: Id<"accompaniments">;
    readonly paginationOpts: PaginationOptions;
  },
) {
  const profile = await requireAuthorizedProfile(store, identity);

  const accompaniment = await store.getAccompanimentById(args.accompanimentId);
  if (accompaniment === null) deny();

  const assignments = toAuthorizableAssignments(
    await store.findActiveAssignmentsForUser(args.accompanimentId, profile._id),
  );
  const allowed = authorizeInternalNoteRead({
    profile: toAuthorizableProfile(profile),
    accompaniment: { _id: accompaniment._id, studentId: accompaniment.studentId },
    assignments,
  });
  if (!allowed) deny();

  const result = await store.paginateInternalNotes(args.accompanimentId, args.paginationOpts);
  const page: InternalNoteResult[] = result.page.map((note) => ({
    _id: note._id,
    accompanimentId: note.accompanimentId,
    body: note.body,
  }));
  return { ...result, page };
}
