import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  DEFAULT_MINIMUM_GROUP_SIZE,
  MAX_MINIMUM_GROUP_SIZE,
  REPORT_FILTERS_INVALID_ERROR_CODE,
  UNAUTHORIZED_ERROR_CODE,
  type AggregateCountCell,
  type ReportExportFormat,
  type ReportModalityFilter,
} from "../../../../../convex/domain/index.ts";
import { publicErrorOf } from "../../infrastructure/convex/public-error.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import "../routes/student-portal.css";
import {
  AGENDA_TIME_ZONE_LABEL,
  civilDateIssue,
  formatCivilDateWithYear,
} from "../shared/date-format.ts";
import {
  ACCESS_DENIED_MESSAGE,
  DeniedState,
  EmptyState,
  ErrorState,
  LoadingState,
} from "../shared/view-states.tsx";
import { adminLoadFallback } from "./admin-load-fallback.tsx";
import {
  appointmentStatusReportLabel,
  defaultReportPeriod,
  downloadReportFile,
  formatAggregateCell,
  modalityFilterLabel,
  requestStatusReportLabel,
  useAggregateReport,
  useExportAggregateReport,
  useUpdateMinimumGroupSize,
  type AggregateReportData,
} from "./admin-reports-data.ts";
import "./admin-reports.css";
import { useToast } from "./use-toast.ts";

/**
 * Reportes agregados con exportación registrada y grupo mínimo (TI2-175).
 *
 * Muestra solicitudes, tiempos de espera, atenciones, cancelaciones e
 * inasistencias de forma agregada. La supresión primaria (< umbral mínimo) y
 * la supresión complementaria viven en el Backend: la pantalla y las
 * exportaciones CSV/JSON muestran exactamente los mismos valores y metadatos,
 * sin datos personales, notas internas ni necesidades de acceso.
 */

const REPORTS_DENIED_HINT =
  "Si crees que deberías consultar reportes agregados, pide acceso por el canal oficial.";

function dateValidationMessage(value: string): string | null {
  const issue = civilDateIssue(value);
  if (issue === "format") return "Usa una fecha válida con formato AAAA-MM-DD.";
  if (issue === "impossible") return "Esa fecha no existe en el calendario.";
  return null;
}

export function AdminReportsPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [initialPeriod] = useState(() => defaultReportPeriod());
  const [fromInput, setFromInput] = useState(initialPeriod.from);
  const [toInput, setToInput] = useState(initialPeriod.to);
  const [modalityInput, setModalityInput] = useState<ReportModalityFilter>("all");
  const [appliedFilters, setAppliedFilters] = useState<{
    readonly from: string;
    readonly to: string;
    readonly modality: ReportModalityFilter;
  }>({
    from: initialPeriod.from,
    to: initialPeriod.to,
    modality: "all",
  });
  const [filterError, setFilterError] = useState<string | null>(null);
  const { toast, showToast } = useToast();

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function handleApplyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fromIssue = dateValidationMessage(fromInput);
    if (fromIssue !== null) {
      setFilterError(`Fecha de inicio: ${fromIssue}`);
      return;
    }
    const toIssue = dateValidationMessage(toInput);
    if (toIssue !== null) {
      setFilterError(`Fecha de término: ${toIssue}`);
      return;
    }
    if (toInput < fromInput) {
      setFilterError("La fecha de término no puede ser anterior a la fecha de inicio.");
      return;
    }
    setFilterError(null);
    setAppliedFilters({
      from: fromInput.trim(),
      to: toInput.trim(),
      modality: modalityInput,
    });
  }

  return (
    <section aria-labelledby="admin-reports-title">
      <h1 id="admin-reports-title" ref={headingRef} tabIndex={-1}>
        Reportes agregados
      </h1>
      <p>
        Consulta indicadores agregados de solicitudes, tiempos de espera, atenciones, cancelaciones
        e inasistencias. Los grupos menores al umbral mínimo se ocultan automáticamente con
        supresión complementaria.
      </p>
      <p className="student-portal__item-meta">
        Todas las fechas del periodo se calculan en zona horaria {AGENDA_TIME_ZONE_LABEL}. No se
        muestran ni exportan datos personales, notas internas ni necesidades de acceso.
      </p>

      <form
        className="admin-reports__filters"
        aria-label="Filtros del reporte agregado"
        onSubmit={handleApplyFilters}
        noValidate
      >
        <div className="admin-reports__field">
          <label htmlFor="report-from">Desde (AAAA-MM-DD)</label>
          <input
            id="report-from"
            name="from"
            type="date"
            value={fromInput}
            onChange={(event) => setFromInput(event.target.value)}
          />
        </div>
        <div className="admin-reports__field">
          <label htmlFor="report-to">Hasta (AAAA-MM-DD)</label>
          <input
            id="report-to"
            name="to"
            type="date"
            value={toInput}
            onChange={(event) => setToInput(event.target.value)}
          />
        </div>
        <div className="admin-reports__field">
          <label htmlFor="report-modality">Modalidad de atención</label>
          <select
            id="report-modality"
            name="modality"
            value={modalityInput}
            onChange={(event) => setModalityInput(event.target.value as ReportModalityFilter)}
          >
            <option value="all">Todas las modalidades</option>
            <option value="inPerson">Presencial</option>
            <option value="online">En línea</option>
          </select>
        </div>
        <div className="admin-reports__actions">
          <button type="submit" className="student-portal__btn student-portal__btn--primary">
            Aplicar filtros
          </button>
        </div>
      </form>

      {filterError !== null ? (
        <p role="alert" className="student-portal__error">
          {filterError}
        </p>
      ) : null}

      <StudentPanelErrorBoundary
        subject="los reportes agregados"
        level="section"
        fallback={adminLoadFallback}
      >
        <AdminReportsContent filters={appliedFilters} notify={showToast} />
      </StudentPanelErrorBoundary>

      {toast !== null ? (
        <p role="status" className="toast">
          {toast}
        </p>
      ) : null}
    </section>
  );
}

function ReportCellValue({
  cell,
  minimumGroupSize,
}: {
  cell: AggregateCountCell;
  minimumGroupSize: number;
}) {
  const text = formatAggregateCell(cell, minimumGroupSize);
  if (!cell.suppressed) {
    return <span>{text}</span>;
  }
  return <span className="admin-reports__suppressed">{text}</span>;
}

function AdminReportsContent({
  filters,
  notify,
}: {
  filters: { readonly from: string; readonly to: string; readonly modality: ReportModalityFilter };
  notify: (message: string) => void;
}) {
  let report: AggregateReportData | undefined;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    report = useAggregateReport(filters);
  } catch (error) {
    const publicError = publicErrorOf(error);
    if (publicError?.code === UNAUTHORIZED_ERROR_CODE) {
      return <DeniedState tone="admin" description={REPORTS_DENIED_HINT} />;
    }
    if (publicError?.code === REPORT_FILTERS_INVALID_ERROR_CODE) {
      return <ErrorState tone="admin" message={publicError.message} />;
    }
    throw error;
  }

  if (report === undefined) {
    return <LoadingState label="Cargando reportes agregados…" />;
  }

  return <AdminReportsLoaded report={report} filters={filters} notify={notify} />;
}

function AdminReportsLoaded({
  report,
  filters,
  notify,
}: {
  report: AggregateReportData;
  filters: { readonly from: string; readonly to: string; readonly modality: ReportModalityFilter };
  notify: (message: string) => void;
}) {
  const exportReport = useExportAggregateReport();
  const updateThreshold = useUpdateMinimumGroupSize();
  const [exporting, setExporting] = useState<ReportExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [thresholdDraft, setThresholdDraft] = useState<string | null>(null);
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [thresholdError, setThresholdError] = useState<string | null>(null);

  const { metadata, requests, waitTime, appointments } = report;
  const minSize = metadata.minimumGroupSize;
  const thresholdInput = thresholdDraft ?? String(minSize);
  const isPeriodEmpty =
    !requests.total.suppressed &&
    requests.total.count === 0 &&
    !appointments.total.suppressed &&
    appointments.total.count === 0;

  async function handleExport(format: ReportExportFormat) {
    if (exporting !== null) return;
    setExporting(format);
    setExportError(null);
    try {
      const result = await exportReport({
        from: filters.from,
        to: filters.to,
        modality: filters.modality,
        format,
      });
      downloadReportFile({
        fileName: result.fileName,
        content: result.content,
        format: result.format,
      });
      notify(`Exportación ${format.toUpperCase()} generada y registrada (${result.fileName}).`);
    } catch (error) {
      const publicError = publicErrorOf(error);
      if (publicError !== null) {
        setExportError(
          publicError.code === UNAUTHORIZED_ERROR_CODE
            ? ACCESS_DENIED_MESSAGE
            : publicError.message,
        );
      } else {
        setExportError("No pudimos generar la exportación. Inténtalo de nuevo.");
      }
    } finally {
      setExporting(null);
    }
  }

  async function handleThresholdSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingThreshold) return;
    const parsed = Number(thresholdInput.trim());
    if (!Number.isInteger(parsed) || parsed < DEFAULT_MINIMUM_GROUP_SIZE) {
      setThresholdError(
        `El tamaño mínimo de grupo debe ser un entero mayor o igual a ${DEFAULT_MINIMUM_GROUP_SIZE}.`,
      );
      return;
    }
    if (parsed > MAX_MINIMUM_GROUP_SIZE) {
      setThresholdError(`El tamaño mínimo de grupo no puede superar ${MAX_MINIMUM_GROUP_SIZE}.`);
      return;
    }
    setSavingThreshold(true);
    setThresholdError(null);
    try {
      const result = await updateThreshold({ minimumGroupSize: parsed });
      setThresholdDraft(null);
      if (result.auditEventId !== null) {
        notify(
          `Tamaño mínimo de grupo actualizado de ${result.previousThreshold} a ${result.newThreshold} y registrado en auditoría.`,
        );
      } else {
        notify(`El tamaño mínimo de grupo ya estaba configurado en ${result.newThreshold}.`);
      }
    } catch (error) {
      const publicError = publicErrorOf(error);
      if (publicError !== null) {
        setThresholdError(
          publicError.code === UNAUTHORIZED_ERROR_CODE
            ? ACCESS_DENIED_MESSAGE
            : publicError.message,
        );
      } else {
        setThresholdError("No pudimos actualizar el tamaño mínimo de grupo. Inténtalo de nuevo.");
      }
    } finally {
      setSavingThreshold(false);
    }
  }

  return (
    <>
      <section aria-labelledby="report-metadata-title" className="admin-reports__meta">
        <h2 id="report-metadata-title" className="sr-only">
          Contexto y cálculo del reporte
        </h2>
        <dl className="admin-reports__meta-grid">
          <div>
            <dt>Periodo</dt>
            <dd>
              {formatCivilDateWithYear(metadata.periodFrom)} al{" "}
              {formatCivilDateWithYear(metadata.periodTo)}
            </dd>
          </div>
          <div>
            <dt>Zona horaria</dt>
            <dd>{metadata.timeZone}</dd>
          </div>
          <div>
            <dt>Modalidad</dt>
            <dd>{modalityFilterLabel(metadata.modalityFilter)}</dd>
          </div>
          <div>
            <dt>Tamaño mínimo de grupo</dt>
            <dd>{minSize}</dd>
          </div>
        </dl>
        <p className="admin-reports__note">{metadata.calculationNote}</p>
        {metadata.truncated ? (
          <p role="status" className="student-portal__error">
            La consulta alcanzó el límite de {metadata.scanLimit} registros por tabla; acota el
            periodo para revisar el detalle completo.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="report-summary-title" className="student-portal__section">
        <div className="student-portal__section-head">
          <h2 id="report-summary-title">Resumen general</h2>
          <div className="admin-reports__actions">
            <button
              type="button"
              className="student-portal__btn student-portal__btn--secondary"
              disabled={exporting !== null}
              aria-busy={exporting === "csv"}
              onClick={() => void handleExport("csv")}
            >
              {exporting === "csv" ? "Exportando CSV…" : "Exportar CSV"}
            </button>
            <button
              type="button"
              className="student-portal__btn student-portal__btn--secondary"
              disabled={exporting !== null}
              aria-busy={exporting === "json"}
              onClick={() => void handleExport("json")}
            >
              {exporting === "json" ? "Exportando JSON…" : "Exportar JSON"}
            </button>
          </div>
        </div>
        {exportError !== null ? (
          <p role="alert" className="student-portal__error">
            {exportError}
          </p>
        ) : null}

        {isPeriodEmpty ? (
          <EmptyState title="No hay registros agregados en el periodo seleccionado.">
            <p>
              Ajusta las fechas o la modalidad para consultar un periodo con solicitudes o
              atenciones registradas.
            </p>
          </EmptyState>
        ) : null}

        <div className="admin-reports__summary">
          <article className="admin-reports__metric">
            <p className="admin-reports__metric-label">Solicitudes en el periodo</p>
            <p className="admin-reports__metric-value">
              <ReportCellValue cell={requests.total} minimumGroupSize={minSize} />
            </p>
          </article>
          <article className="admin-reports__metric">
            <p className="admin-reports__metric-label">Tiempo de espera (solicitudes)</p>
            {waitTime.status === "empty" ? (
              <p className="admin-reports__metric-value">Sin datos</p>
            ) : waitTime.status === "suppressed" ? (
              <p className="admin-reports__metric-value">
                <span className="admin-reports__suppressed">
                  {waitTime.reason === "below_threshold"
                    ? `Suprimido (< ${minSize})`
                    : "Suprimido (complementario)"}
                </span>
              </p>
            ) : (
              <>
                <p className="admin-reports__metric-value">{waitTime.averageHours} h promedio</p>
                <p className="admin-reports__metric-sub">
                  Mediana: {waitTime.medianHours} h · Muestra: {waitTime.sampleCount}
                </p>
              </>
            )}
          </article>
          <article className="admin-reports__metric">
            <p className="admin-reports__metric-label">Atenciones en el periodo</p>
            <p className="admin-reports__metric-value">
              <ReportCellValue cell={appointments.total} minimumGroupSize={minSize} />
            </p>
          </article>
          <article className="admin-reports__metric">
            <p className="admin-reports__metric-label">Cancelaciones</p>
            <p className="admin-reports__metric-value">
              <ReportCellValue cell={appointments.cancellationsTotal} minimumGroupSize={minSize} />
            </p>
          </article>
          <article className="admin-reports__metric">
            <p className="admin-reports__metric-label">Inasistencias</p>
            <p className="admin-reports__metric-value">
              <ReportCellValue cell={appointments.noShowsTotal} minimumGroupSize={minSize} />
            </p>
          </article>
        </div>
      </section>

      <section aria-labelledby="report-requests-title" className="student-portal__section">
        <h2 id="report-requests-title">Solicitudes por estado</h2>
        <div className="admin-reports__table-wrap">
          <table className="admin-reports__table">
            <thead>
              <tr>
                <th scope="col">Estado</th>
                <th scope="col">Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {requests.rows.map((row) => (
                <tr key={row.status}>
                  <th scope="row">{requestStatusReportLabel(row.status)}</th>
                  <td>
                    <ReportCellValue cell={row.cell} minimumGroupSize={minSize} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total solicitudes</th>
                <td>
                  <ReportCellValue cell={requests.total} minimumGroupSize={minSize} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section aria-labelledby="report-appointments-title" className="student-portal__section">
        <h2 id="report-appointments-title">Atenciones, cancelaciones e inasistencias</h2>
        <div className="admin-reports__table-wrap">
          <table className="admin-reports__table">
            <thead>
              <tr>
                <th scope="col">Estado</th>
                <th scope="col">Presencial</th>
                <th scope="col">En línea</th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {appointments.rows.map((row) => (
                <tr key={row.status}>
                  <th scope="row">{appointmentStatusReportLabel(row.status)}</th>
                  <td>
                    <ReportCellValue cell={row.inPerson} minimumGroupSize={minSize} />
                  </td>
                  <td>
                    <ReportCellValue cell={row.online} minimumGroupSize={minSize} />
                  </td>
                  <td>
                    <ReportCellValue cell={row.total} minimumGroupSize={minSize} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total atenciones</th>
                <td>
                  <ReportCellValue
                    cell={appointments.columnTotals.inPerson}
                    minimumGroupSize={minSize}
                  />
                </td>
                <td>
                  <ReportCellValue
                    cell={appointments.columnTotals.online}
                    minimumGroupSize={minSize}
                  />
                </td>
                <td>
                  <ReportCellValue cell={appointments.total} minimumGroupSize={minSize} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section aria-labelledby="report-threshold-title" className="student-portal__section">
        <h2 id="report-threshold-title">Configuración del grupo mínimo</h2>
        <p className="student-portal__item-meta">
          El mínimo permitido es {DEFAULT_MINIMUM_GROUP_SIZE} y solo puede configurarse hacia
          arriba. Cada cambio queda registrado en la auditoría.
        </p>
        <form
          className="admin-reports__threshold-form"
          onSubmit={(event) => void handleThresholdSubmit(event)}
          noValidate
        >
          <div className="admin-reports__field">
            <label htmlFor="report-min-group-size">Tamaño mínimo de grupo</label>
            <input
              id="report-min-group-size"
              name="minimumGroupSize"
              type="number"
              min={DEFAULT_MINIMUM_GROUP_SIZE}
              max={MAX_MINIMUM_GROUP_SIZE}
              step={1}
              value={thresholdInput}
              onChange={(event) => setThresholdDraft(event.target.value)}
            />
          </div>
          <button
            type="submit"
            className="student-portal__btn student-portal__btn--primary"
            disabled={savingThreshold}
            aria-busy={savingThreshold}
          >
            {savingThreshold ? "Guardando…" : "Actualizar umbral"}
          </button>
        </form>
        {thresholdError !== null ? (
          <p role="alert" className="student-portal__error">
            {thresholdError}
          </p>
        ) : null}
      </section>
    </>
  );
}
