import { ConvexError, v } from "convex/values";
import {
  AUTHORIZATION_DENIED_MESSAGE,
  authorizeAccompanimentRead,
  authorizeInternalNoteRead,
} from "../application/authorization/authorize";
import type { Doc } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";

/**
 * Borde de Presentación: acompañamientos con autorización en Backend (S2).
 *
 * Cada función valida la entrada, resuelve la identidad en el servidor con
 * `ctx.auth.getUserIdentity()`, vincula el perfil por `tokenIdentifier`,
 * exige cuenta habilitada y vigente, y delega la decisión en
 * Aplicación/Dominio. Nunca acepta un `userId` del cliente como prueba.
 *
 * Toda denegación (sin identidad, sin perfil, cuenta inhabilitada, fuera de
 * alcance, acompañamiento inexistente o acceso general de Administrador)
 * responde con el mismo error genérico, sin exponer el motivo ni la
 * existencia del recurso.
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

    const assignments = await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_accompaniment_and_user", (q) =>
        q.eq("accompanimentId", args.accompanimentId).eq("userId", profile._id),
      )
      .collect();

    const view = authorizeAccompanimentRead({
      profile: {
        _id: profile._id,
        role: profile.role,
        institutionalStatus: profile.institutionalStatus,
        accountStatus: profile.accountStatus,
      },
      accompaniment: { _id: accompaniment._id, studentId: accompaniment.studentId },
      assignments: assignments.map((assignment) => ({
        accompanimentId: assignment.accompanimentId,
        userId: assignment.userId,
        assignedRole: assignment.assignedRole,
        status: assignment.status,
      })),
    });
    if (view === null) deny();

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
  },
});

/**
 * Lista solo el alcance autorizado del llamante.
 * Estudiante: propios. Profesional/Practicante: asignados activos.
 * Administrador: denegado, sin listado general.
 */
export const listMyAccompaniments = query({
  args: {},
  returns: v.array(accompanimentViewValidator),
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);

    if (profile.role === "admin") deny();

    if (profile.role === "student") {
      const owned = await ctx.db
        .query("accompaniments")
        .withIndex("by_student", (q) => q.eq("studentId", profile._id))
        .take(50);
      return owned.map((accompaniment) => ({
        _id: accompaniment._id,
        studentId: accompaniment.studentId,
        status: accompaniment.status,
        objective: accompaniment.objective,
        accessNeeds: accompaniment.accessNeeds,
        view: "full" as const,
      }));
    }

    const assignments = await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_user", (q) => q.eq("userId", profile._id))
      .take(50);
    const activeForRole = assignments.filter(
      (assignment) =>
        assignment.status === "active" &&
        ((profile.role === "professional" && assignment.assignedRole === "professional") ||
          (profile.role === "intern" && assignment.assignedRole === "intern")),
    );

    const views: Array<
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
        }
    > = [];
    for (const assignment of activeForRole) {
      const accompaniment = await ctx.db.get(assignment.accompanimentId);
      if (accompaniment === null) continue;
      if (profile.role === "intern") {
        views.push({
          _id: accompaniment._id,
          status: accompaniment.status,
          objective: accompaniment.objective,
          view: "minimized" as const,
        });
      } else {
        views.push({
          _id: accompaniment._id,
          studentId: accompaniment.studentId,
          status: accompaniment.status,
          objective: accompaniment.objective,
          accessNeeds: accompaniment.accessNeeds,
          view: "full" as const,
        });
      }
    }
    return views;
  },
});

/**
 * Lee notas internas breves. Solo Profesional con asignación activa.
 * Estudiante, Practicante y Administrador siempre reciben denegación.
 */
export const getInternalNotes = query({
  args: { accompanimentId: v.id("accompaniments") },
  returns: v.array(
    v.object({
      _id: v.id("followUpNotes"),
      accompanimentId: v.id("accompaniments"),
      body: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);

    const accompaniment = await ctx.db.get(args.accompanimentId);
    if (accompaniment === null) deny();

    const assignments = await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_accompaniment_and_user", (q) =>
        q.eq("accompanimentId", args.accompanimentId).eq("userId", profile._id),
      )
      .collect();

    const allowed = authorizeInternalNoteRead({
      profile: {
        _id: profile._id,
        role: profile.role,
        institutionalStatus: profile.institutionalStatus,
        accountStatus: profile.accountStatus,
      },
      accompaniment: { _id: accompaniment._id, studentId: accompaniment.studentId },
      assignments: assignments.map((assignment) => ({
        accompanimentId: assignment.accompanimentId,
        userId: assignment.userId,
        assignedRole: assignment.assignedRole,
        status: assignment.status,
      })),
    });
    if (!allowed) deny();

    const notes = await ctx.db
      .query("followUpNotes")
      .withIndex("by_accompaniment", (q) => q.eq("accompanimentId", args.accompanimentId))
      .take(50);
    return notes.map((note) => ({
      _id: note._id,
      accompanimentId: note.accompanimentId,
      body: note.body,
    }));
  },
});
