// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  REPORT_FILTERS_INVALID_ERROR_CODE,
  UNAUTHORIZED_ERROR_CODE,
  UNAUTHORIZED_ERROR_MESSAGE,
  buildAggregateReport,
  serializeAggregateReportCsv,
} from "../../../../../convex/domain/index.ts";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { AggregateReportData } from "./admin-reports-data.ts";
import { AdminReportsPage } from "./admin-reports.tsx";

const mocks = vi.hoisted(() => ({
  report: undefined as AggregateReportData | Error | undefined,
  exportMutation: vi.fn(),
  thresholdMutation: vi.fn(),
}));

vi.mock("convex/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("convex/react")>();
  const { getFunctionName } = await import("convex/server");
  return {
    ...actual,
    useQuery: () => {
      if (mocks.report instanceof Error) {
        throw mocks.report;
      }
      return mocks.report;
    },
    useMutation: (reference: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(reference);
      if (name.endsWith("exportAggregateReport")) {
        return mocks.exportMutation;
      }
      return mocks.thresholdMutation;
    },
  };
});

function sampleReport(): AggregateReportData {
  const base = Date.UTC(2026, 9, 1, 12, 0);
  return buildAggregateReport({
    filters: { from: "2026-10-01", to: "2026-10-31", modality: "all" },
    minimumGroupSize: 5,
    truncated: false,
    requests: [
      ...Array.from({ length: 6 }, () => ({
        status: "accepted" as const,
        createdAt: base,
        firstResponseAt: base + 3 * 3_600_000,
      })),
      ...Array.from({ length: 5 }, () => ({
        status: "under_review" as const,
        createdAt: base,
        firstResponseAt: base + 5 * 3_600_000,
      })),
      ...Array.from({ length: 2 }, () => ({
        status: "received" as const,
        createdAt: base,
        firstResponseAt: null,
      })),
    ],
    appointments: [
      ...Array.from({ length: 6 }, () => ({
        status: "completed" as const,
        modality: "online" as const,
      })),
      ...Array.from({ length: 5 }, () => ({
        status: "no_show" as const,
        modality: "inPerson" as const,
      })),
      ...Array.from({ length: 2 }, () => ({
        status: "cancelled_by_student" as const,
        modality: "inPerson" as const,
      })),
    ],
  });
}

beforeEach(() => {
  mocks.report = undefined;
  mocks.exportMutation.mockReset();
  mocks.thresholdMutation.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:mock-report");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe("AdminReportsPage (TI2-175)", () => {
  test("muestra estado de carga mientras responde la consulta", () => {
    render(<AdminReportsPage />);
    expect(screen.getByRole("status").textContent).toContain("Cargando reportes agregados");
  });

  test("muestra acceso denegado sin revelar motivo cuando Convex rechaza", () => {
    mocks.report = new ConvexError({
      code: UNAUTHORIZED_ERROR_CODE,
      message: UNAUTHORIZED_ERROR_MESSAGE,
    });
    render(<AdminReportsPage />);
    expect(screen.getByRole("alert").textContent).toContain(UNAUTHORIZED_ERROR_MESSAGE);
  });

  test("muestra periodo, cálculo, grupos visibles, celdas suprimidas y registra exportaciones", async () => {
    const report = sampleReport();
    mocks.report = report;
    mocks.exportMutation.mockResolvedValue({
      exportId: "export-1" as Id<"reportExports">,
      exportedAt: Date.UTC(2026, 10, 1, 12, 0),
      format: "csv",
      fileName: "cereti-reporte-agregado-2026-10-01-a-2026-10-31-all.csv",
      content: serializeAggregateReportCsv(report),
      report,
    });

    render(<AdminReportsPage />);

    expect(screen.getByRole("heading", { name: "Reportes agregados" })).toBeDefined();
    expect(screen.getAllByText(/America\/Santiago/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Suprimido (< 5)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Suprimido (complementario)").length).toBeGreaterThan(0);
    expect(screen.getByText(/promedio/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
    await waitFor(() => {
      expect(mocks.exportMutation).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole("status").textContent).toContain(
      "Exportación CSV generada y registrada",
    );
  });

  test("muestra el mensaje controlado cuando los filtros son rechazados por el backend", () => {
    mocks.report = new ConvexError({
      code: REPORT_FILTERS_INVALID_ERROR_CODE,
      message: "El periodo consultado no puede superar 366 días.",
    });
    render(<AdminReportsPage />);
    expect(screen.getByRole("alert").textContent).toContain(
      "El periodo consultado no puede superar 366 días.",
    );
  });

  test("muestra estado vacío cuando el periodo no tiene solicitudes ni atenciones", () => {
    mocks.report = buildAggregateReport({
      filters: { from: "2026-01-01", to: "2026-01-31", modality: "all" },
      minimumGroupSize: 5,
      truncated: false,
      requests: [],
      appointments: [],
    });
    render(<AdminReportsPage />);
    expect(screen.getByRole("status").textContent).toContain(
      "No hay registros agregados en el periodo seleccionado.",
    );
  });

  test("impide bajar el umbral mínimo por debajo de 5 y permite subirlo", async () => {
    mocks.report = sampleReport();
    mocks.thresholdMutation.mockResolvedValue({
      previousThreshold: 5,
      newThreshold: 8,
      auditEventId: "audit-1" as Id<"reportThresholdChanges">,
    });

    render(<AdminReportsPage />);

    const input = screen.getByLabelText("Tamaño mínimo de grupo");
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Actualizar umbral" }));
    expect(screen.getByRole("alert").textContent).toContain("mayor o igual a 5");
    expect(mocks.thresholdMutation).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Actualizar umbral" }));
    await waitFor(() => {
      expect(mocks.thresholdMutation).toHaveBeenCalledWith({ minimumGroupSize: 8 });
    });
    expect(screen.getByRole("status").textContent).toContain("registrado en auditoría");
  });
});
