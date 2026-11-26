import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type {
  ReportActorReader,
  ReportExportRecorder,
  ReportSamplesReader,
  ReportSettingsReader,
  ReportSettingsWriter,
} from "../application/reports/ports";
import {
  exportAggregateReportUseCase,
  getAggregateReportUseCase,
  updateMinimumGroupSizeUseCase,
} from "../application/reports/use_cases";
import { AGENDA_TIME_ZONE } from "../domain/availability/availability";
import { findProfileByTokenIdentifier } from "../infrastructure/accounts/repository";
import {
  readBoundedAppointmentSamples,
  readBoundedRequestSamples,
  readMinimumGroupSize,
  recordReportExport,
  saveMinimumGroupSizeWithAudit,
} from "../infrastructure/reports/repository";
import {
  aggregateCountCellValidator,
  appointmentStatusUnion,
  reportContractVersionLiteral,
  reportExportFormatUnion,
  reportModalityFilterUnion,
  reportSuppressionReasonUnion,
  requestStatusUnion,
} from "../infrastructure/validators";
import { unwrapApiResult } from "./session";

/**
 * Borde de Presentación: reportes agregados, exportación registrada y umbral
 * mínimo de grupo (TI2-175, ADR-0004).
 *
 * Adaptador delgado: valida la entrada con validadores Convex, resuelve la
 * identidad en el servidor con `ctx.auth.getUserIdentity()`, compone los
 * adaptadores de Infraestructura y delega en Aplicación. Nunca acepta un
 * `userId` del cliente ni expone datos personales, notas ni necesidades de
 * acceso.
 */

const waitTimeSummaryValidator = v.union(
  v.object({ status: v.literal("empty") }),
  v.object({
    status: v.literal("suppressed"),
    reason: reportSuppressionReasonUnion,
  }),
  v.object({
    status: v.literal("visible"),
    sampleCount: v.number(),
    averageHours: v.number(),
    medianHours: v.number(),
  }),
);

const aggregateReportValidator = v.object({
  metadata: v.object({
    version: reportContractVersionLiteral,
    timeZone: v.literal(AGENDA_TIME_ZONE),
    periodFrom: v.string(),
    periodTo: v.string(),
    modalityFilter: reportModalityFilterUnion,
    minimumGroupSize: v.number(),
    scanLimit: v.number(),
    truncated: v.boolean(),
    calculationNote: v.string(),
  }),
  requests: v.object({
    rows: v.array(
      v.object({
        status: requestStatusUnion,
        cell: aggregateCountCellValidator,
      }),
    ),
    total: aggregateCountCellValidator,
  }),
  waitTime: waitTimeSummaryValidator,
  appointments: v.object({
    rows: v.array(
      v.object({
        status: appointmentStatusUnion,
        inPerson: aggregateCountCellValidator,
        online: aggregateCountCellValidator,
        total: aggregateCountCellValidator,
      }),
    ),
    columnTotals: v.object({
      inPerson: aggregateCountCellValidator,
      online: aggregateCountCellValidator,
    }),
    total: aggregateCountCellValidator,
    cancellationsTotal: aggregateCountCellValidator,
    noShowsTotal: aggregateCountCellValidator,
  }),
});

function reportActorReader(ctx: QueryCtx | MutationCtx): ReportActorReader<Id<"users">> {
  return {
    findByTokenIdentifier: async (tokenIdentifier) => {
      const profile = await findProfileByTokenIdentifier(ctx, tokenIdentifier);
      if (profile === null) return null;
      return {
        id: profile._id,
        role: profile.role,
        institutionalStatus: profile.institutionalStatus,
        accountStatus: profile.accountStatus,
      };
    },
  };
}

function reportSettingsReader(ctx: QueryCtx | MutationCtx): ReportSettingsReader {
  return {
    readMinimumGroupSize: () => readMinimumGroupSize(ctx),
  };
}

function reportSettingsWriter(
  ctx: MutationCtx,
): ReportSettingsWriter<Id<"users">, Id<"reportThresholdChanges">> {
  return {
    readMinimumGroupSize: () => readMinimumGroupSize(ctx),
    saveMinimumGroupSizeWithAudit: (input) => saveMinimumGroupSizeWithAudit(ctx, input),
  };
}

function reportSamplesReader(ctx: QueryCtx | MutationCtx): ReportSamplesReader {
  return {
    readRequestSamples: (input) => readBoundedRequestSamples(ctx, input),
    readAppointmentSamples: (input) => readBoundedAppointmentSamples(ctx, input),
  };
}

function reportExportRecorder(
  ctx: MutationCtx,
): ReportExportRecorder<Id<"users">, Id<"reportExports">> {
  return {
    recordExport: (input) => recordReportExport(ctx, input),
  };
}

/** Consulta reportes agregados del periodo y modalidad solicitados. Solo Administrador. */
export const getAggregateReport = query({
  args: {
    from: v.string(),
    to: v.string(),
    modality: v.optional(reportModalityFilterUnion),
  },
  returns: aggregateReportValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const result = await getAggregateReportUseCase(
      {
        actors: reportActorReader(ctx),
        settings: reportSettingsReader(ctx),
        samples: reportSamplesReader(ctx),
      },
      {
        tokenIdentifier: identity?.tokenIdentifier ?? null,
        from: args.from,
        to: args.to,
        modality: args.modality,
      },
    );
    return unwrapApiResult(result);
  },
});

/**
 * Exporta el reporte agregado en CSV o JSON y registra la exportación en
 * `reportExports`. Solo Administrador.
 */
export const exportAggregateReport = mutation({
  args: {
    from: v.string(),
    to: v.string(),
    modality: v.optional(reportModalityFilterUnion),
    format: reportExportFormatUnion,
  },
  returns: v.object({
    exportId: v.id("reportExports"),
    exportedAt: v.number(),
    format: reportExportFormatUnion,
    fileName: v.string(),
    content: v.string(),
    report: aggregateReportValidator,
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const result = await exportAggregateReportUseCase(
      {
        actors: reportActorReader(ctx),
        settings: reportSettingsReader(ctx),
        samples: reportSamplesReader(ctx),
        exports: reportExportRecorder(ctx),
        now: Date.now,
      },
      {
        tokenIdentifier: identity?.tokenIdentifier ?? null,
        from: args.from,
        to: args.to,
        modality: args.modality,
        format: args.format,
      },
    );
    return unwrapApiResult(result);
  },
});

/**
 * Configura el tamaño mínimo de grupo (>= 5) y registra cada cambio en
 * `reportThresholdChanges`. Solo Administrador.
 */
export const updateMinimumGroupSize = mutation({
  args: {
    minimumGroupSize: v.number(),
  },
  returns: v.object({
    previousThreshold: v.number(),
    newThreshold: v.number(),
    auditEventId: v.union(v.id("reportThresholdChanges"), v.null()),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const result = await updateMinimumGroupSizeUseCase(
      {
        actors: reportActorReader(ctx),
        settings: reportSettingsWriter(ctx),
        now: Date.now,
      },
      {
        tokenIdentifier: identity?.tokenIdentifier ?? null,
        minimumGroupSize: args.minimumGroupSize,
      },
    );
    return unwrapApiResult(result);
  },
});
