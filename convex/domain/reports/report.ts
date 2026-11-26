/**
 * Reglas puras de reportes agregados, umbral de grupo mínimo y supresión
 * complementaria (TI2-175, ADR-0004).
 *
 * Dominio puro: no importa Convex, React ni Expo y no lee el reloj. Toda la
 * lógica de agregación, supresión primaria, supresión complementaria y
 * serialización de exportaciones (CSV/JSON) vive aquí para garantizar que la
 * pantalla y cada exportación produzcan exactamente los mismos valores,
 * celdas suprimidas y metadatos de cálculo.
 *
 * Nunca incluye nombres, correos, notas internas, necesidades de acceso ni
 * identificadores de personas.
 */

import { AGENDA_TIME_ZONE, isValidCivilDate } from "../availability/availability";
import type { Modality } from "../availability/availability";
import { APPOINTMENT_STATUS_VALUES, type AppointmentStatus } from "../appointments/appointment";
import { REQUEST_STATES, type RequestState } from "../requests/state";

/** Versión del contrato de reportes agregados. */
export const REPORT_CONTRACT_VERSION = 1 as const;

/** Tamaño mínimo de grupo por defecto e invariante inferior (ADR-0004). */
export const DEFAULT_MINIMUM_GROUP_SIZE = 5 as const;

/** Límite superior razonable para el umbral configurable. */
export const MAX_MINIMUM_GROUP_SIZE = 500 as const;

/** Rango máximo de días civiles que una consulta de reporte puede abarcar. */
export const MAX_REPORT_PERIOD_DAYS = 366 as const;

/** Tope de filas leídas por tabla en cada consulta limitada del reporte. */
export const REPORT_SCAN_LIMIT = 500 as const;

/** Formatos de exportación soportados. */
export const REPORT_EXPORT_FORMAT_VALUES = ["csv", "json"] as const;
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMAT_VALUES)[number];

/** Filtro de modalidad para indicadores de atenciones. */
export const REPORT_MODALITY_FILTER_VALUES = ["all", "inPerson", "online"] as const;
export type ReportModalityFilter = (typeof REPORT_MODALITY_FILTER_VALUES)[number];

/** Motivo de supresión de una celda o indicador agregado. */
export const REPORT_SUPPRESSION_REASON_VALUES = ["below_threshold", "complementary"] as const;
export type ReportSuppressionReason = (typeof REPORT_SUPPRESSION_REASON_VALUES)[number];

/** Estados de atención que representan cancelaciones. */
export const CANCELLATION_APPOINTMENT_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  "cancelled_by_student",
  "cancelled_by_cereti",
]);

/** Estados de atención que representan inasistencias. */
export const NO_SHOW_APPOINTMENT_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  "no_show",
  "no_show_justified",
  "no_show_unjustified",
]);

/** Celda agregada: visible con su conteo o suprimida con su motivo. */
export type AggregateCountCell =
  | { readonly suppressed: false; readonly count: number }
  | { readonly suppressed: true; readonly reason: ReportSuppressionReason };

/** Fila de una tabla unidimensional (ej. solicitudes por estado). */
export type RequestStatusReportRow = {
  readonly status: RequestState;
  readonly cell: AggregateCountCell;
};

/** Indicador de tiempos de espera de solicitudes (desde creación hasta primera revisión). */
export type WaitTimeSummary =
  | { readonly status: "empty" }
  | {
      readonly status: "suppressed";
      readonly reason: ReportSuppressionReason;
    }
  | {
      readonly status: "visible";
      readonly sampleCount: number;
      readonly averageHours: number;
      readonly medianHours: number;
    };

/** Fila de la tabla cruzada de atenciones por estado y modalidad. */
export type AppointmentMatrixRow = {
  readonly status: AppointmentStatus;
  readonly inPerson: AggregateCountCell;
  readonly online: AggregateCountCell;
  readonly total: AggregateCountCell;
};

/** Filtros normalizados del reporte agregado. */
export type AggregateReportFilters = {
  readonly from: string;
  readonly to: string;
  readonly modality: ReportModalityFilter;
};

/** Metadatos de cálculo compartidos entre pantalla y exportación. */
export type AggregateReportMetadata = {
  readonly version: typeof REPORT_CONTRACT_VERSION;
  readonly timeZone: typeof AGENDA_TIME_ZONE;
  readonly periodFrom: string;
  readonly periodTo: string;
  readonly modalityFilter: ReportModalityFilter;
  readonly minimumGroupSize: number;
  readonly scanLimit: number;
  readonly truncated: boolean;
  readonly calculationNote: string;
};

/** Reporte agregado completo entregado por el backend y reutilizado en exportaciones. */
export type AggregateReport = {
  readonly metadata: AggregateReportMetadata;
  readonly requests: {
    readonly rows: readonly RequestStatusReportRow[];
    readonly total: AggregateCountCell;
  };
  readonly waitTime: WaitTimeSummary;
  readonly appointments: {
    readonly rows: readonly AppointmentMatrixRow[];
    readonly columnTotals: {
      readonly inPerson: AggregateCountCell;
      readonly online: AggregateCountCell;
    };
    readonly total: AggregateCountCell;
    readonly cancellationsTotal: AggregateCountCell;
    readonly noShowsTotal: AggregateCountCell;
  };
};

/** Datos mínimos de entrada para calcular el reporte agregado (sin datos personales). */
export type ReportRequestSample = {
  readonly status: RequestState;
  readonly createdAt: number;
  readonly firstResponseAt: number | null;
};

export type ReportAppointmentSample = {
  readonly status: AppointmentStatus;
  readonly modality: Modality;
};

export type BuildAggregateReportInput = {
  readonly filters: AggregateReportFilters;
  readonly minimumGroupSize: number;
  readonly truncated: boolean;
  readonly requests: readonly ReportRequestSample[];
  readonly appointments: readonly ReportAppointmentSample[];
};

export type ThresholdValidationResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly message: string };

/**
 * Valida el umbral de grupo mínimo (ADR-0004): debe ser un entero mayor o igual
 * a 5 y dentro del límite superior permitido. Nunca se permite bajar de 5.
 */
export function validateMinimumGroupSize(value: number): ThresholdValidationResult {
  if (!Number.isInteger(value) || value < DEFAULT_MINIMUM_GROUP_SIZE) {
    return {
      ok: false,
      message: `El tamaño mínimo de grupo debe ser un número entero mayor o igual a ${DEFAULT_MINIMUM_GROUP_SIZE}.`,
    };
  }
  if (value > MAX_MINIMUM_GROUP_SIZE) {
    return {
      ok: false,
      message: `El tamaño mínimo de grupo no puede superar ${MAX_MINIMUM_GROUP_SIZE}.`,
    };
  }
  return { ok: true, value };
}

export type ReportFiltersValidationResult =
  | { readonly ok: true; readonly filters: AggregateReportFilters }
  | { readonly ok: false; readonly message: string };

function civilDateToDayNumber(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** Valida periodo civil (`YYYY-MM-DD`) y filtro de modalidad del reporte. */
export function validateReportFilters(input: {
  readonly from: string;
  readonly to: string;
  readonly modality?: ReportModalityFilter;
}): ReportFiltersValidationResult {
  const from = input.from.trim();
  const to = input.to.trim();
  if (!isValidCivilDate(from) || !isValidCivilDate(to)) {
    return {
      ok: false,
      message: "Indica un periodo válido con fechas reales en formato AAAA-MM-DD.",
    };
  }
  const startDay = civilDateToDayNumber(from);
  const endDay = civilDateToDayNumber(to);
  if (endDay < startDay) {
    return {
      ok: false,
      message: "La fecha de término del periodo no puede ser anterior a la fecha de inicio.",
    };
  }
  const daySpan = endDay - startDay + 1;
  if (daySpan > MAX_REPORT_PERIOD_DAYS) {
    return {
      ok: false,
      message: `El periodo consultado no puede superar ${MAX_REPORT_PERIOD_DAYS} días.`,
    };
  }
  const modality: ReportModalityFilter = input.modality ?? "all";
  if (!(REPORT_MODALITY_FILTER_VALUES as readonly string[]).includes(modality)) {
    return {
      ok: false,
      message: "La modalidad seleccionada no es válida.",
    };
  }
  return { ok: true, filters: { from, to, modality } };
}

/** Supresión primaria de una celda individual: oculta si `0 < count < threshold`. */
export function suppressSingleCount(count: number, threshold: number): AggregateCountCell {
  if (count > 0 && count < threshold) {
    return { suppressed: true, reason: "below_threshold" };
  }
  return { suppressed: false, count };
}

/**
 * Aplica supresión primaria y complementaria sobre un vector de conteos con su
 * total. Si exactamente una celda quedó suprimida y el total es visible, oculta
 * también la menor celda visible (> 0) o el total si no hay otra celda visible
 * positiva, evitando que el valor oculto se deduzca por resta.
 */
export function suppressVectorWithTotal(
  counts: readonly number[],
  threshold: number,
): { readonly cells: readonly AggregateCountCell[]; readonly total: AggregateCountCell } {
  const cells: AggregateCountCell[] = counts.map((count) => suppressSingleCount(count, threshold));
  const rawTotal = counts.reduce((sum, count) => sum + count, 0);
  let total: AggregateCountCell = suppressSingleCount(rawTotal, threshold);

  const suppressedIndices = cells
    .map((cell, index) => (cell.suppressed ? index : -1))
    .filter((index) => index !== -1);

  if (suppressedIndices.length === 1 && !total.suppressed) {
    const complementaryIndex = findSmallestPositiveVisibleIndex(cells);
    if (complementaryIndex !== -1) {
      cells[complementaryIndex] = { suppressed: true, reason: "complementary" };
    } else {
      total = { suppressed: true, reason: "complementary" };
    }
  }

  return { cells, total };
}

function findSmallestPositiveVisibleIndex(cells: readonly AggregateCountCell[]): number {
  let bestIndex = -1;
  let bestCount = Number.POSITIVE_INFINITY;
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (cell !== undefined && !cell.suppressed && cell.count > 0 && cell.count < bestCount) {
      bestCount = cell.count;
      bestIndex = index;
    }
  }
  return bestIndex;
}

/**
 * Aplica supresión primaria y complementaria en una tabla bidimensional
 * (filas × columnas) con totales de fila, totales de columna y total general.
 *
 * Itera hasta alcanzar un punto fijo en el que ninguna fila, columna ni vector
 * de totales deja exactamente una celda suprimida frente a un total visible.
 */
export function suppressMatrixWithTotals(
  matrix: readonly (readonly number[])[],
  threshold: number,
): {
  readonly cells: readonly (readonly AggregateCountCell[])[];
  readonly rowTotals: readonly AggregateCountCell[];
  readonly columnTotals: readonly AggregateCountCell[];
  readonly grandTotal: AggregateCountCell;
} {
  const rowCount = matrix.length;
  const colCount = matrix[0]?.length ?? 0;

  const cells: AggregateCountCell[][] = matrix.map((row) =>
    row.map((count) => suppressSingleCount(count, threshold)),
  );
  const rowTotals: AggregateCountCell[] = matrix.map((row) =>
    suppressSingleCount(
      row.reduce((sum, value) => sum + value, 0),
      threshold,
    ),
  );
  const columnTotals: AggregateCountCell[] = Array.from({ length: colCount }, (_, colIndex) => {
    const sum = matrix.reduce((acc, row) => acc + (row[colIndex] ?? 0), 0);
    return suppressSingleCount(sum, threshold);
  });
  const grandTotalRaw = matrix.reduce(
    (acc, row) => acc + row.reduce((rowSum, value) => rowSum + value, 0),
    0,
  );
  let grandTotal: AggregateCountCell = suppressSingleCount(grandTotalRaw, threshold);

  let changed = true;
  while (changed) {
    changed = false;

    // 1. Filas: evitar 1 sola celda oculta con total de fila visible.
    for (let r = 0; r < rowCount; r += 1) {
      const row = cells[r];
      const rowTotal = rowTotals[r];
      if (row === undefined || rowTotal === undefined || rowTotal.suppressed) continue;
      const suppressedCount = row.filter((cell) => cell.suppressed).length;
      if (suppressedCount === 1) {
        const compIdx = findSmallestPositiveVisibleIndex(row);
        if (compIdx !== -1) {
          row[compIdx] = { suppressed: true, reason: "complementary" };
        } else {
          rowTotals[r] = { suppressed: true, reason: "complementary" };
        }
        changed = true;
      }
    }

    // 2. Columnas: evitar 1 sola celda oculta con total de columna visible.
    for (let c = 0; c < colCount; c += 1) {
      const colTotal = columnTotals[c];
      if (colTotal === undefined || colTotal.suppressed) continue;
      const columnCells = cells.map((row) => row[c] as AggregateCountCell);
      const suppressedCount = columnCells.filter((cell) => cell.suppressed).length;
      if (suppressedCount === 1) {
        const compRowIdx = findSmallestPositiveVisibleIndex(columnCells);
        if (compRowIdx !== -1) {
          const targetRow = cells[compRowIdx];
          if (targetRow !== undefined) {
            targetRow[c] = { suppressed: true, reason: "complementary" };
          }
        } else {
          columnTotals[c] = { suppressed: true, reason: "complementary" };
        }
        changed = true;
      }
    }

    // 3. Totales de fila frente al total general.
    if (!grandTotal.suppressed) {
      const suppressedRowTotals = rowTotals.filter((cell) => cell.suppressed).length;
      if (suppressedRowTotals === 1) {
        const compIdx = findSmallestPositiveVisibleIndex(rowTotals);
        if (compIdx !== -1) {
          rowTotals[compIdx] = { suppressed: true, reason: "complementary" };
        } else {
          grandTotal = { suppressed: true, reason: "complementary" };
        }
        changed = true;
      }
    }

    // 4. Totales de columna frente al total general.
    if (!grandTotal.suppressed) {
      const suppressedColTotals = columnTotals.filter((cell) => cell.suppressed).length;
      if (suppressedColTotals === 1) {
        const compIdx = findSmallestPositiveVisibleIndex(columnTotals);
        if (compIdx !== -1) {
          columnTotals[compIdx] = { suppressed: true, reason: "complementary" };
        } else {
          grandTotal = { suppressed: true, reason: "complementary" };
        }
        changed = true;
      }
    }
  }

  return { cells, rowTotals, columnTotals, grandTotal };
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Calcula el resumen de tiempos de espera en horas, sujeto al umbral mínimo. */
export function computeWaitTimeSummary(
  requests: readonly ReportRequestSample[],
  threshold: number,
): WaitTimeSummary {
  const durationsHours: number[] = [];
  for (const request of requests) {
    if (request.firstResponseAt !== null && request.firstResponseAt >= request.createdAt) {
      durationsHours.push((request.firstResponseAt - request.createdAt) / 3_600_000);
    }
  }
  if (durationsHours.length === 0) {
    return { status: "empty" };
  }
  if (durationsHours.length < threshold) {
    return { status: "suppressed", reason: "below_threshold" };
  }
  durationsHours.sort((a, b) => a - b);
  const sum = durationsHours.reduce((acc, value) => acc + value, 0);
  const averageHours = roundToOneDecimal(sum / durationsHours.length);
  const mid = Math.floor(durationsHours.length / 2);
  const rawMedian =
    durationsHours.length % 2 === 1
      ? (durationsHours[mid] ?? 0)
      : ((durationsHours[mid - 1] ?? 0) + (durationsHours[mid] ?? 0)) / 2;
  return {
    status: "visible",
    sampleCount: durationsHours.length,
    averageHours,
    medianHours: roundToOneDecimal(rawMedian),
  };
}

/** Nota de cálculo fija que acompaña pantalla y exportaciones. */
export function buildCalculationNote(minimumGroupSize: number): string {
  return (
    `Conteos agregados en zona horaria ${AGENDA_TIME_ZONE}. ` +
    `Umbral mínimo de grupo: ${minimumGroupSize}. ` +
    `Toda celda positiva menor al umbral se oculta (supresión primaria) y, cuando queda una sola celda oculta frente a un total visible, se oculta otra celda o el total (supresión complementaria). ` +
    `El tiempo de espera mide horas desde la creación de la solicitud hasta la primera transición registrada.`
  );
}

/** Construye el reporte agregado completo desde las muestras acotadas. */
export function buildAggregateReport(input: BuildAggregateReportInput): AggregateReport {
  const { filters, minimumGroupSize, truncated, requests, appointments } = input;

  // 1. Solicitudes por estado.
  const requestCountsByState = new Map<RequestState, number>(
    REQUEST_STATES.map((state) => [state, 0]),
  );
  for (const request of requests) {
    requestCountsByState.set(request.status, (requestCountsByState.get(request.status) ?? 0) + 1);
  }
  const requestCountsVector = REQUEST_STATES.map((state) => requestCountsByState.get(state) ?? 0);
  const suppressedRequests = suppressVectorWithTotal(requestCountsVector, minimumGroupSize);
  const requestRows: RequestStatusReportRow[] = REQUEST_STATES.map((status, index) => ({
    status,
    cell: suppressedRequests.cells[index] as AggregateCountCell,
  }));

  // 2. Tiempos de espera.
  const waitTime = computeWaitTimeSummary(requests, minimumGroupSize);

  // 3. Atenciones por estado × modalidad (inPerson, online).
  const appointmentMatrixRaw: number[][] = APPOINTMENT_STATUS_VALUES.map(() => [0, 0]);
  const statusIndexByValue = new Map<AppointmentStatus, number>(
    APPOINTMENT_STATUS_VALUES.map((status, index) => [status, index]),
  );
  let rawCancellations = 0;
  let rawNoShows = 0;

  for (const appointment of appointments) {
    if (filters.modality !== "all" && appointment.modality !== filters.modality) {
      continue;
    }
    const rowIdx = statusIndexByValue.get(appointment.status);
    if (rowIdx !== undefined) {
      const colIdx = appointment.modality === "inPerson" ? 0 : 1;
      const targetRow = appointmentMatrixRaw[rowIdx];
      if (targetRow !== undefined) {
        targetRow[colIdx] = (targetRow[colIdx] ?? 0) + 1;
      }
    }
    if (CANCELLATION_APPOINTMENT_STATUSES.has(appointment.status)) {
      rawCancellations += 1;
    }
    if (NO_SHOW_APPOINTMENT_STATUSES.has(appointment.status)) {
      rawNoShows += 1;
    }
  }

  const suppressedMatrix = suppressMatrixWithTotals(appointmentMatrixRaw, minimumGroupSize);
  const appointmentRows: AppointmentMatrixRow[] = APPOINTMENT_STATUS_VALUES.map(
    (status, rowIdx) => {
      const rowCells = suppressedMatrix.cells[rowIdx] as readonly AggregateCountCell[];
      return {
        status,
        inPerson: rowCells[0] as AggregateCountCell,
        online: rowCells[1] as AggregateCountCell,
        total: suppressedMatrix.rowTotals[rowIdx] as AggregateCountCell,
      };
    },
  );

  // Subtotales de cancelaciones e inasistencias: si están bajo el umbral se
  // ocultan; además, si la matriz ocultó el total general por supresión
  // complementaria y alguno de estos subtotales podría reconstruirse, se
  // evalúan independientemente con el mismo umbral mínimo.
  const cancellationsTotal = suppressSingleCount(rawCancellations, minimumGroupSize);
  const noShowsTotal = suppressSingleCount(rawNoShows, minimumGroupSize);

  return {
    metadata: {
      version: REPORT_CONTRACT_VERSION,
      timeZone: AGENDA_TIME_ZONE,
      periodFrom: filters.from,
      periodTo: filters.to,
      modalityFilter: filters.modality,
      minimumGroupSize,
      scanLimit: REPORT_SCAN_LIMIT,
      truncated,
      calculationNote: buildCalculationNote(minimumGroupSize),
    },
    requests: {
      rows: requestRows,
      total: suppressedRequests.total,
    },
    waitTime,
    appointments: {
      rows: appointmentRows,
      columnTotals: {
        inPerson: suppressedMatrix.columnTotals[0] as AggregateCountCell,
        online: suppressedMatrix.columnTotals[1] as AggregateCountCell,
      },
      total: suppressedMatrix.grandTotal,
      cancellationsTotal,
      noShowsTotal,
    },
  };
}

function escapeCsvCell(value: string): string {
  // Previene inyección de fórmulas en hojas de cálculo y escapa comas/comillas.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replaceAll('"', '""')}"`;
  }
  return safe;
}

function formatCellForCsv(cell: AggregateCountCell, minimumGroupSize: number): string {
  if (!cell.suppressed) {
    return String(cell.count);
  }
  return cell.reason === "below_threshold"
    ? `Suprimido (< ${minimumGroupSize})`
    : "Suprimido (complementario)";
}

/**
 * Serializa el reporte agregado a CSV coincidente con la pantalla.
 * Incluye periodo, zona horaria, filtros, umbral mínimo y nota de cálculo.
 */
export function serializeAggregateReportCsv(report: AggregateReport): string {
  const { metadata, requests, waitTime, appointments } = report;
  const minSize = metadata.minimumGroupSize;
  const lines: string[] = [];

  const pushRow = (cols: readonly string[]) => {
    lines.push(cols.map(escapeCsvCell).join(","));
  };

  pushRow(["seccion", "indicador", "presencial", "en_linea", "total"]);
  pushRow(["metadatos", "periodo_desde", "", "", metadata.periodFrom]);
  pushRow(["metadatos", "periodo_hasta", "", "", metadata.periodTo]);
  pushRow(["metadatos", "zona_horaria", "", "", metadata.timeZone]);
  pushRow(["metadatos", "filtro_modalidad", "", "", metadata.modalityFilter]);
  pushRow(["metadatos", "grupo_minimo", "", "", String(minSize)]);
  pushRow(["metadatos", "limite_consulta_alcanzado", "", "", metadata.truncated ? "si" : "no"]);
  pushRow(["metadatos", "calculo", "", "", metadata.calculationNote]);

  for (const row of requests.rows) {
    pushRow(["solicitudes", row.status, "", "", formatCellForCsv(row.cell, minSize)]);
  }
  pushRow(["solicitudes", "total", "", "", formatCellForCsv(requests.total, minSize)]);

  if (waitTime.status === "empty") {
    pushRow(["tiempo_espera", "estado", "", "", "Sin datos"]);
  } else if (waitTime.status === "suppressed") {
    pushRow([
      "tiempo_espera",
      "estado",
      "",
      "",
      waitTime.reason === "below_threshold"
        ? `Suprimido (< ${minSize})`
        : "Suprimido (complementario)",
    ]);
  } else {
    pushRow(["tiempo_espera", "muestra", "", "", String(waitTime.sampleCount)]);
    pushRow(["tiempo_espera", "promedio_horas", "", "", String(waitTime.averageHours)]);
    pushRow(["tiempo_espera", "mediana_horas", "", "", String(waitTime.medianHours)]);
  }

  for (const row of appointments.rows) {
    pushRow([
      "atenciones",
      row.status,
      formatCellForCsv(row.inPerson, minSize),
      formatCellForCsv(row.online, minSize),
      formatCellForCsv(row.total, minSize),
    ]);
  }
  pushRow([
    "atenciones",
    "total",
    formatCellForCsv(appointments.columnTotals.inPerson, minSize),
    formatCellForCsv(appointments.columnTotals.online, minSize),
    formatCellForCsv(appointments.total, minSize),
  ]);
  pushRow([
    "resumen_atenciones",
    "cancelaciones_total",
    "",
    "",
    formatCellForCsv(appointments.cancellationsTotal, minSize),
  ]);
  pushRow([
    "resumen_atenciones",
    "inasistencias_total",
    "",
    "",
    formatCellForCsv(appointments.noShowsTotal, minSize),
  ]);

  return lines.join("\r\n");
}

/** Serializa el reporte agregado a JSON coincidente con la pantalla. */
export function serializeAggregateReportJson(report: AggregateReport): string {
  return JSON.stringify(report, null, 2);
}

/** Nombre de archivo determinista para la exportación, sin datos personales. */
export function buildReportExportFileName(
  filters: AggregateReportFilters,
  format: ReportExportFormat,
): string {
  return `cereti-reporte-agregado-${filters.from}-a-${filters.to}-${filters.modality}.${format}`;
}
