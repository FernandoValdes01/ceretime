import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { AUTHORIZATION_DENIED_MESSAGE } from "../application/authorization/authorize";
import { LEGACY_REQUEST_PROVENANCE_CHANNEL } from "../domain/requests/request";
import { findProfileByTokenIdentifier } from "../infrastructure/accounts/repository";
import {
  findAppointmentProfessional,
  syncAppointmentProfessional,
} from "../infrastructure/appointments/repository";

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

/**
 * Operador de una migración: un Administrador habilitado y activo, con la
 * identidad derivada en el servidor. Cualquier otro caso recibe la denegación
 * genérica.
 */
async function requireAdminOperator(ctx: MutationCtx) {
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
  return operator;
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
    const operator = await requireAdminOperator(ctx);

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

/**
 * Migración de vencimientos (TI4-84): `expired` en vez de `revoked`.
 *
 * Hasta TI4-84 el vencimiento programado de una asignación (TI2-140) dejaba
 * `status: "revoked"` con `revokedAt` y sin `revokedBy`, y solo se distinguía
 * de una revocación por la falta de actor. Desde TI4-84 deja `expired` con
 * `expiredAt`, como `ACCESOS_PRACTICANTE.estado = vencido` del MER. Esta
 * migración pasa a `expired` las filas `revoked` sin `revokedBy`
 * cuya `validUntil` ya pasó: mueve `revokedAt` a `expiredAt`, o usa
 * `validUntil` si la fila no trae fecha, sin inventar actor. Una fila
 * revocada sin actor y sin ventana vencida, como las revocadas a mano antes
 * de TI2-16, no se toca. Es idempotente: una fila ya `expired` no vuelve a
 * coincidir.
 *
 * Mismo procedimiento que las demás: la ejecuta un Administrador vigente y
 * el barrido es paginado, repitiendo cada llamada con el `continueCursor`
 * devuelto hasta que `isDone` sea verdadero. Ninguna autorización cambia,
 * porque solo `active` da acceso.
 */
export const reclassifyExpiredAssignments = internalMutation({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireAdminOperator(ctx);

    const result = await ctx.db.query("accompanimentAssignments").paginate(args.paginationOpts);
    const now = Date.now();
    let reclassified = 0;
    const reclassifiedIds = [];
    for (const row of result.page) {
      const expiredBySystem =
        row.status === "revoked" &&
        row.revokedBy === undefined &&
        row.validUntil !== undefined &&
        row.validUntil <= now;
      if (!expiredBySystem) continue;
      await ctx.db.patch(row._id, {
        status: "expired",
        expiredAt: row.revokedAt ?? row.validUntil,
        revokedAt: undefined,
      });
      reclassified += 1;
      if (reclassifiedIds.length < MIGRATION_SAMPLE_SIZE) reclassifiedIds.push(row._id);
    }
    return {
      scanned: result.page.length,
      reclassified,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      reclassifiedIds,
    };
  },
});

/**
 * Migración del historial de cuentas (TI4-84): un evento por cuenta.
 *
 * Hasta TI4-84 la fila de `users` guardaba solo los últimos `enabledBy`,
 * `enabledAt`, `revokedBy` y `revokedAt`. Esta migración siembra en
 * `accountEnablements` un evento por cuenta con esos campos, sin inventar
 * actor ni fecha: la habilitación con su fecha y su actor, si lo tiene, y la
 * revocación solo si la cuenta está revocada y su fecha es posterior a la
 * habilitación. Una cuenta que nunca se habilitó (`enabledAt` ausente) no
 * recibe evento. Las habilitaciones y revocaciones anteriores a la última ya
 * no están en ninguna fila y no se pueden recuperar.
 *
 * Es idempotente: una cuenta que ya tiene algún evento no se toca. Mismo
 * procedimiento que las demás: la ejecuta un Administrador vigente, por
 * páginas, hasta que `isDone` sea verdadero.
 */
export const seedAccountEnablements = internalMutation({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireAdminOperator(ctx);

    const result = await ctx.db.query("users").paginate(args.paginationOpts);
    let seeded = 0;
    let neverEnabled = 0;
    const seededIds = [];
    for (const user of result.page) {
      const existing = await ctx.db
        .query("accountEnablements")
        .withIndex("by_user_and_enabledAt", (q) => q.eq("userId", user._id))
        .first();
      if (existing !== null) continue;
      if (user.enabledAt === undefined) {
        neverEnabled += 1;
        continue;
      }
      const revoked =
        user.institutionalStatus === "disabled" &&
        user.revokedAt !== undefined &&
        user.revokedAt >= user.enabledAt;
      await ctx.db.insert("accountEnablements", {
        userId: user._id,
        role: user.role,
        ...(user.enabledBy === undefined ? {} : { enabledBy: user.enabledBy }),
        enabledAt: user.enabledAt,
        ...(revoked && user.revokedBy !== undefined ? { revokedBy: user.revokedBy } : {}),
        ...(revoked ? { revokedAt: user.revokedAt } : {}),
      });
      seeded += 1;
      if (seededIds.length < MIGRATION_SAMPLE_SIZE) seededIds.push(user._id);
    }
    return {
      scanned: result.page.length,
      seeded,
      neverEnabled,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      seededIds,
    };
  },
});

/**
 * Migración de solicitudes (TI2-135): procedencia de las filas anteriores.
 *
 * Las filas de `requests` anteriores a TI2-135 no tienen `provenance`. Hasta
 * entonces la única entrada era `createRequest` con la identidad del propio
 * Estudiante, así que su canal es `student` y su fecha de recepción es la de
 * creación: la migración escribe solo esos dos datos, que ya están en la fila.
 * No inventa contenido (necesidad, resultado esperado, modalidad,
 * disponibilidad ni canal accesible): el texto unido `accessNeeds` no se puede
 * separar con certeza, así que esas filas siguen leyéndose sin ellos. Es
 * idempotente: las filas que ya tienen procedencia no se tocan.
 *
 * Mismo procedimiento que la de asignaciones: la ejecuta un Administrador
 * vigente y el barrido es paginado, repitiendo cada llamada con el
 * `continueCursor` devuelto hasta que `isDone` sea verdadero. El entorno queda
 * apto cuando un barrido completo de auditoría informa `missingProvenance` en
 * cero. Opera con datos ficticios fuera de producción.
 */
export const auditRequestProvenance = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("requests").paginate(args.paginationOpts);

    let missingProvenance = 0;
    let withoutExtendedContent = 0;
    const sampleLegacyIds = [];
    for (const row of result.page) {
      if (row.provenance === undefined) {
        missingProvenance += 1;
        if (sampleLegacyIds.length < MIGRATION_SAMPLE_SIZE) sampleLegacyIds.push(row._id);
      }
      if (row.needSummary === undefined) withoutExtendedContent += 1;
    }
    return {
      scanned: result.page.length,
      missingProvenance,
      withoutExtendedContent,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      sampleLegacyIds,
    };
  },
});

/**
 * Escribe la procedencia del Estudiante en las solicitudes de la página que no
 * tienen ninguna. No toca ningún otro campo ni las filas que ya la tienen.
 */
export const migrateLegacyRequests = internalMutation({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireAdminOperator(ctx);

    const result = await ctx.db.query("requests").paginate(args.paginationOpts);
    let migrated = 0;
    const migratedIds = [];
    for (const row of result.page) {
      if (row.provenance !== undefined) continue;
      await ctx.db.patch(row._id, {
        provenance: { channel: LEGACY_REQUEST_PROVENANCE_CHANNEL, receivedAt: row.createdAt },
      });
      migrated += 1;
      if (migratedIds.length < MIGRATION_SAMPLE_SIZE) migratedIds.push(row._id);
    }
    return {
      scanned: result.page.length,
      migrated,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      migratedIds,
    };
  },
});

/**
 * Migración de atenciones (TI2-138): participantes.
 *
 * Las filas de `appointments` anteriores a TI2-138 no tienen una fila en
 * `appointmentProfessionals`. La migración crea la del profesional responsable
 * para que el índice de cruces cubra el historial. No inventa la referencia
 * privada: sigue ausente hasta que `setOnlineAccessLink` la escriba.
 *
 * Es idempotente: solo escribe lo que falta y no toca las filas ya migradas.
 * La ejecuta un Administrador vigente y el barrido es paginado, repitiendo
 * cada llamada con el `continueCursor` devuelto hasta que `isDone` sea
 * verdadero. El entorno queda apto cuando un barrido completo de auditoría
 * informa `missingParticipants` en cero. Opera
 * con datos ficticios fuera de producción.
 */
export const auditAppointmentParticipants = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("appointments").paginate(args.paginationOpts);

    let missingParticipants = 0;
    const sampleLegacyIds = [];
    for (const row of result.page) {
      const participant = await findAppointmentProfessional(ctx, row._id, row.professionalId);
      if (participant !== null) continue;
      missingParticipants += 1;
      if (sampleLegacyIds.length < MIGRATION_SAMPLE_SIZE) sampleLegacyIds.push(row._id);
    }
    return {
      scanned: result.page.length,
      missingParticipants,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      sampleLegacyIds,
    };
  },
});

/**
 * Completa las atenciones de la página: crea la fila del profesional
 * responsable cuando falta.
 */
export const migrateLegacyAppointments = internalMutation({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireAdminOperator(ctx);

    const result = await ctx.db.query("appointments").paginate(args.paginationOpts);
    let createdParticipants = 0;
    const migratedIds = [];
    for (const row of result.page) {
      const inserted = await syncAppointmentProfessional(ctx, {
        appointmentId: row._id,
        professionalId: row.professionalId,
      });
      if (!inserted) continue;
      createdParticipants += 1;
      if (migratedIds.length < MIGRATION_SAMPLE_SIZE) migratedIds.push(row._id);
    }
    return {
      scanned: result.page.length,
      createdParticipants,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      migratedIds,
    };
  },
});

/**
 * Migración de campos retirados (TI2-165).
 *
 * TI2-165 quitó del esquema lo que no está en el MER, pero las filas que
 * escribieron las versiones anteriores todavía pueden tenerlos, y Convex
 * rechaza un esquema que no las admite. Por eso esos campos y la tabla
 * `accompanimentTransitions` siguen declarados como opcionales retirados: nada
 * los escribe ni los lee. Esta migración los vacía tabla por tabla sin perder
 * lo que el MER pide guardar:
 *
 * - `accompaniments`: un acompañamiento cerrado por TI2-152 guardó su cierre
 *   solo en `accompanimentTransitions`. Se copia la última transición a
 *   `closed` a `closedById`, `closedAt` y `closureReason` (`cerradoPorId?`,
 *   `cerradoEn?` y `motivoCierre?` del MER).
 * - `accompanimentTransitions`: se borra cada fila cuando su acompañamiento ya
 *   no tiene un cierre por copiar. Por eso va después de `accompaniments`.
 * - `requests`: si `closureReason` no está en la transición del cierre, se
 *   copia ahí antes de quitarlo, porque el detalle lo lee de esa transición. Si
 *   no hay transición donde copiarlo, el campo se conserva y la auditoría lo
 *   sigue contando: el operador decide antes de quitarlo del esquema.
 * - El resto solo se quita: `requests.idempotencyKey`,
 *   `appointments.appliedAccessNeeds` y `onlineSupports`,
 *   `appointmentProfessionals.startsAt` y `endsAt`, `followUpRecords.version`,
 *   `entryId` de acuerdos y tareas y `availabilityExceptions.reason`.
 *
 * Mismo procedimiento que las anteriores: la ejecuta un Administrador vigente,
 * el barrido es paginado y se repite con el `continueCursor` devuelto hasta
 * que `isDone` sea verdadero. Es idempotente. El deployment queda apto para
 * quitar esos campos del esquema cuando un barrido completo de
 * `auditRetiredFields` informa `pending` en cero en cada tabla. No copia el
 * motivo a la bitácora de auditoría. Opera con datos ficticios fuera de
 * producción.
 */
const RETIRED_FIELD_TABLES = [
  "accompaniments",
  "accompanimentTransitions",
  "requests",
  "appointments",
  "appointmentProfessionals",
  "followUpRecords",
  "followUpAgreements",
  "followUpTasks",
  "availabilityExceptions",
] as const;

type RetiredFieldTable = (typeof RETIRED_FIELD_TABLES)[number];

const retiredFieldTableValidator = v.union(
  ...RETIRED_FIELD_TABLES.map((table) => v.literal(table)),
);

/** Transiciones leídas por acompañamiento o solicitud para encontrar su cierre. */
const MAX_TRANSITIONS_PER_RESOURCE = 200;

/** La transición a `closed` más reciente del acompañamiento, si existe. */
async function findLegacyClosure(
  ctx: QueryCtx,
  accompanimentId: Id<"accompaniments">,
): Promise<Doc<"accompanimentTransitions"> | null> {
  const rows = await ctx.db
    .query("accompanimentTransitions")
    .withIndex("by_accompanimentId_and_occurredAt", (q) => q.eq("accompanimentId", accompanimentId))
    .order("desc")
    .take(MAX_TRANSITIONS_PER_RESOURCE);
  return rows.find((row) => row.to === "closed") ?? null;
}

/** Un cierre guardado solo en las transiciones, todavía sin copiar. */
async function hasClosureToCopy(ctx: QueryCtx, row: Doc<"accompaniments">): Promise<boolean> {
  if (row.status !== "closed" || row.closedAt !== undefined) return false;
  return (await findLegacyClosure(ctx, row._id)) !== null;
}

/** La transición del cierre sin acompañamiento más reciente de la solicitud. */
async function findRequestClosingTransition(
  ctx: QueryCtx,
  requestId: Id<"requests">,
): Promise<Doc<"requestTransitions"> | null> {
  const rows = await ctx.db
    .query("requestTransitions")
    .withIndex("by_request", (q) => q.eq("requestId", requestId))
    .take(MAX_TRANSITIONS_PER_RESOURCE);
  let latest: Doc<"requestTransitions"> | null = null;
  for (const row of rows) {
    if (row.to !== "closed_without_accompaniment") continue;
    if (latest === null || row.occurredAt > latest.occurredAt) latest = row;
  }
  return latest;
}

/** Verdadero cuando la fila todavía tiene algo que la migración resuelve. */
async function isRetiredPending(
  ctx: QueryCtx,
  table: RetiredFieldTable,
  row: Doc<RetiredFieldTable>,
): Promise<boolean> {
  switch (table) {
    case "accompaniments":
      return await hasClosureToCopy(ctx, row as Doc<"accompaniments">);
    case "accompanimentTransitions":
      return true;
    case "requests": {
      const request = row as Doc<"requests">;
      return request.closureReason !== undefined || request.idempotencyKey !== undefined;
    }
    case "appointments": {
      const appointment = row as Doc<"appointments">;
      return (
        appointment.appliedAccessNeeds !== undefined || appointment.onlineSupports !== undefined
      );
    }
    case "appointmentProfessionals": {
      const participant = row as Doc<"appointmentProfessionals">;
      return participant.startsAt !== undefined || participant.endsAt !== undefined;
    }
    case "followUpRecords":
      return (row as Doc<"followUpRecords">).version !== undefined;
    case "followUpAgreements":
      return (row as Doc<"followUpAgreements">).entryId !== undefined;
    case "followUpTasks":
      return (row as Doc<"followUpTasks">).entryId !== undefined;
    case "availabilityExceptions":
      return (row as Doc<"availabilityExceptions">).reason !== undefined;
  }
}

/**
 * Resuelve una fila. Devuelve `migrated` si escribió, `unchanged` si no había
 * nada que hacer y `kept` si conservó algo que no se puede quitar sin perderlo.
 */
async function migrateRetiredRow(
  ctx: MutationCtx,
  table: RetiredFieldTable,
  row: Doc<RetiredFieldTable>,
): Promise<"migrated" | "unchanged" | "kept"> {
  switch (table) {
    case "accompaniments": {
      const accompaniment = row as Doc<"accompaniments">;
      if (accompaniment.status !== "closed" || accompaniment.closedAt !== undefined) {
        return "unchanged";
      }
      const closure = await findLegacyClosure(ctx, accompaniment._id);
      if (closure === null) return "unchanged";
      await ctx.db.patch(accompaniment._id, {
        closedById: closure.actorId,
        closedAt: closure.occurredAt,
        ...(closure.reason === undefined ? {} : { closureReason: closure.reason }),
      });
      return "migrated";
    }
    case "accompanimentTransitions": {
      const transition = row as Doc<"accompanimentTransitions">;
      const accompaniment = await ctx.db.get(transition.accompanimentId);
      if (accompaniment !== null && (await hasClosureToCopy(ctx, accompaniment))) return "kept";
      await ctx.db.delete(transition._id);
      return "migrated";
    }
    case "requests": {
      const request = row as Doc<"requests">;
      if (request.closureReason === undefined && request.idempotencyKey === undefined) {
        return "unchanged";
      }
      let keepClosureReason = false;
      if (request.closureReason !== undefined) {
        const closing = await findRequestClosingTransition(ctx, request._id);
        if (closing === null) {
          keepClosureReason = true;
        } else if (closing.reason === undefined) {
          await ctx.db.patch(closing._id, { reason: request.closureReason });
        }
      }
      await ctx.db.patch(request._id, {
        idempotencyKey: undefined,
        ...(keepClosureReason ? {} : { closureReason: undefined }),
      });
      return keepClosureReason ? "kept" : "migrated";
    }
    case "appointments": {
      const appointment = row as Doc<"appointments">;
      if (
        appointment.appliedAccessNeeds === undefined &&
        appointment.onlineSupports === undefined
      ) {
        return "unchanged";
      }
      await ctx.db.patch(appointment._id, {
        appliedAccessNeeds: undefined,
        onlineSupports: undefined,
      });
      return "migrated";
    }
    case "appointmentProfessionals": {
      const participant = row as Doc<"appointmentProfessionals">;
      if (participant.startsAt === undefined && participant.endsAt === undefined) {
        return "unchanged";
      }
      await ctx.db.patch(participant._id, { startsAt: undefined, endsAt: undefined });
      return "migrated";
    }
    case "followUpRecords": {
      const record = row as Doc<"followUpRecords">;
      if (record.version === undefined) return "unchanged";
      await ctx.db.patch(record._id, { version: undefined });
      return "migrated";
    }
    case "followUpAgreements": {
      const agreement = row as Doc<"followUpAgreements">;
      if (agreement.entryId === undefined) return "unchanged";
      await ctx.db.patch(agreement._id, { entryId: undefined });
      return "migrated";
    }
    case "followUpTasks": {
      const task = row as Doc<"followUpTasks">;
      if (task.entryId === undefined) return "unchanged";
      await ctx.db.patch(task._id, { entryId: undefined });
      return "migrated";
    }
    case "availabilityExceptions": {
      const exception = row as Doc<"availabilityExceptions">;
      if (exception.reason === undefined) return "unchanged";
      await ctx.db.patch(exception._id, { reason: undefined });
      return "migrated";
    }
  }
}

/** Cuenta, en una página de la tabla, las filas que la migración todavía resuelve. */
export const auditRetiredFields = internalQuery({
  args: { table: retiredFieldTableValidator, paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db.query(args.table).paginate(args.paginationOpts);
    let pending = 0;
    const samplePendingIds: string[] = [];
    for (const row of result.page) {
      if (!(await isRetiredPending(ctx, args.table, row))) continue;
      pending += 1;
      if (samplePendingIds.length < MIGRATION_SAMPLE_SIZE) samplePendingIds.push(row._id);
    }
    return {
      table: args.table,
      scanned: result.page.length,
      pending,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      samplePendingIds,
    };
  },
});

/** Vacía los campos retirados de una página de la tabla. */
export const migrateRetiredFields = internalMutation({
  args: { table: retiredFieldTableValidator, paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireAdminOperator(ctx);

    const result = await ctx.db.query(args.table).paginate(args.paginationOpts);
    let migrated = 0;
    let kept = 0;
    const migratedIds: string[] = [];
    const keptIds: string[] = [];
    for (const row of result.page) {
      const outcome = await migrateRetiredRow(ctx, args.table, row);
      if (outcome === "migrated") {
        migrated += 1;
        if (migratedIds.length < MIGRATION_SAMPLE_SIZE) migratedIds.push(row._id);
      } else if (outcome === "kept") {
        kept += 1;
        if (keptIds.length < MIGRATION_SAMPLE_SIZE) keptIds.push(row._id);
      }
    }
    return {
      table: args.table,
      scanned: result.page.length,
      migrated,
      kept,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      migratedIds,
      keptIds,
    };
  },
});

/**
 * Auditoría de versiones de necesidades (TI2-156): acompañamientos sin
 * primera versión en `accompanimentNeeds`.
 */
export const auditAccompanimentNeeds = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("accompaniments").paginate(args.paginationOpts);
    let missingVersions = 0;
    const sampleLegacyIds = [];
    for (const row of result.page) {
      const versions = await ctx.db
        .query("accompanimentNeeds")
        .withIndex("by_accompanimentId_and_validFrom", (q) => q.eq("accompanimentId", row._id))
        .take(1);
      if (versions.length === 0) {
        missingVersions += 1;
        if (sampleLegacyIds.length < MIGRATION_SAMPLE_SIZE) sampleLegacyIds.push(row._id);
      }
    }
    return {
      scanned: result.page.length,
      missingVersions,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      sampleLegacyIds,
    };
  },
});

/**
 * Crea la primera versión de cada acompañamiento sin versiones, con el texto
 * vigente y `validFrom: 1`, sin tocar la copia en `accompaniments`.
 */
export const migrateAccompanimentNeeds = internalMutation({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireAdminOperator(ctx);

    const result = await ctx.db.query("accompaniments").paginate(args.paginationOpts);
    let migrated = 0;
    const migratedIds = [];
    for (const row of result.page) {
      const versions = await ctx.db
        .query("accompanimentNeeds")
        .withIndex("by_accompanimentId_and_validFrom", (q) => q.eq("accompanimentId", row._id))
        .take(1);
      if (versions.length > 0) continue;
      await ctx.db.insert("accompanimentNeeds", {
        accompanimentId: row._id,
        accessNeeds: row.accessNeeds,
        validFrom: 1,
        createdAt: Date.now(),
      });
      migrated += 1;
      if (migratedIds.length < MIGRATION_SAMPLE_SIZE) migratedIds.push(row._id);
    }
    return {
      scanned: result.page.length,
      migrated,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      migratedIds,
    };
  },
});
