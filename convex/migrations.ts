import { paginationOptsValidator } from "convex/server";
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
 * auditoría. El barrido es paginado: el operador repite la llamada con el
 * `continueCursor` devuelto hasta que `isDone` sea verdadero y suma los
 * conteos de cada página. Se ejecuta con
 * `bunx convex run migrations:auditAssignmentTraceability '{"paginationOpts":{"numItems":200,"cursor":null}}'`
 * sobre el entorno elegido. Opera con datos ficticios fuera de producción.
 */

const AUDIT_SAMPLE_SIZE = 10;

export const auditAssignmentTraceability = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("accompanimentAssignments").paginate(args.paginationOpts);

    let missingGrant = 0;
    let missingRevoke = 0;
    const sampleLegacyIds = [];
    for (const row of result.page) {
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
      scanned: result.page.length,
      missingGrant,
      missingRevoke,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      sampleLegacyIds,
    };
  },
});
