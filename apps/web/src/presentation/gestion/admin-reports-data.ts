import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../../convex/_generated/api";
import {
  AGENDA_TIME_ZONE,
  REQUEST_STATE_LABELS,
  civilDateOfInstant,
  type AggregateCountCell,
  type AppointmentStatus,
  type ReportExportFormat,
  type ReportModalityFilter,
  type RequestState,
} from "../../../../../convex/domain/index.ts";

/**
 * Lecturas, exportaciones y configuración de reportes agregados para
 * Administración (TI2-175).
 *
 * Cableado delgado sobre `api.presentation.reports`: la autorización, el
 * cálculo con consultas limitadas, la supresión primaria/complementaria y el
 * registro de exportaciones y auditoría viven en el Backend.
 */

export type AggregateReportData = NonNullable<
  FunctionReturnType<typeof api.presentation.reports.getAggregateReport>
>;

export type ExportAggregateReportResult = FunctionReturnType<
  typeof api.presentation.reports.exportAggregateReport
>;

export function useAggregateReport(
  args:
    | { readonly from: string; readonly to: string; readonly modality: ReportModalityFilter }
    | "skip",
) {
  return useQuery(api.presentation.reports.getAggregateReport, args);
}

export function useExportAggregateReport() {
  return useMutation(api.presentation.reports.exportAggregateReport);
}

export function useUpdateMinimumGroupSize() {
  return useMutation(api.presentation.reports.updateMinimumGroupSize);
}

/** Periodo inicial por defecto: mes civil en curso en `America/Santiago`. */
export function defaultReportPeriod(nowMs: number = Date.now()): {
  readonly from: string;
  readonly to: string;
} {
  const today = civilDateOfInstant(nowMs, AGENDA_TIME_ZONE);
  const monthStart = `${today.slice(0, 7)}-01`;
  return { from: monthStart, to: today };
}

/** Etiqueta legible del estado de una solicitud, desde el contrato de dominio. */
export function requestStatusReportLabel(status: RequestState): string {
  return REQUEST_STATE_LABELS[status];
}

/** Etiqueta legible del estado de una atención en reportes agregados. */
export function appointmentStatusReportLabel(status: AppointmentStatus): string {
  switch (status) {
    case "scheduled":
      return "Agendada";
    case "completed":
      return "Realizada";
    case "cancelled_by_student":
      return "Cancelada por estudiante";
    case "cancelled_by_cereti":
      return "Cancelada por CERETI";
    case "rescheduled":
      return "Reagendada";
    case "no_show":
      return "Inasistencia pendiente";
    case "no_show_justified":
      return "Inasistencia justificada";
    case "no_show_unjustified":
      return "Inasistencia sin justificar";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/** Etiqueta legible del filtro de modalidad. */
export function modalityFilterLabel(modality: ReportModalityFilter): string {
  switch (modality) {
    case "all":
      return "Todas las modalidades";
    case "inPerson":
      return "Presencial";
    case "online":
      return "En línea";
    default: {
      const _exhaustive: never = modality;
      return _exhaustive;
    }
  }
}

/** Texto accesible de una celda agregada, coincidente con la exportación CSV. */
export function formatAggregateCell(cell: AggregateCountCell, minimumGroupSize: number): string {
  if (!cell.suppressed) {
    return String(cell.count);
  }
  return cell.reason === "below_threshold"
    ? `Suprimido (< ${minimumGroupSize})`
    : "Suprimido (complementario)";
}

/** Descarga en el navegador el archivo exacto generado por el Backend. */
export function downloadReportFile(input: {
  readonly fileName: string;
  readonly content: string;
  readonly format: ReportExportFormat;
}): void {
  const mimeType =
    input.format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8";
  const blob = new Blob([input.content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = input.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
