import { describe, expect, test } from "vitest";
import {
  DEFAULT_MINIMUM_GROUP_SIZE,
  buildAggregateReport,
  buildReportExportFileName,
  computeWaitTimeSummary,
  serializeAggregateReportCsv,
  serializeAggregateReportJson,
  suppressMatrixWithTotals,
  suppressVectorWithTotal,
  validateMinimumGroupSize,
  validateReportFilters,
  type ReportAppointmentSample,
  type ReportRequestSample,
} from "./report";

describe("validateMinimumGroupSize", () => {
  test("acepta 5 por defecto y valores enteros superiores", () => {
    expect(validateMinimumGroupSize(5)).toEqual({ ok: true, value: 5 });
    expect(validateMinimumGroupSize(10)).toEqual({ ok: true, value: 10 });
  });

  test("rechaza valores menores a 5, decimales o fuera de límite", () => {
    expect(validateMinimumGroupSize(4).ok).toBe(false);
    expect(validateMinimumGroupSize(0).ok).toBe(false);
    expect(validateMinimumGroupSize(-1).ok).toBe(false);
    expect(validateMinimumGroupSize(5.5).ok).toBe(false);
    expect(validateMinimumGroupSize(501).ok).toBe(false);
  });
});

describe("validateReportFilters", () => {
  test("acepta un periodo civil válido y modalidad por defecto", () => {
    expect(validateReportFilters({ from: "2026-09-01", to: "2026-10-31" })).toEqual({
      ok: true,
      filters: { from: "2026-09-01", to: "2026-10-31", modality: "all" },
    });
  });

  test("rechaza fechas inexistentes, rango invertido o superior a 366 días", () => {
    expect(validateReportFilters({ from: "2026-02-29", to: "2026-03-01" }).ok).toBe(false);
    expect(validateReportFilters({ from: "2026-10-10", to: "2026-10-01" }).ok).toBe(false);
    expect(validateReportFilters({ from: "2025-01-01", to: "2026-06-01" }).ok).toBe(false);
  });
});

describe("suppressVectorWithTotal", () => {
  test("aplica supresión primaria y complementaria cuando queda una sola celda oculta", () => {
    // 6 >= 5 (visible), 3 < 5 (supresión primaria), 0 (cero), 8 >= 5 (visible)
    // Total = 17 (>= 5). Como hay 1 sola celda suprimida, se suprime la menor
    // celda positiva visible (6) por supresión complementaria.
    const result = suppressVectorWithTotal([6, 3, 0, 8], DEFAULT_MINIMUM_GROUP_SIZE);
    expect(result.cells).toEqual([
      { suppressed: true, reason: "complementary" },
      { suppressed: true, reason: "below_threshold" },
      { suppressed: false, count: 0 },
      { suppressed: false, count: 8 },
    ]);
    expect(result.total).toEqual({ suppressed: false, count: 17 });
  });

  test("suprime el total por complementariedad si no existe otra celda positiva visible", () => {
    // Una sola celda de 2 (< 5) y todas las demás 0: el total es 2 (< 5),
    // ya queda suprimido por umbral.
    const smallOnly = suppressVectorWithTotal([2, 0, 0], 5);
    expect(smallOnly.cells[0]).toEqual({ suppressed: true, reason: "below_threshold" });
    expect(smallOnly.total).toEqual({ suppressed: true, reason: "below_threshold" });
  });

  test("no aplica supresión complementaria si ya hay dos o más celdas suprimidas", () => {
    const result = suppressVectorWithTotal([2, 3, 7], 5);
    expect(result.cells).toEqual([
      { suppressed: true, reason: "below_threshold" },
      { suppressed: true, reason: "below_threshold" },
      { suppressed: false, count: 7 },
    ]);
    expect(result.total).toEqual({ suppressed: false, count: 12 });
  });
});

describe("suppressMatrixWithTotals", () => {
  test("oculta celdas complementarias en fila y columna para impedir deducción por resta", () => {
    // Fila 0: [6, 2] -> total 8 (1 suprimida -> oculta 6)
    // Fila 1: [7, 6] -> total 13 (en col 1 había 1 suprimida -> oculta 6; en fila 1 queda 1 suprimida -> oculta 7)
    const result = suppressMatrixWithTotals(
      [
        [6, 2],
        [7, 6],
      ],
      5,
    );
    // Ninguna fila con total visible puede tener exactamente 1 celda suprimida.
    const violatingRows = result.cells.filter(
      (row, r) => !result.rowTotals[r]?.suppressed && row.filter((c) => c.suppressed).length === 1,
    );
    expect(violatingRows).toHaveLength(0);
    // Ninguna columna con total visible puede tener exactamente 1 celda suprimida.
    const violatingCols = result.columnTotals.filter(
      (colTotal, c) =>
        !colTotal.suppressed && result.cells.filter((row) => row[c]?.suppressed).length === 1,
    );
    expect(violatingCols).toHaveLength(0);
    expect(result.cells[0]?.[1]).toEqual({ suppressed: true, reason: "below_threshold" });
    expect(result.cells[0]?.[0]).toEqual({ suppressed: true, reason: "complementary" });
  });
});

describe("computeWaitTimeSummary", () => {
  test("suprime el tiempo de espera cuando la muestra es menor al umbral", () => {
    const base = Date.UTC(2026, 9, 1, 10, 0);
    const samples: ReportRequestSample[] = [
      { status: "under_review", createdAt: base, firstResponseAt: base + 2 * 3_600_000 },
      { status: "accepted", createdAt: base, firstResponseAt: base + 4 * 3_600_000 },
    ];
    expect(computeWaitTimeSummary(samples, 5)).toEqual({
      status: "suppressed",
      reason: "below_threshold",
    });
  });

  test("calcula promedio y mediana cuando la muestra alcanza el umbral", () => {
    const base = Date.UTC(2026, 9, 1, 10, 0);
    const hours = [1, 2, 3, 4, 10];
    const samples: ReportRequestSample[] = hours.map((h) => ({
      status: "accepted",
      createdAt: base,
      firstResponseAt: base + h * 3_600_000,
    }));
    expect(computeWaitTimeSummary(samples, 5)).toEqual({
      status: "visible",
      sampleCount: 5,
      averageHours: 4,
      medianHours: 3,
    });
  });
});

describe("buildAggregateReport y exportaciones coincidentes", () => {
  test("pantalla, CSV y JSON coinciden y ocultan grupos menores al mínimo", () => {
    const base = Date.UTC(2026, 9, 1, 12, 0);
    const requests: ReportRequestSample[] = [
      ...Array.from({ length: 6 }, () => ({
        status: "accepted" as const,
        createdAt: base,
        firstResponseAt: base + 2 * 3_600_000,
      })),
      ...Array.from({ length: 2 }, () => ({
        status: "received" as const,
        createdAt: base,
        firstResponseAt: null,
      })),
      ...Array.from({ length: 5 }, () => ({
        status: "under_review" as const,
        createdAt: base,
        firstResponseAt: base + 4 * 3_600_000,
      })),
    ];
    const appointments: ReportAppointmentSample[] = [
      ...Array.from({ length: 6 }, () => ({
        status: "completed" as const,
        modality: "inPerson" as const,
      })),
      ...Array.from({ length: 5 }, () => ({
        status: "completed" as const,
        modality: "online" as const,
      })),
      ...Array.from({ length: 2 }, () => ({
        status: "cancelled_by_student" as const,
        modality: "inPerson" as const,
      })),
      ...Array.from({ length: 5 }, () => ({
        status: "no_show" as const,
        modality: "inPerson" as const,
      })),
    ];

    const report = buildAggregateReport({
      filters: { from: "2026-10-01", to: "2026-10-31", modality: "all" },
      minimumGroupSize: 5,
      truncated: false,
      requests,
      appointments,
    });

    // `received` (2 < 5) queda suprimida por umbral y `under_review` (5) por complementaria.
    const receivedRow = report.requests.rows.find((row) => row.status === "received");
    const underReviewRow = report.requests.rows.find((row) => row.status === "under_review");
    const acceptedRow = report.requests.rows.find((row) => row.status === "accepted");
    expect(receivedRow?.cell).toEqual({ suppressed: true, reason: "below_threshold" });
    expect(underReviewRow?.cell).toEqual({ suppressed: true, reason: "complementary" });
    expect(acceptedRow?.cell).toEqual({ suppressed: false, count: 6 });

    // Cancelaciones (2 < 5) suprimido; `no_show` (5) quedó protegido por
    // supresión complementaria en la matriz para que nadie calcule 18 - 11 - 5 = 2,
    // así que `noShowsTotal` también queda suprimido de forma complementaria.
    expect(report.appointments.cancellationsTotal).toEqual({
      suppressed: true,
      reason: "below_threshold",
    });
    expect(report.appointments.noShowsTotal).toEqual({
      suppressed: true,
      reason: "complementary",
    });

    // CSV y JSON reflejan exactamente los mismos datos y metadatos.
    const csv = serializeAggregateReportCsv(report);
    expect(csv).toContain("metadatos,periodo_desde,,,2026-10-01");
    expect(csv).toContain("metadatos,periodo_hasta,,,2026-10-31");
    expect(csv).toContain("metadatos,zona_horaria,,,America/Santiago");
    expect(csv).toContain("metadatos,grupo_mínimo,,,5");
    expect(csv).toContain("solicitudes,received,,,Suprimido (< 5)");
    expect(csv).toContain("solicitudes,under_review,,,Suprimido (complementario)");
    expect(csv).toContain("solicitudes,accepted,,,6");
    expect(csv).toContain("resumen_atenciones,cancelaciones_total,,,Suprimido (< 5)");
    expect(csv).toContain("resumen_atenciones,inasistencias_total,,,Suprimido (complementario)");

    const parsedJson = JSON.parse(serializeAggregateReportJson(report));
    expect(parsedJson).toEqual(report);

    expect(
      buildReportExportFileName({ from: "2026-10-01", to: "2026-10-31", modality: "all" }, "csv"),
    ).toBe("cereti-reporte-agregado-2026-10-01-a-2026-10-31-all.csv");
  });

  test("suprime el subtotal de cancelaciones cuando un estado es < umbral y otro visible", () => {
    const appointments: ReportAppointmentSample[] = [
      ...Array.from({ length: 6 }, () => ({
        status: "cancelled_by_cereti" as const,
        modality: "online" as const,
      })),
      ...Array.from({ length: 2 }, () => ({
        status: "cancelled_by_student" as const,
        modality: "online" as const,
      })),
      ...Array.from({ length: 7 }, () => ({
        status: "completed" as const,
        modality: "online" as const,
      })),
      ...Array.from({ length: 5 }, () => ({
        status: "no_show" as const,
        modality: "inPerson" as const,
      })),
      ...Array.from({ length: 5 }, () => ({
        status: "completed" as const,
        modality: "inPerson" as const,
      })),
    ];

    const report = buildAggregateReport({
      filters: { from: "2026-10-01", to: "2026-10-31", modality: "all" },
      minimumGroupSize: 5,
      truncated: false,
      requests: [],
      appointments,
    });

    // `cancelled_by_student` (2) < 5 y `cancelled_by_cereti` (6) recibe supresión
    // complementaria; si `cancellationsTotal` mostrara 8 y quedara una sola fila
    // oculta o revelara la suma frente al resto, se protege con supresión complementaria.
    expect(report.appointments.cancellationsTotal.suppressed).toBe(true);
  });

  test("filtrar por una sola modalidad no revela celdas protegidas por supresión complementaria", () => {
    const appointments: ReportAppointmentSample[] = [
      ...Array.from({ length: 6 }, () => ({
        status: "completed" as const,
        modality: "online" as const,
      })),
      ...Array.from({ length: 2 }, () => ({
        status: "completed" as const,
        modality: "inPerson" as const,
      })),
      ...Array.from({ length: 5 }, () => ({
        status: "no_show" as const,
        modality: "online" as const,
      })),
    ];

    const allReport = buildAggregateReport({
      filters: { from: "2026-10-01", to: "2026-10-31", modality: "all" },
      minimumGroupSize: 5,
      truncated: false,
      requests: [],
      appointments,
    });
    const onlineReport = buildAggregateReport({
      filters: { from: "2026-10-01", to: "2026-10-31", modality: "online" },
      minimumGroupSize: 5,
      truncated: false,
      requests: [],
      appointments,
    });

    const completedAll = allReport.appointments.rows.find((row) => row.status === "completed");
    const completedOnline = onlineReport.appointments.rows.find(
      (row) => row.status === "completed",
    );
    expect(completedAll?.inPerson).toEqual({ suppressed: true, reason: "below_threshold" });
    expect(completedAll?.online).toEqual({ suppressed: true, reason: "complementary" });
    // Al filtrar por `online`, la celda sigue protegida por supresión complementaria.
    expect(completedOnline?.online).toEqual({ suppressed: true, reason: "complementary" });
    expect(completedOnline?.total).toEqual({ suppressed: true, reason: "complementary" });
  });

  test("muestra subtotales visibles cuando sus filas superan el umbral y no rompen supresión complementaria", () => {
    const appointments: ReportAppointmentSample[] = [
      ...Array.from({ length: 6 }, () => ({
        status: "completed" as const,
        modality: "inPerson" as const,
      })),
      ...Array.from({ length: 5 }, () => ({
        status: "no_show" as const,
        modality: "inPerson" as const,
      })),
      ...Array.from({ length: 2 }, () => ({
        status: "cancelled_by_student" as const,
        modality: "inPerson" as const,
      })),
      ...Array.from({ length: 3 }, () => ({
        status: "cancelled_by_cereti" as const,
        modality: "inPerson" as const,
      })),
    ];

    const report = buildAggregateReport({
      filters: { from: "2026-10-01", to: "2026-10-31", modality: "all" },
      minimumGroupSize: 5,
      truncated: false,
      requests: [],
      appointments,
    });

    // Como hay dos filas de cancelación suprimidas (< 5), `no_show` no requiere
    // supresión complementaria y tanto `noShowsTotal` (5) como `cancellationsTotal` (5)
    // son seguros y visibles sin revelar 2 ni 3.
    expect(report.appointments.noShowsTotal).toEqual({ suppressed: false, count: 5 });
    expect(report.appointments.cancellationsTotal).toEqual({ suppressed: false, count: 5 });
  });
});
