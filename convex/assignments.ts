import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { assignmentRoleUnion } from "./validators";

/**
 * Escritura guardada de asignaciones (S2).
 *
 * Única vía de escritura de `accompanimentAssignments`: rechaza una fila
 * activa duplicada para la misma combinación de acompañamiento, usuario y
 * rol, sosteniendo el invariante del esquema. Las lecturas además deduplican
 * por `accompanimentId` ante filas heredadas. Opera con datos ficticios.
 */
export const assign = internalMutation({
  args: {
    accompanimentId: v.id("accompaniments"),
    userId: v.id("users"),
    assignedRole: assignmentRoleUnion,
  },
  handler: async (ctx, args) => {
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
