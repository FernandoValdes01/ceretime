import type { PaginationOptions } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  toProfessionalAssignmentHolder,
  type ProfessionalAssignmentHolder,
} from "../../domain/accompaniments/accompaniment";
import { isAssignmentWithinValidity } from "../../domain/accompaniments/practitioner_assignment";
import { accessNeedsFromLines } from "../spaces/repository";

/**
 * Repositorio de acompañamientos (S2).
 *
 * Capa de Infraestructura: único lugar que toca `ctx.db` en el flujo de
 * acompañamientos y asignaciones. No decide autorización ni resuelve
 * identidad; solo persiste/recupera con los índices declarados en
 * `convex/schema.ts`, consultando los campos en el orden del índice.
 *
 * Opera con datos ficticios.
 */

/** Contexto con lectura de base de datos (consultas y mutaciones). */
type DbReader = QueryCtx | MutationCtx;

/** Perfil vinculado a la identidad autenticada, o `null` si no existe. */
export async function findProfileByTokenIdentifier(
  ctx: DbReader,
  tokenIdentifier: string,
): Promise<Doc<"users"> | null> {
  return await ctx.db
    .query("users")
    .withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", tokenIdentifier))
    .unique();
}

/** Acompañamiento por id, o `null` si no existe. */
export async function getAccompanimentById(
  ctx: DbReader,
  accompanimentId: Id<"accompaniments">,
): Promise<Doc<"accompaniments"> | null> {
  return await ctx.db.get(accompanimentId);
}

/**
 * Acompañamiento abierto desde la solicitud, o `null` si aún no se aceptó.
 * La vía guardada crea como máximo uno por solicitud; basta una fila para
 * decidir sin lecturas ilimitadas.
 */
export async function findAccompanimentByRequest(
  ctx: DbReader,
  requestId: Id<"requests">,
): Promise<Doc<"accompaniments"> | null> {
  const rows = await ctx.db
    .query("accompaniments")
    .withIndex("by_request", (q) => q.eq("requestId", requestId))
    .take(1);
  return rows[0] ?? null;
}

/**
 * Abre el acompañamiento en estado `active` vinculado a su solicitud de
 * origen. Solo persistencia: la unicidad la garantiza la vía guardada de
 * aceptación (TI2-24) al comprobar y crear en la misma transacción.
 */
export async function insertAccompaniment(
  ctx: MutationCtx,
  input: {
    readonly studentId: Id<"users">;
    readonly objective: string;
    readonly accessNeeds: string;
    readonly requestId: Id<"requests">;
  },
) {
  return await ctx.db.insert("accompaniments", { ...input, status: "active" });
}

/** Usuario por id, o `null` si no existe. */
export async function getUserById(
  ctx: DbReader,
  userId: Id<"users">,
): Promise<Doc<"users"> | null> {
  return await ctx.db.get(userId);
}

/**
 * Filas de asignación para la terna exacta (acompañamiento, usuario), una
 * como máximo por rol. Basta para decidir sin lecturas ilimitadas. Solo
 * devuelve las vigentes: una fila con `status === "active"` pero fuera de la
 * ventana acordada (`validFrom`/`validUntil`, TI2-140) no autoriza, igual que
 * una revocada. La política vive en
 * `domain/accompaniments/practitioner_assignment.ts`; acá solo se aplica al
 * leer para que todas las consultas compartan la misma vigencia.
 */
export async function findActiveAssignmentsForUser(
  ctx: DbReader,
  accompanimentId: Id<"accompaniments">,
  userId: Id<"users">,
  now: number = Date.now(),
): Promise<Doc<"accompanimentAssignments">[]> {
  const professional = await ctx.db
    .query("accompanimentAssignments")
    .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
      q
        .eq("accompanimentId", accompanimentId)
        .eq("userId", userId)
        .eq("status", "active")
        .eq("assignedRole", "professional"),
    )
    .take(1);
  const intern = await ctx.db
    .query("accompanimentAssignments")
    .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
      q
        .eq("accompanimentId", accompanimentId)
        .eq("userId", userId)
        .eq("status", "active")
        .eq("assignedRole", "intern"),
    )
    .take(1);
  return [...professional, ...intern].filter((row) => isAssignmentWithinValidity(row, now));
}

/** Página de acompañamientos propios del estudiante. */
export async function paginateOwnedAccompaniments(
  ctx: DbReader,
  studentId: Id<"users">,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("accompaniments")
    .withIndex("by_student", (q) => q.eq("studentId", studentId))
    .paginate(paginationOpts);
}

/**
 * Ventana del listado asignado con paginación keyset sobre el
 * acompañamiento. El índice ordena por esa columna, así que las filas
 * duplicadas quedan adyacentes y el cursor las excluye enteras. Solo
 * devuelve filas vigentes (TI2-140): las vencidas se barren igual para no
 * romper el cursor, pero no aparecen.
 */
export async function queryAssignedRowsAfter(
  ctx: DbReader,
  input: {
    readonly userId: Id<"users">;
    readonly assignedRole: "professional" | "intern";
    readonly cursor: Id<"accompaniments"> | undefined;
    readonly take: number;
    readonly now?: number;
  },
) {
  const rows = await ctx.db
    .query("accompanimentAssignments")
    .withIndex("by_user_and_status_and_assigned_role_and_accompaniment", (q) => {
      const ranged = q
        .eq("userId", input.userId)
        .eq("status", "active")
        .eq("assignedRole", input.assignedRole);
      return input.cursor === undefined ? ranged : ranged.gt("accompanimentId", input.cursor);
    })
    .order("asc")
    .take(input.take);
  const now = input.now ?? Date.now();
  return rows.filter((row) => isAssignmentWithinValidity(row, now));
}

/** Página de notas internas del acompañamiento. */
export async function paginateInternalNotes(
  ctx: DbReader,
  accompanimentId: Id<"accompaniments">,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("followUpNotes")
    .withIndex("by_accompaniment", (q) => q.eq("accompanimentId", accompanimentId))
    .paginate(paginationOpts);
}

/**
 * Crea la nota interna breve del acompañamiento (TI2-118). `followUpNotes`
 * sigue siendo la única tabla de notas internas: el registro de seguimiento
 * guarda solo la referencia que devuelve esta función, nunca el texto.
 */
export async function insertInternalNote(
  ctx: MutationCtx,
  input: {
    readonly accompanimentId: Id<"accompaniments">;
    readonly authorId: Id<"users">;
    readonly body: string;
  },
): Promise<Id<"followUpNotes">> {
  return await ctx.db.insert("followUpNotes", { ...input });
}

export type AssignmentTriple = {
  readonly accompanimentId: Id<"accompaniments">;
  readonly userId: Id<"users">;
  readonly assignedRole: "professional" | "intern";
};

/** Fila activa exacta de la terna, si existe. */
export async function findExistingActiveAssignment(
  ctx: MutationCtx,
  triple: AssignmentTriple,
): Promise<Doc<"accompanimentAssignments"> | null> {
  const rows = await ctx.db
    .query("accompanimentAssignments")
    .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
      q
        .eq("accompanimentId", triple.accompanimentId)
        .eq("userId", triple.userId)
        .eq("status", "active")
        .eq("assignedRole", triple.assignedRole),
    )
    .take(1);
  return rows[0] ?? null;
}

/**
 * Verdadero cuando el usuario tiene asignación profesional activa y vigente
 * sobre el acompañamiento (TI2-28, TI2-140). Chequeo de presencia exacto: una
 * fila basta para decidir, sin lecturas ilimitadas. Una fila vencida no
 * autoriza, igual que una revocada.
 */
export async function hasActiveProfessionalAssignment(
  ctx: MutationCtx,
  input: {
    readonly accompanimentId: Id<"accompaniments">;
    readonly userId: Id<"users">;
  },
  now: number = Date.now(),
): Promise<boolean> {
  const rows = await ctx.db
    .query("accompanimentAssignments")
    .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
      q
        .eq("accompanimentId", input.accompanimentId)
        .eq("userId", input.userId)
        .eq("status", "active")
        .eq("assignedRole", "professional"),
    )
    .take(1);
  return rows.some((row) => isAssignmentWithinValidity(row, now));
}

/**
 * Crea la fila activa de la combinación, registrando quién concede y cuándo.
 * La vigencia es opcional (TI2-138): `validFrom`/`validUntil` solo se escriben
 * si quien llama los entrega. La lectura exige `status === "active"` y ventana
 * vigente (TI2-140).
 */
export async function insertActiveAssignment(
  ctx: MutationCtx,
  triple: AssignmentTriple,
  grantedBy: Id<"users">,
  validity?: { readonly validFrom?: number; readonly validUntil?: number },
) {
  return await ctx.db.insert("accompanimentAssignments", {
    ...triple,
    status: "active",
    grantedBy,
    grantedAt: Date.now(),
    ...(validity?.validFrom === undefined ? {} : { validFrom: validity.validFrom }),
    ...(validity?.validUntil === undefined ? {} : { validUntil: validity.validUntil }),
  });
}

/** Lote de filas activas de la terna para revocación. */
export async function takeActiveTripleRows(
  ctx: MutationCtx,
  triple: AssignmentTriple,
  take: number,
) {
  return await ctx.db
    .query("accompanimentAssignments")
    .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
      q
        .eq("accompanimentId", triple.accompanimentId)
        .eq("userId", triple.userId)
        .eq("status", "active")
        .eq("assignedRole", triple.assignedRole),
    )
    .take(take);
}

/** Fila de asignación por id, o `null` si no existe. */
export async function getAssignmentById(
  ctx: MutationCtx,
  assignmentId: Id<"accompanimentAssignments">,
): Promise<Doc<"accompanimentAssignments"> | null> {
  return await ctx.db.get(assignmentId);
}

/** Marca una fila de asignación como revocada, registrando quién revoca y cuándo. */
export async function revokeAssignmentRow(
  ctx: MutationCtx,
  assignmentId: Id<"accompanimentAssignments">,
  revokedBy: Id<"users">,
) {
  await ctx.db.patch(assignmentId, {
    status: "revoked",
    revokedBy,
    revokedAt: Date.now(),
  });
}

/**
 * Revoca la fila por vencimiento de la ventana acordada (TI2-140).
 *
 * Solo persistencia: fija `status` en `revoked` con fecha, sin `revokedBy`
 * porque el actor es el sistema, no una persona. La lectura ya excluía la
 * fila vencida; esto cambia el dato para que las consultas suscritas vuelvan
 * a ejecutarse al vencer, ya que el paso del tiempo por sí solo no invalida
 * la caché de Convex.
 */
export async function expireAssignmentRow(
  ctx: MutationCtx,
  assignmentId: Id<"accompanimentAssignments">,
) {
  await ctx.db.patch(assignmentId, {
    status: "revoked",
    revokedAt: Date.now(),
  });
}

/**
 * Modifica la ventana de vigencia acordada de una fila activa (TI2-140).
 *
 * Solo persistencia: reescribe `validFrom`/`validUntil` sin tocar `status`
 * ni el historial de concesión. `undefined` conserva el extremo actual y
 * `null` lo quita para dejar la asignación sin esa cota; en Convex, un campo
 * con `undefined` en `patch` se elimina, así que una sola escritura basta.
 */
export async function patchAssignmentValidity(
  ctx: MutationCtx,
  assignmentId: Id<"accompanimentAssignments">,
  validity: { readonly validFrom?: number | null; readonly validUntil?: number | null },
) {
  const toField = (value: number | null | undefined): number | undefined =>
    value === null ? undefined : value;
  await ctx.db.patch(assignmentId, {
    ...(validity.validFrom === undefined ? {} : { validFrom: toField(validity.validFrom) }),
    ...(validity.validUntil === undefined ? {} : { validUntil: toField(validity.validUntil) }),
  });
}

/**
 * Lecturas de la autorización de agenda (TI2-86). Cumple por forma el puerto
 * `AuthorizationReader` de Aplicación sin importarlo, para que
 * Infraestructura no dependa de Aplicación. Los identificadores llegan como
 * texto: uno que no pertenece a la tabla responde igual que uno inexistente.
 */
export function authorizationReader(ctx: DbReader) {
  return {
    findProfileByTokenIdentifier: (tokenIdentifier: string) =>
      findProfileByTokenIdentifier(ctx, tokenIdentifier),
    getProfileById: async (userId: string) => {
      const id = ctx.db.normalizeId("users", userId);
      return id === null ? null : await getUserById(ctx, id);
    },
    getAccompaniment: async (accompanimentId: string) => {
      const id = ctx.db.normalizeId("accompaniments", accompanimentId);
      return id === null ? null : await getAccompanimentById(ctx, id);
    },
    findActiveAssignments: async (accompanimentId: string, userId: string) => {
      const accompaniment = ctx.db.normalizeId("accompaniments", accompanimentId);
      const user = ctx.db.normalizeId("users", userId);
      return accompaniment === null || user === null
        ? []
        : await findActiveAssignmentsForUser(ctx, accompaniment, user);
    },
  };
}

/** Tope de asignaciones leídas por acompañamiento, activas o revocadas. */
const MAX_ASSIGNMENTS_PER_ACCOMPANIMENT = 200;

/**
 * Asignaciones profesionales activas y vigentes de un acompañamiento
 * (ASIGNACIONES_PROFESIONALES del MER, TI2-165), o `null` si el acompañamiento
 * supera el tope de filas leídas: así la lista nunca se recorta en silencio.
 */
export async function listActiveProfessionalAssignments(
  ctx: DbReader,
  accompanimentId: Id<"accompaniments">,
  now: number = Date.now(),
): Promise<Doc<"accompanimentAssignments">[] | null> {
  const rows = await ctx.db
    .query("accompanimentAssignments")
    .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
      q.eq("accompanimentId", accompanimentId),
    )
    .take(MAX_ASSIGNMENTS_PER_ACCOMPANIMENT + 1);
  if (rows.length > MAX_ASSIGNMENTS_PER_ACCOMPANIMENT) return null;
  return rows.filter(
    (row) =>
      row.status === "active" &&
      row.assignedRole === "professional" &&
      isAssignmentWithinValidity(row, now),
  );
}

/**
 * Titulares de las asignaciones profesionales vigentes, para decidir si queda
 * quien gestione (`keepsAManagerWithout`, TI2-165). Usa la misma lista que ve
 * la Web, así las dos cuentan igual; `null` sobre el tope de filas leídas.
 */
export async function listProfessionalAssignmentHolders(
  ctx: DbReader,
  accompanimentId: Id<"accompaniments">,
  now: number = Date.now(),
): Promise<ProfessionalAssignmentHolder[] | null> {
  const rows = await listActiveProfessionalAssignments(ctx, accompanimentId, now);
  if (rows === null) return null;
  const holders: ProfessionalAssignmentHolder[] = [];
  for (const row of rows) {
    holders.push(toProfessionalAssignmentHolder(row, await getUserById(ctx, row.userId)));
  }
  return holders;
}

/**
 * Perfiles con rol profesional, hasta `limit` más uno para saber si quedan
 * más. Quien llama decide cuáles se pueden asignar.
 */
export async function takeProfessionalProfiles(
  ctx: DbReader,
  limit: number,
): Promise<Doc<"users">[]> {
  return await ctx.db
    .query("users")
    .withIndex("by_role", (q) => q.eq("role", "professional"))
    .take(limit + 1);
}

/**
 * Usuarios con asignación activa como profesional (puerto
 * `BookableProfessionalSource`, TI2-123). Un identificador de otra tabla
 * responde igual que un acompañamiento sin asignaciones.
 */
export function bookableProfessionalSource(ctx: DbReader) {
  return {
    listActiveProfessionalIds: async (accompanimentId: string) => {
      const id = ctx.db.normalizeId("accompaniments", accompanimentId);
      if (id === null) return [];
      const rows = await ctx.db
        .query("accompanimentAssignments")
        .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
          q.eq("accompanimentId", id),
        )
        .take(MAX_ASSIGNMENTS_PER_ACCOMPANIMENT + 1);
      if (rows.length > MAX_ASSIGNMENTS_PER_ACCOMPANIMENT) return null;
      const active = rows.filter(
        (row) => row.status === "active" && row.assignedRole === "professional",
      );
      return [...new Set(active.map((row) => row.userId as string))];
    },
  };
}

/**
 * Necesidades vigentes del acompañamiento para la búsqueda, la reserva y el
 * reagendamiento (puerto `AccompanimentNeedsReader` de TI2-97), una por línea
 * del texto guardado con `accessNeedsFromLines`. La pertenencia y el estado
 * activo ya los exige la autorización de TI2-86; un identificador de otra tabla
 * responde igual que uno inexistente.
 */
export function accompanimentNeedsReader(ctx: DbReader) {
  return {
    findAccompanimentNeeds: async (accompanimentId: string) => {
      const id = ctx.db.normalizeId("accompaniments", accompanimentId);
      const row = id === null ? null : await getAccompanimentById(ctx, id);
      return row === null ? null : { _id: row._id, needs: accessNeedsFromLines(row.accessNeeds) };
    },
  };
}

/**
 * Acompañamiento abierto por una solicitud, para el puerto
 * `ResultingAccompanimentReader` del detalle de solicitud (TI2-183).
 */
export function resultingAccompanimentReader(ctx: DbReader) {
  return {
    findAccompanimentIdForRequest: async (requestId: Id<"requests">) =>
      (await findAccompanimentByRequest(ctx, requestId))?._id ?? null,
  };
}

/**
 * Apertura del acompañamiento al aceptar una solicitud, para el puerto
 * `AccompanimentOpener` de TI2-181. Inserta el acompañamiento y la asignación
 * inicial del Profesional que acepta con el mismo `ctx`, así quedan en la
 * transacción de la aceptación, y devuelve la fila leída de vuelta: la vista
 * la decide Aplicación.
 */
export function accompanimentOpener(ctx: MutationCtx) {
  return {
    hasAccompanimentForRequest: async (requestId: Id<"requests">) =>
      (await findAccompanimentByRequest(ctx, requestId)) !== null,
    openAccompaniment: async (input: {
      readonly requestId: Id<"requests">;
      readonly studentId: Id<"users">;
      readonly objective: string;
      readonly accessNeeds: string;
      readonly professionalId: Id<"users">;
    }) => {
      const { professionalId, ...opening } = input;
      const accompanimentId = await insertAccompaniment(ctx, opening);
      await insertActiveAssignment(
        ctx,
        { accompanimentId, userId: professionalId, assignedRole: "professional" },
        professionalId,
      );
      const opened = await getAccompanimentById(ctx, accompanimentId);
      if (opened === null) throw new Error("El acompañamiento abierto no quedó guardado.");
      return {
        _id: opened._id,
        studentId: opened.studentId,
        status: opened.status,
        objective: opened.objective,
        accessNeeds: opened.accessNeeds,
        requestId: opened.requestId,
      };
    },
  };
}

/**
 * Escritura del cambio de estado del acompañamiento (TI2-152). Cumple por
 * forma el puerto `AccompanimentStatusWriter` de Aplicación sin importarla.
 * Guarda el estado nuevo y, en un cierre, `closedById`, `closedAt` y
 * `closureReason` en la misma fila, como `cerradoPorId?`, `cerradoEn?` y
 * `motivoCierre?` del MER. Los identificadores ya fueron leídos y autorizados
 * en el servidor: uno que no pertenezca a su tabla es un fallo interno, no un
 * rechazo al cliente.
 */
export function accompanimentStatusWriter(ctx: MutationCtx) {
  return {
    persistStatusChange: async (
      accompanimentId: string,
      change:
        | { readonly to: "active" | "paused" }
        | {
            readonly to: "closed";
            readonly closure: {
              readonly closedById: string;
              readonly closedAt: number;
              readonly closureReason?: string;
            };
          },
    ) => {
      const id = ctx.db.normalizeId("accompaniments", accompanimentId);
      if (id === null) {
        throw new Error("El cambio de estado referencia un acompañamiento inexistente.");
      }
      if (change.to !== "closed") {
        await ctx.db.patch(id, { status: change.to });
        return;
      }
      const closedById = ctx.db.normalizeId("users", change.closure.closedById);
      if (closedById === null) throw new Error("El cierre referencia un actor inexistente.");
      await ctx.db.patch(id, {
        status: "closed",
        closedById,
        closedAt: change.closure.closedAt,
        ...(change.closure.closureReason === undefined
          ? {}
          : { closureReason: change.closure.closureReason }),
      });
    },
  };
}

/**
 * Escritura de necesidades de acceso del acompañamiento (TI2-156). Cumple por
 * forma el puerto `AccompanimentNeedsWriter` sin importarlo. Solo cambia el
 * texto `accessNeeds` para atenciones futuras: las anteriores conservan su
 * fila y no se tocan.
 */
export async function patchAccompanimentAccessNeeds(
  ctx: MutationCtx,
  accompanimentId: string,
  accessNeeds: string,
): Promise<void> {
  const id = ctx.db.normalizeId("accompaniments", accompanimentId);
  if (id === null) {
    throw new Error("La actualización de necesidades referencia un acompañamiento inexistente.");
  }
  await ctx.db.patch(id, { accessNeeds });
}

/**
 * Escritor de necesidades para Aplicación (TI2-156).
 *
 * Guarda la copia vigente en `accompaniments` y versiona en
 * `accompanimentNeeds` (NECESIDADES_ACCESO del MER): cierra la vigente con
 * `validUntil` y crea la nueva con `validFrom` en el instante del cambio.
 */
export function accompanimentNeedsWriter(ctx: MutationCtx) {
  return {
    saveAccessNeeds: async (accompanimentId: string, accessNeeds: string) =>
      await patchAccompanimentAccessNeeds(ctx, accompanimentId, accessNeeds),
    saveVersionedAccessNeeds: async (
      accompanimentId: string,
      accessNeeds: string,
      actorId: string,
      now: number,
    ) => await saveVersionedAccessNeeds(ctx, accompanimentId, accessNeeds, actorId, now),
  };
}

/** Tope de versiones leídas por acompañamiento para decidir la vigente. */
export const MAX_NEED_VERSIONS = 100;

/** Versiones de un acompañamiento ordenadas por vigencia. */
export async function listNeedVersions(
  ctx: DbReader,
  accompanimentId: Id<"accompaniments">,
): Promise<Doc<"accompanimentNeeds">[]> {
  return await ctx.db
    .query("accompanimentNeeds")
    .withIndex("by_accompanimentId_and_validFrom", (q) => q.eq("accompanimentId", accompanimentId))
    .order("asc")
    .take(MAX_NEED_VERSIONS + 1);
}

/** Versión vigente a un instante (exclusivo en `validUntil`). */
export function needVersionAt(
  versions: readonly Doc<"accompanimentNeeds">[],
  at: number,
): Doc<"accompanimentNeeds"> | null {
  let current: Doc<"accompanimentNeeds"> | null = null;
  for (const version of versions) {
    if (version.validFrom <= at && (version.validUntil === undefined || at < version.validUntil)) {
      if (current === null || version.validFrom > current.validFrom) current = version;
    }
  }
  return current;
}

/**
 * Cierra la vigente y crea la nueva versión, además de la copia en
 * `accompaniments`. Si no hay versiones (fila anterior a la migración o
 * semilla sin migrar), crea primero la inicial con el texto vigente antes del
 * cambio (`validFrom: 1`), así las atenciones pasadas se siguen evaluando con
 * lo que regía y no con lo nuevo.
 */
export async function saveVersionedAccessNeeds(
  ctx: MutationCtx,
  accompanimentId: string,
  accessNeeds: string,
  actorId: string,
  now: number,
): Promise<void> {
  const id = ctx.db.normalizeId("accompaniments", accompanimentId);
  const actor = ctx.db.normalizeId("users", actorId);
  if (id === null || actor === null) {
    throw new Error("La actualización versionada referencia un acompañamiento inexistente.");
  }
  const row = await getAccompanimentById(ctx, id);
  if (row === null) {
    throw new Error("La actualización versionada referencia un acompañamiento inexistente.");
  }
  const versions = await listNeedVersions(ctx, id);
  if (versions.length === 0) {
    await ctx.db.insert("accompanimentNeeds", {
      accompanimentId: id,
      accessNeeds: row.accessNeeds,
      validFrom: 1,
      validUntil: now,
      createdBy: actor,
      createdAt: now,
    });
  } else {
    const current = needVersionAt(versions, now);
    if (current !== null && current.validUntil === undefined) {
      await ctx.db.patch(current._id, { validUntil: now });
    }
  }
  await ctx.db.insert("accompanimentNeeds", {
    accompanimentId: id,
    accessNeeds,
    validFrom: now,
    createdBy: actor,
    createdAt: now,
  });
  await ctx.db.patch(id, { accessNeeds });
}

/**
 * Necesidades vigentes a una fecha para evaluar una atención (TI2-156).
 * Cumple por forma el puerto versionado sin importarlo.
 */
export function accompanimentNeedsAtDateReader(ctx: DbReader) {
  return {
    findNeedsAt: async (accompanimentId: string, at: number) => {
      const id = ctx.db.normalizeId("accompaniments", accompanimentId);
      if (id === null) return null;
      const versions = await listNeedVersions(ctx, id);
      if (versions.length > MAX_NEED_VERSIONS) return null;
      const version = needVersionAt(versions, at);
      if (version !== null)
        return { _id: id as string, needs: accessNeedsFromLines(version.accessNeeds) };
      const row = await getAccompanimentById(ctx, id);
      return row === null
        ? null
        : { _id: row._id as string, needs: accessNeedsFromLines(row.accessNeeds) };
    },
  };
}

/**
 * Lecturas de los profesionales de un acompañamiento (puerto
 * `AccompanimentProfessionalsReader`, TI2-165). Un identificador de otra
 * tabla responde igual que uno inexistente.
 */
export function accompanimentProfessionalsReader(ctx: DbReader) {
  return {
    findProfileByTokenIdentifier: (tokenIdentifier: string) =>
      findProfileByTokenIdentifier(ctx, tokenIdentifier),
    getProfile: (userId: Id<"users">) => getUserById(ctx, userId),
    getAccompanimentStatus: async (accompanimentId: string) => {
      const id = ctx.db.normalizeId("accompaniments", accompanimentId);
      if (id === null) return null;
      return (await getAccompanimentById(ctx, id))?.status ?? null;
    },
    hasActiveProfessionalAssignment: async (accompanimentId: string, userId: Id<"users">) => {
      const id = ctx.db.normalizeId("accompaniments", accompanimentId);
      if (id === null) return false;
      const rows = await findActiveAssignmentsForUser(ctx, id, userId);
      return rows.some((row) => row.assignedRole === "professional");
    },
    listActiveProfessionalAssignments: async (accompanimentId: string) => {
      const id = ctx.db.normalizeId("accompaniments", accompanimentId);
      if (id === null) return [];
      const rows = await listActiveProfessionalAssignments(ctx, id);
      if (rows === null) return null;
      return rows.map((row) => ({
        userId: row.userId,
        ...(row.grantedAt === undefined ? {} : { assignedAt: row.grantedAt }),
        ...(row.validUntil === undefined ? {} : { validUntil: row.validUntil }),
      }));
    },
    takeProfessionalProfiles: (limit: number) => takeProfessionalProfiles(ctx, limit),
  };
}
