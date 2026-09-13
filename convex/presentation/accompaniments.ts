import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import {
  AUTHORIZATION_DENIED_MESSAGE,
  authorizeAccompanimentRead,
  authorizeInternalNoteRead,
  listingScopeForRole,
  type AuthorizableAssignment,
} from "../application/authorization/authorize";
import type { Doc } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";

/**
 * Borde de Presentación: acompañamientos con autorización en Backend (S2).
 *
 * Adaptador delgado: valida la entrada, resuelve la identidad en el servidor
 * con `ctx.auth.getUserIdentity()`, vincula el perfil por `tokenIdentifier`,
 * exige cuenta habilitada y vigente, y delega cada decisión en
 * Aplicación/Dominio. Nunca acepta un `userId` del cliente como prueba ni
 * decide accesos por rol directamente.
 *
 * Toda denegación (sin identidad, sin perfil, cuenta inhabilitada, fuera de
 * alcance, acompañamiento inexistente o acceso general de Administrador)
 * responde con el mismo error genérico, sin exponer el motivo ni la
 * existencia del recurso. Los listados se paginan: nunca se truncan en
 * silencio.
 */

const fullAccompanimentValidator = v.object({
  _id: v.id("accompaniments"),
  studentId: v.id("users"),
  status: v.union(v.literal("active"), v.literal("paused"), v.literal("closed")),
  objective: v.string(),
  accessNeeds: v.string(),
  view: v.literal("full"),
});

const minimizedAccompanimentValidator = v.object({
  _id: v.id("accompaniments"),
  status: v.union(v.literal("active"), v.literal("paused"), v.literal("closed")),
  objective: v.string(),
  view: v.literal("minimized"),
});

const accompanimentViewValidator = v.union(
  fullAccompanimentValidator,
  minimizedAccompanimentValidator,
);

const internalNoteValidator = v.object({
  _id: v.id("followUpNotes"),
  accompanimentId: v.id("accompaniments"),
  body: v.string(),
});

function deny(): never {
  throw new ConvexError(AUTHORIZATION_DENIED_MESSAGE);
}

async function requireProfile(ctx: QueryCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) deny();
  const profile = await ctx.db
    .query("users")
    .withIndex("by_token_identifier", (q) =>
      q.eq("tokenIdentifier", identity?.tokenIdentifier ?? ""),
    )
    .unique();
  if (profile === null) deny();
  if (profile.institutionalStatus !== "enabled" || profile.accountStatus !== "active") deny();
  return profile;
}

/**
 * Presencia de asignación activa exacta: una fila basta para decidir, por lo
 * que la lectura queda acotada a una fila por rol en vez de ilimitada.
 */
async function activeAssignmentsFor(
  ctx: QueryCtx,
  accompanimentId: Doc<"accompaniments">["_id"],
  userId: Doc<"users">["_id"],
): Promise<AuthorizableAssignment[]> {
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
  return [...professional, ...intern].map((assignment) => ({
    accompanimentId: assignment.accompanimentId,
    userId: assignment.userId,
    assignedRole: assignment.assignedRole,
    status: assignment.status,
  }));
}

function projectView(
  accompaniment: Doc<"accompaniments">,
  view: "full" | "minimized",
):
  | {
      _id: Doc<"accompaniments">["_id"];
      studentId: Doc<"users">["_id"];
      status: Doc<"accompaniments">["status"];
      objective: string;
      accessNeeds: string;
      view: "full";
    }
  | {
      _id: Doc<"accompaniments">["_id"];
      status: Doc<"accompaniments">["status"];
      objective: string;
      view: "minimized";
    } {
  if (view === "minimized") {
    return {
      _id: accompaniment._id,
      status: accompaniment.status,
      objective: accompaniment.objective,
      view: "minimized" as const,
    };
  }
  return {
    _id: accompaniment._id,
    studentId: accompaniment.studentId,
    status: accompaniment.status,
    objective: accompaniment.objective,
    accessNeeds: accompaniment.accessNeeds,
    view: "full" as const,
  };
}

function toAuthorizableProfile(profile: Doc<"users">) {
  return {
    _id: profile._id,
    role: profile.role,
    institutionalStatus: profile.institutionalStatus,
    accountStatus: profile.accountStatus,
  };
}

/**
 * Lee un acompañamiento con vista completa o minimizada según el rol.
 * El Administrador siempre recibe denegación, sin acceso general.
 */
export const getAccompaniment = query({
  args: { accompanimentId: v.id("accompaniments") },
  returns: accompanimentViewValidator,
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);

    const accompaniment = await ctx.db.get(args.accompanimentId);
    if (accompaniment === null) deny();

    const assignments = await activeAssignmentsFor(ctx, args.accompanimentId, profile._id);

    const view = authorizeAccompanimentRead({
      profile: toAuthorizableProfile(profile),
      accompaniment: { _id: accompaniment._id, studentId: accompaniment.studentId },
      assignments,
    });
    if (view === null) deny();

    return projectView(accompaniment, view);
  },
});

/**
 * Lista solo el alcance autorizado del llamante, paginado.
 * Estudiante: propios. Profesional/Practicante: asignados activos en su rol.
 * Administrador: denegado, sin listado general.
 */
export const listMyAccompaniments = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(accompanimentViewValidator),
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const scope = listingScopeForRole(profile.role);
    if (scope.kind === "denied") deny();

    if (scope.kind === "owned") {
      const result = await ctx.db
        .query("accompaniments")
        .withIndex("by_student", (q) => q.eq("studentId", profile._id))
        .paginate(args.paginationOpts);
      const views: Array<ReturnType<typeof projectView>> = [];
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

    const result = await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_user_and_status_and_assigned_role", (q) =>
        q.eq("userId", profile._id).eq("status", "active").eq("assignedRole", scope.assignedRole),
      )
      .paginate(args.paginationOpts);
    const seen = new Map<string, Doc<"accompaniments">>();
    for (const assignment of result.page) {
      const key = assignment.accompanimentId;
      if (seen.has(key)) continue;
      const accompaniment = await ctx.db.get(assignment.accompanimentId);
      if (accompaniment === null) continue;
      seen.set(key, accompaniment);
    }
    const views: Array<ReturnType<typeof projectView>> = [];
    for (const accompaniment of seen.values()) {
      const assignments = await activeAssignmentsFor(ctx, accompaniment._id, profile._id);
      const view = authorizeAccompanimentRead({
        profile: toAuthorizableProfile(profile),
        accompaniment: { _id: accompaniment._id, studentId: accompaniment.studentId },
        assignments,
      });
      if (view !== null) views.push(projectView(accompaniment, view));
    }
    return { ...result, page: views };
  },
});

/**
 * Lee notas internas breves, paginadas. Solo Profesional con asignación
 * activa. Estudiante, Practicante y Administrador siempre reciben
 * denegación.
 */
export const getInternalNotes = query({
  args: { accompanimentId: v.id("accompaniments"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(internalNoteValidator),
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);

    const accompaniment = await ctx.db.get(args.accompanimentId);
    if (accompaniment === null) deny();

    const assignments = await activeAssignmentsFor(ctx, args.accompanimentId, profile._id);

    const allowed = authorizeInternalNoteRead({
      profile: toAuthorizableProfile(profile),
      accompaniment: { _id: accompaniment._id, studentId: accompaniment.studentId },
      assignments,
    });
    if (!allowed) deny();

    const result = await ctx.db
      .query("followUpNotes")
      .withIndex("by_accompaniment", (q) => q.eq("accompanimentId", args.accompanimentId))
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map((note) => ({
        _id: note._id,
        accompanimentId: note.accompanimentId,
        body: note.body,
      })),
    };
  },
});
