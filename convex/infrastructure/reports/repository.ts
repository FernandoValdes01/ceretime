import type { Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  DEFAULT_MINIMUM_GROUP_SIZE,
  REPORT_SCAN_LIMIT,
  type ReportAppointmentSample,
  type ReportExportFormat,
  type ReportModalityFilter,
  type ReportRequestSample,
} from "../../domain/reports/report";

/**
 * Repositorio de infraestructura para reportes agregados (TI2-175).
 *
 * Todas las lecturas usan índices explícitos (`by_createdAt`, `by_request`,
 * `by_modality_and_startsAt`) y un tope explícito (`take(limit + 1)`)
 * para evitar lecturas ilimitadas y señalar cuándo se alcanzó el límite.
 * Nunca proyecta nombres, correos, notas ni necesidades de acceso.
 */

type DbReader = QueryCtx | MutationCtx;

/** Lee el umbral mínimo de grupo vigente, o 5 por defecto si no se ha configurado. */
export async function readMinimumGroupSize(ctx: DbReader): Promise<number> {
  const row = await ctx.db
    .query("reportSettings")
    .withIndex("by_key", (q) => q.eq("key", "default"))
    .unique();
  if (row === null) {
    return DEFAULT_MINIMUM_GROUP_SIZE;
  }
  return Math.max(DEFAULT_MINIMUM_GROUP_SIZE, row.minimumGroupSize);
}

/**
 * Actualiza el umbral mínimo de grupo y registra el evento de auditoría en la
 * misma transacción atómica (ADR-0004).
 */
export async function saveMinimumGroupSizeWithAudit(
  ctx: MutationCtx,
  input: {
    readonly actorId: Id<"users">;
    readonly newThreshold: number;
    readonly occurredAt: number;
  },
): Promise<{
  readonly previousThreshold: number;
  readonly newThreshold: number;
  readonly auditEventId: Id<"reportThresholdChanges"> | null;
}> {
  const existing = await ctx.db
    .query("reportSettings")
    .withIndex("by_key", (q) => q.eq("key", "default"))
    .unique();
  const previousThreshold =
    existing === null
      ? DEFAULT_MINIMUM_GROUP_SIZE
      : Math.max(DEFAULT_MINIMUM_GROUP_SIZE, existing.minimumGroupSize);

  if (existing === null) {
    await ctx.db.insert("reportSettings", {
      key: "default",
      minimumGroupSize: input.newThreshold,
      updatedBy: input.actorId,
      updatedAt: input.occurredAt,
    });
  } else {
    await ctx.db.patch(existing._id, {
      minimumGroupSize: input.newThreshold,
      updatedBy: input.actorId,
      updatedAt: input.occurredAt,
    });
  }

  if (previousThreshold === input.newThreshold) {
    return {
      previousThreshold,
      newThreshold: input.newThreshold,
      auditEventId: null,
    };
  }

  const auditEventId = await ctx.db.insert("reportThresholdChanges", {
    actorId: input.actorId,
    previousThreshold,
    newThreshold: input.newThreshold,
    occurredAt: input.occurredAt,
  });

  return {
    previousThreshold,
    newThreshold: input.newThreshold,
    auditEventId,
  };
}

/**
 * Lee muestras mínimas de solicitudes y su primera transición dentro del rango
 * `[startAt, endAt)` mediante consultas indexadas y acotadas por `limit`.
 */
export async function readBoundedRequestSamples(
  ctx: DbReader,
  input: {
    readonly startAt: number;
    readonly endAt: number;
    readonly limit?: number;
  },
): Promise<{
  readonly samples: readonly ReportRequestSample[];
  readonly truncated: boolean;
}> {
  const limit = input.limit ?? REPORT_SCAN_LIMIT;
  const rows = await ctx.db
    .query("requests")
    .withIndex("by_createdAt", (q) =>
      q.gte("createdAt", input.startAt).lt("createdAt", input.endAt),
    )
    .take(limit + 1);

  const truncated = rows.length > limit;
  const bounded = truncated ? rows.slice(0, limit) : rows;

  const samples: ReportRequestSample[] = [];
  for (const row of bounded) {
    const firstTransition = await ctx.db
      .query("requestTransitions")
      .withIndex("by_request", (q) => q.eq("requestId", row._id))
      .order("asc")
      .first();
    samples.push({
      status: row.status,
      createdAt: row.createdAt,
      firstResponseAt: firstTransition === null ? null : firstTransition.occurredAt,
    });
  }

  return { samples, truncated };
}

/**
 * Lee muestras mínimas de atenciones dentro del rango `[startAt, endAt)` y
 * filtro de modalidad mediante consultas indexadas y acotadas por `limit`.
 * Cuando `modality === "all"`, consulta cada modalidad con su propio tope por
 * índice `by_modality_and_startsAt` para no truncar prematuramente una
 * modalidad por volumen de la otra y disponer siempre de la matriz completa.
 */
export async function readBoundedAppointmentSamples(
  ctx: DbReader,
  input: {
    readonly startAt: number;
    readonly endAt: number;
    readonly modality: ReportModalityFilter;
    readonly limit?: number;
  },
): Promise<{
  readonly samples: readonly ReportAppointmentSample[];
  readonly truncated: boolean;
}> {
  const limit = input.limit ?? REPORT_SCAN_LIMIT;
  if (input.modality === "all") {
    const [inPersonRows, onlineRows] = await Promise.all([
      ctx.db
        .query("appointments")
        .withIndex("by_modality_and_startsAt", (q) =>
          q.eq("modality", "inPerson").gte("startsAt", input.startAt).lt("startsAt", input.endAt),
        )
        .take(limit + 1),
      ctx.db
        .query("appointments")
        .withIndex("by_modality_and_startsAt", (q) =>
          q.eq("modality", "online").gte("startsAt", input.startAt).lt("startsAt", input.endAt),
        )
        .take(limit + 1),
    ]);
    const truncated = inPersonRows.length > limit || onlineRows.length > limit;
    const bounded = [
      ...(inPersonRows.length > limit ? inPersonRows.slice(0, limit) : inPersonRows),
      ...(onlineRows.length > limit ? onlineRows.slice(0, limit) : onlineRows),
    ];
    return {
      samples: bounded.map((row) => ({
        status: row.status,
        modality: row.modality,
      })),
      truncated,
    };
  }

  const rows = await ctx.db
    .query("appointments")
    .withIndex("by_modality_and_startsAt", (q) =>
      q
        .eq("modality", input.modality as "inPerson" | "online")
        .gte("startsAt", input.startAt)
        .lt("startsAt", input.endAt),
    )
    .take(limit + 1);

  const truncated = rows.length > limit;
  const bounded = truncated ? rows.slice(0, limit) : rows;

  return {
    samples: bounded.map((row) => ({
      status: row.status,
      modality: row.modality,
    })),
    truncated,
  };
}

/** Registra una exportación de reporte agregado de forma append-only. */
export async function recordReportExport(
  ctx: MutationCtx,
  input: {
    readonly actorId: Id<"users">;
    readonly format: ReportExportFormat;
    readonly periodFrom: string;
    readonly periodTo: string;
    readonly modalityFilter: ReportModalityFilter;
    readonly minimumGroupSize: number;
    readonly truncated: boolean;
    readonly exportedAt: number;
  },
): Promise<Id<"reportExports">> {
  return await ctx.db.insert("reportExports", {
    actorId: input.actorId,
    format: input.format,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    modalityFilter: input.modalityFilter,
    minimumGroupSize: input.minimumGroupSize,
    truncated: input.truncated,
    exportedAt: input.exportedAt,
  });
}
