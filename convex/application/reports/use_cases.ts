import { AGENDA_TIME_ZONE, civilRangeToInstantRange } from "../../domain/availability/availability";
import {
  canConfigureReportThreshold,
  canExportAggregateReports,
  canReadAggregateReports,
} from "../../domain/authorization/permissions";
import {
  REPORT_FILTERS_INVALID_ERROR_CODE,
  errResult,
  okResult,
  type ApiResult,
} from "../../domain/errors/api_error";
import {
  REPORT_EXPORT_FORMAT_VALUES,
  REPORT_SCAN_LIMIT,
  buildAggregateReport,
  buildReportExportFileName,
  serializeAggregateReportCsv,
  serializeAggregateReportJson,
  validateMinimumGroupSize,
  validateReportFilters,
  type AggregateReport,
  type ReportExportFormat,
  type ReportModalityFilter,
} from "../../domain/reports/report";
import { deniedPublicError } from "../authorization/authorize";
import type {
  ReportActorProfile,
  ReportActorReader,
  ReportExportRecorder,
  ReportSamplesReader,
  ReportSettingsReader,
  ReportSettingsWriter,
} from "./ports";

/**
 * Casos de uso de reportes agregados, exportación registrada y configuración
 * del umbral mínimo de grupo (TI2-175, ADR-0004).
 */

async function resolveActor<TUserId extends string>(
  actors: ReportActorReader<TUserId>,
  tokenIdentifier: string | null,
): Promise<ReportActorProfile<TUserId> | null> {
  if (tokenIdentifier === null || tokenIdentifier.trim() === "") {
    return null;
  }
  return await actors.findByTokenIdentifier(tokenIdentifier);
}

export type GetAggregateReportInput = {
  readonly tokenIdentifier: string | null;
  readonly from: string;
  readonly to: string;
  readonly modality?: ReportModalityFilter;
};

export type GetAggregateReportDeps<TUserId extends string = string> = {
  readonly actors: ReportActorReader<TUserId>;
  readonly settings: ReportSettingsReader;
  readonly samples: ReportSamplesReader;
};

async function computeReportForFilters(
  deps: {
    readonly settings: ReportSettingsReader;
    readonly samples: ReportSamplesReader;
  },
  input: {
    readonly from: string;
    readonly to: string;
    readonly modality?: ReportModalityFilter;
  },
): Promise<ApiResult<AggregateReport>> {
  const validated = validateReportFilters(input);
  if (!validated.ok) {
    return errResult({
      code: REPORT_FILTERS_INVALID_ERROR_CODE,
      message: validated.message,
    });
  }

  const { startAt, endAt } = civilRangeToInstantRange({
    from: validated.filters.from,
    to: validated.filters.to,
    timeZone: AGENDA_TIME_ZONE,
  });

  const [minimumGroupSize, requestBatch, appointmentBatch] = await Promise.all([
    deps.settings.readMinimumGroupSize(),
    deps.samples.readRequestSamples({
      startAt,
      endAt,
      limit: REPORT_SCAN_LIMIT,
    }),
    deps.samples.readAppointmentSamples({
      startAt,
      endAt,
      // Siempre leemos ambas modalidades del periodo para aplicar supresión
      // complementaria antes de proyectar el filtro de modalidad y evitar
      // fugas por diferencia entre `all`, `inPerson` y `online`.
      modality: "all",
      limit: REPORT_SCAN_LIMIT,
    }),
  ]);

  const report = buildAggregateReport({
    filters: validated.filters,
    minimumGroupSize,
    truncated: requestBatch.truncated || appointmentBatch.truncated,
    requests: requestBatch.samples,
    appointments: appointmentBatch.samples,
  });

  return okResult(report);
}

/** Consulta el reporte agregado para pantalla. Solo Administrador vigente. */
export async function getAggregateReportUseCase<TUserId extends string = string>(
  deps: GetAggregateReportDeps<TUserId>,
  input: GetAggregateReportInput,
): Promise<ApiResult<AggregateReport>> {
  const actor = await resolveActor(deps.actors, input.tokenIdentifier);
  if (actor === null || !canReadAggregateReports(actor)) {
    return errResult(deniedPublicError());
  }
  return await computeReportForFilters(deps, input);
}

export type ExportAggregateReportInput = {
  readonly tokenIdentifier: string | null;
  readonly from: string;
  readonly to: string;
  readonly modality?: ReportModalityFilter;
  readonly format: ReportExportFormat;
};

export type ExportAggregateReportDeps<
  TUserId extends string = string,
  TExportId extends string = string,
> = {
  readonly actors: ReportActorReader<TUserId>;
  readonly settings: ReportSettingsReader;
  readonly samples: ReportSamplesReader;
  readonly exports: ReportExportRecorder<TUserId, TExportId>;
  readonly now: () => number;
};

export type ExportAggregateReportOutput<TExportId extends string = string> = {
  readonly exportId: TExportId;
  readonly exportedAt: number;
  readonly format: ReportExportFormat;
  readonly fileName: string;
  readonly content: string;
  readonly report: AggregateReport;
};

/**
 * Calcula y registra una exportación de reporte agregado (CSV o JSON).
 * Reutiliza exactamente el mismo cálculo que la pantalla para garantizar
 * coincidencia y registra la exportación en `reportExports`.
 */
export async function exportAggregateReportUseCase<
  TUserId extends string = string,
  TExportId extends string = string,
>(
  deps: ExportAggregateReportDeps<TUserId, TExportId>,
  input: ExportAggregateReportInput,
): Promise<ApiResult<ExportAggregateReportOutput<TExportId>>> {
  const actor = await resolveActor(deps.actors, input.tokenIdentifier);
  if (actor === null || !canExportAggregateReports(actor)) {
    return errResult(deniedPublicError());
  }

  if (!(REPORT_EXPORT_FORMAT_VALUES as readonly string[]).includes(input.format)) {
    return errResult({
      code: REPORT_FILTERS_INVALID_ERROR_CODE,
      message: "El formato de exportación no es válido.",
    });
  }

  const reportResult = await computeReportForFilters(deps, input);
  if (reportResult.status === "error") {
    return reportResult;
  }

  const report = reportResult.data;
  const exportedAt = deps.now();
  const exportId = await deps.exports.recordExport({
    actorId: actor.id,
    format: input.format,
    periodFrom: report.metadata.periodFrom,
    periodTo: report.metadata.periodTo,
    modalityFilter: report.metadata.modalityFilter,
    minimumGroupSize: report.metadata.minimumGroupSize,
    truncated: report.metadata.truncated,
    exportedAt,
  });

  const content =
    input.format === "csv"
      ? serializeAggregateReportCsv(report)
      : serializeAggregateReportJson(report);

  const fileName = buildReportExportFileName(
    {
      from: report.metadata.periodFrom,
      to: report.metadata.periodTo,
      modality: report.metadata.modalityFilter,
    },
    input.format,
  );

  return okResult({
    exportId,
    exportedAt,
    format: input.format,
    fileName,
    content,
    report,
  });
}

export type UpdateMinimumGroupSizeInput = {
  readonly tokenIdentifier: string | null;
  readonly minimumGroupSize: number;
};

export type UpdateMinimumGroupSizeDeps<
  TUserId extends string = string,
  TAuditId extends string = string,
> = {
  readonly actors: ReportActorReader<TUserId>;
  readonly settings: ReportSettingsWriter<TUserId, TAuditId>;
  readonly now: () => number;
};

export type UpdateMinimumGroupSizeOutput<TAuditId extends string = string> = {
  readonly previousThreshold: number;
  readonly newThreshold: number;
  readonly auditEventId: TAuditId | null;
};

/**
 * Configura el tamaño mínimo de grupo (>= 5) y registra el cambio en auditoría.
 * Solo Administrador con cuenta habilitada y vigente.
 */
export async function updateMinimumGroupSizeUseCase<
  TUserId extends string = string,
  TAuditId extends string = string,
>(
  deps: UpdateMinimumGroupSizeDeps<TUserId, TAuditId>,
  input: UpdateMinimumGroupSizeInput,
): Promise<ApiResult<UpdateMinimumGroupSizeOutput<TAuditId>>> {
  const actor = await resolveActor(deps.actors, input.tokenIdentifier);
  if (actor === null || !canConfigureReportThreshold(actor)) {
    return errResult(deniedPublicError());
  }

  const validated = validateMinimumGroupSize(input.minimumGroupSize);
  if (!validated.ok) {
    return errResult({
      code: REPORT_FILTERS_INVALID_ERROR_CODE,
      message: validated.message,
    });
  }

  const saved = await deps.settings.saveMinimumGroupSizeWithAudit({
    actorId: actor.id,
    newThreshold: validated.value,
    occurredAt: deps.now(),
  });

  return okResult(saved);
}
