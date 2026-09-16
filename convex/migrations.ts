import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

/**
 * Auditoría de migraciones de la database mínima (TI2-17).
 *
 * Detecta filas de `accompanimentAssignments` anteriores a la trazabilidad
 * de TI2-16 (sin `grantedBy`/`grantedAt` o, en revocadas, sin
 * `revokedBy`/`revokedAt`). Es solo lectura: jamás inventa actor ni fecha,
 * porque rellenar auditoría con datos falsos violaría la trazabilidad que
 * exige la Ley 21.719. Las filas nuevas siempre nacen completas mediante la
 * vía guardada (`internal.assignments.assign` y `internal.assignments.revoke`).
 *
 * Alcance: trazabilidad mínima de Sprint 1, no un módulo general de
 * auditoría. El barrido es acotado (`limit`, tope de 1000) y el operador lo
 * repite hasta que `hasMore` sea falso. Se ejecuta con
 * `bunx convex run migrations:auditAssignmentTraceability '{}'` sobre el
 * entorno elegido. Opera con datos ficticios fuera de producción.
 */

const AUDIT_DEFAULT_LIMIT = 200;
const AUDIT_MAX_LIMIT = 1000;
const AUDIT_SAMPLE_SIZE = 10;

export const auditAssignmentTraceability = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const requested = args.limit ?? AUDIT_DEFAULT_LIMIT;
    const limit = Math.min(Math.max(Math.floor(requested), 1), AUDIT_MAX_LIMIT);
    const rows = await ctx.db.query("accompanimentAssignments").take(limit);

    let missingGrant = 0;
    let missingRevoke = 0;
    const sampleLegacyIds = [];
    for (const row of rows) {
      const grantMissing = row.grantedBy === undefined || row.grantedAt === undefined;
      const revokeMissing =
        row.status === "revoked" && (row.revokedBy === undefined || row.revokedAt === undefined);
      if (grantMissing) missingGrant += 1;
      if (revokeMissing) missingRevoke += 1;
      if ((grantMissing || revokeMissing) && sampleLegacyIds.length < AUDIT_SAMPLE_SIZE) {
        sampleLegacyIds.push(row._id);
      }
    }
    return {
      scanned: rows.length,
      missingGrant,
      missingRevoke,
      hasMore: rows.length === limit,
      sampleLegacyIds,
    };
  },
});
