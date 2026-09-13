import { ConvexError, v } from "convex/values";
import { AUTHORIZATION_DENIED_MESSAGE } from "./application/authorization/authorize";
import { internalMutation } from "./_generated/server";
import { assignmentRoleUnion } from "./validators";

/**
 * Escritura guardada de asignaciones (S2).
 *
 * Única vía de escritura de `accompanimentAssignments`. El llamante debe ser
 * un Profesional con cuenta habilitada y vigente: la identidad se resuelve en
 * el servidor y se propaga a esta interna cuando la invoca el futuro flujo
 * público. El recorte por acompañamiento (asignar solo en los propios) llega
 * con el flujo público de RF-39. Rechaza la fila activa duplicada para la
 * misma combinación de acompañamiento, usuario y rol, sosteniendo el
 * invariante del esquema. Las lecturas además deduplican por
 * `accompanimentId` ante filas heredadas. Opera con datos ficticios.
 */
export const assign = internalMutation({
  args: {
    accompanimentId: v.id("accompaniments"),
    userId: v.id("users"),
    assignedRole: assignmentRoleUnion,
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) throw new ConvexError(AUTHORIZATION_DENIED_MESSAGE);
    const caller = await ctx.db
      .query("users")
      .withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (
      caller === null ||
      caller.role !== "professional" ||
      caller.institutionalStatus !== "enabled" ||
      caller.accountStatus !== "active"
    ) {
      throw new ConvexError(AUTHORIZATION_DENIED_MESSAGE);
    }

    const accompaniment = await ctx.db.get(args.accompanimentId);
    const target = await ctx.db.get(args.userId);
    if (accompaniment === null || target === null) {
      throw new Error("El acompañamiento y el usuario deben existir");
    }

    const existing = await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
        q
          .eq("accompanimentId", args.accompanimentId)
          .eq("userId", args.userId)
          .eq("status", "active")
          .eq("assignedRole", args.assignedRole),
      )
      .take(1);
    if (existing.length > 0) {
      throw new Error("Ya existe una asignación activa para este acompañamiento y rol");
    }
    return await ctx.db.insert("accompanimentAssignments", { ...args, status: "active" });
  },
});
