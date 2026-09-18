import { paginationOptsValidator } from "convex/server";
import { ConvexError } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { AUTHORIZATION_DENIED_MESSAGE } from "./application/authorization/authorize";
import { findProfileByTokenIdentifier } from "./infrastructure/accounts/repository";

/**
 * Migración de la database mínima (TI2-17): trazabilidad de asignaciones.
 *
 * Las filas de `accompanimentAssignments` anteriores a TI2-16 pueden existir
 * sin `grantedBy`/`grantedAt`, dejando incompleta la trazabilidad. Esta
 * migración procesa todas las filas sin inventar actor ni fecha: revoca las
 * activas sin concesión, registrando la revocación real (actor operador y
 * fecha de ejecución), y deja intactas las ya revocadas, que la auditoría
 * sigue listando como no resolubles. Rellenar la concesión con datos falsos
 * violaría la trazabilidad que exige la Ley 21.719.
 *
 * Solo la ejecuta un Administrador vigente, con identidad derivada en el
 * servidor. El barrido es paginado: el operador repite cada llamada con el
 * `continueCursor` devuelto hasta que `isDone` sea verdadero. El entorno
 * queda apto cuando un barrido completo de auditoría informa
 * `activeMissingGrant` en cero; las filas no resolubles restantes están
 * todas revocadas (sin acceso) y quedan registradas en la auditoría como
 * evidencia. Alcance: trazabilidad mínima de Sprint 1, no un módulo general
 * de auditoría. Opera con datos ficticios fuera de producción.
 */

const MIGRATION_SAMPLE_SIZE = 10;

function deny(): never {
  throw new ConvexError(AUTHORIZATION_DENIED_MESSAGE);
}

export const auditAssignmentTraceability = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("accompanimentAssignments").paginate(args.paginationOpts);

    let missingGrant = 0;
    let activeMissingGrant = 0;
    let missingRevoke = 0;
    const sampleLegacyIds = [];
    for (const row of result.page) {
      const grantMissing = row.grantedBy === undefined || row.grantedAt === undefined;
      const revokeMissing =
        row.status === "revoked" && (row.revokedBy === undefined || row.revokedAt === undefined);
      if (grantMissing) {
        missingGrant += 1;
        if (row.status === "active") activeMissingGrant += 1;
      }
      if (revokeMissing) missingRevoke += 1;
      if ((grantMissing || revokeMissing) && sampleLegacyIds.length < MIGRATION_SAMPLE_SIZE) {
        sampleLegacyIds.push(row._id);
      }
    }
    return {
      scanned: result.page.length,
      missingGrant,
      activeMissingGrant,
      missingRevoke,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      sampleLegacyIds,
    };
  },
});

/**
 * Revoca las asignaciones activas sin concesión de la página.
 *
 * Registra la revocación real de la migración (`revokedBy` con el operador y
 * `revokedAt` con la fecha de ejecución) y conserva los campos de concesión
 * ausentes como evidencia permanente de la brecha. No toca las filas de la
 * vía guardada ni las ya revocadas.
 */
export const migrateLegacyAssignments = internalMutation({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) deny();
    const operator = await findProfileByTokenIdentifier(ctx, identity?.tokenIdentifier ?? "");
    if (
      operator === null ||
      operator.role !== "admin" ||
      operator.institutionalStatus !== "enabled" ||
      operator.accountStatus !== "active"
    ) {
      deny();
    }

    const result = await ctx.db.query("accompanimentAssignments").paginate(args.paginationOpts);
    const now = Date.now();
    let revoked = 0;
    const revokedIds = [];
    for (const row of result.page) {
      const grantMissing = row.grantedBy === undefined || row.grantedAt === undefined;
      if (row.status === "active" && grantMissing) {
        await ctx.db.patch(row._id, {
          status: "revoked",
          revokedBy: operator._id,
          revokedAt: now,
        });
        revoked += 1;
        if (revokedIds.length < MIGRATION_SAMPLE_SIZE) revokedIds.push(row._id);
      }
    }
    return {
      scanned: result.page.length,
      revoked,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      revokedIds,
    };
  },
});
