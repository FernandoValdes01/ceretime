import { ConvexError, v } from "convex/values";
import { AUTHORIZATION_DENIED_MESSAGE } from "./application/authorization/authorize";
import { internalMutation } from "./_generated/server";
import { assignmentRoleUnion } from "./validators";

/**
 * Escritura guardada de asignaciones (S2).
 *
 * Única vía de escritura de `accompanimentAssignments` junto a `revoke`. El
 * llamante debe ser un Profesional con cuenta habilitada y vigente: la
 * identidad se resuelve en el servidor y se propaga a esta interna cuando la
 * invoca el futuro flujo público. El recorte por acompañamiento (asignar solo
 * en los propios) llega con el flujo público de RF-39. Rechaza la fila activa
 * duplicada para la misma combinación de acompañamiento, usuario y rol,
 * sosteniendo el invariante del esquema: por rol, cada acompañamiento aparece
 * una sola vez y el listado paginado no puede repetir entre páginas. Las
 * lecturas además deduplican por `accompanimentId` ante filas escritas a mano
 * fuera del Backend. Opera con datos ficticios.
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

/**
 * Revoca una asignación existente. Comparte la exigencia de llamante con
 * `assign` y es idempotente: revocar una fila ya revocada no falla. Revoca
 * TODAS las filas activas de la tripla en lugar de una sola, para que ninguna
 * fila escrita fuera del Backend deje acceso activo tras informar éxito.
 * Completa la vía de escritura para que ningún flujo necesite inserts
 * directos.
 */
export const revoke = internalMutation({
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

    const exactTriple = {
      accompanimentId: args.accompanimentId,
      userId: args.userId,
      assignedRole: args.assignedRole,
    };

    let revoked = 0;
    for (let round = 0; round < 10; round++) {
      const rows = await ctx.db
        .query("accompanimentAssignments")
        .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
          q
            .eq("accompanimentId", exactTriple.accompanimentId)
            .eq("userId", exactTriple.userId)
            .eq("status", "active")
            .eq("assignedRole", exactTriple.assignedRole),
        )
        .take(50);
      if (rows.length === 0) break;
      for (const row of rows) {
        await ctx.db.patch(row._id, { status: "revoked" });
      }
      revoked += rows.length;
      if (rows.length < 50) break;
    }
    if (revoked === 0) return null;
    return revoked;
  },
});
