/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

/**
 * Pruebas de integración de reportes agregados, supresión primaria y
 * complementaria, configuración auditada del umbral y exportación registrada
 * (TI2-175).
 */

const ADMIN_IDENTITY = {
  issuer: "test",
  subject: "admin-reportes",
  tokenIdentifier: "test|admin-reportes",
  email: "admin.reportes@uct.cl",
  name: "Admin Reportes",
};

const PROFESSIONAL_IDENTITY = {
  issuer: "test",
  subject: "prof-reportes",
  tokenIdentifier: "test|prof-reportes",
  email: "prof.reportes@uct.cl",
  name: "Prof Reportes",
};

const STUDENT_IDENTITY = {
  issuer: "test",
  subject: "est-reportes",
  tokenIdentifier: "test|est-reportes",
  email: "est.reportes@alu.uct.cl",
  name: "Est Reportes",
};

async function seedActors(t: ReturnType<typeof convexTest>) {
  vi.stubEnv("TEST_SEEDS_ENABLED", "true");
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      email: ADMIN_IDENTITY.email,
      fullName: ADMIN_IDENTITY.name,
      role: "admin",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: ADMIN_IDENTITY.tokenIdentifier,
    });
  });
  await t.mutation(internal.operations.users.createTestUser, {
    email: PROFESSIONAL_IDENTITY.email,
    fullName: PROFESSIONAL_IDENTITY.name,
    role: "professional",
    institutionalStatus: "enabled",
    accountStatus: "active",
    tokenIdentifier: PROFESSIONAL_IDENTITY.tokenIdentifier,
  });
  await t.mutation(internal.operations.users.createTestUser, {
    email: STUDENT_IDENTITY.email,
    fullName: STUDENT_IDENTITY.name,
    role: "student",
    institutionalStatus: "enabled",
    accountStatus: "active",
    tokenIdentifier: STUDENT_IDENTITY.tokenIdentifier,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("reportes agregados (TI2-175)", () => {
  test("solo el Administrador con cuenta vigente consulta, exporta y configura el umbral", async () => {
    const t = convexTest(schema, modules);
    await seedActors(t);

    // Sin sesión
    await expect(
      t.query(api.presentation.reports.getAggregateReport, {
        from: "2026-10-01",
        to: "2026-10-31",
      }),
    ).rejects.toThrow("No autorizado");

    // Profesional denegado
    await expect(
      t.withIdentity(PROFESSIONAL_IDENTITY).query(api.presentation.reports.getAggregateReport, {
        from: "2026-10-01",
        to: "2026-10-31",
      }),
    ).rejects.toThrow("No autorizado");

    // Estudiante denegado en exportación y configuración
    await expect(
      t.withIdentity(STUDENT_IDENTITY).mutation(api.presentation.reports.exportAggregateReport, {
        from: "2026-10-01",
        to: "2026-10-31",
        format: "csv",
      }),
    ).rejects.toThrow("No autorizado");

    await expect(
      t.withIdentity(STUDENT_IDENTITY).mutation(api.presentation.reports.updateMinimumGroupSize, {
        minimumGroupSize: 7,
      }),
    ).rejects.toThrow("No autorizado");
  });

  test("pantalla y exportación coinciden con las muestras ficticias y ocultan grupos menores al mínimo", async () => {
    const t = convexTest(schema, modules);
    await seedActors(t);
    expect(await t.mutation(internal.operations.fictitiousData.loadReportSamples, {})).toEqual({
      loaded: true,
    });
    // Idempotente
    expect(await t.mutation(internal.operations.fictitiousData.loadReportSamples, {})).toEqual({
      loaded: false,
    });

    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const screenReport = await asAdmin.query(api.presentation.reports.getAggregateReport, {
      from: "2026-10-01",
      to: "2026-10-31",
      modality: "all",
    });

    expect(screenReport.metadata.minimumGroupSize).toBe(5);
    expect(screenReport.metadata.timeZone).toBe("America/Santiago");
    expect(screenReport.metadata.periodFrom).toBe("2026-10-01");
    expect(screenReport.metadata.periodTo).toBe("2026-10-31");

    // Solicitudes: 6 accepted, 5 under_review, 2 received (< 5).
    // `received` queda suprimido por umbral; `under_review` por complementaria.
    const received = screenReport.requests.rows.find((row) => row.status === "received");
    const underReview = screenReport.requests.rows.find((row) => row.status === "under_review");
    const accepted = screenReport.requests.rows.find((row) => row.status === "accepted");
    expect(received?.cell).toEqual({ suppressed: true, reason: "below_threshold" });
    expect(underReview?.cell).toEqual({ suppressed: true, reason: "complementary" });
    expect(accepted?.cell).toEqual({ suppressed: false, count: 6 });
    expect(screenReport.requests.total).toEqual({ suppressed: false, count: 13 });

    // Tiempo de espera: 11 solicitudes con transición (>= 5 -> visible).
    expect(screenReport.waitTime.status).toBe("visible");
    if (screenReport.waitTime.status === "visible") {
      expect(screenReport.waitTime.sampleCount).toBe(11);
    }

    // Cancelaciones (2 < 5) suprimido; inasistencias (5 >= 5) visible.
    expect(screenReport.appointments.cancellationsTotal).toEqual({
      suppressed: true,
      reason: "below_threshold",
    });
    expect(screenReport.appointments.noShowsTotal).toEqual({ suppressed: false, count: 5 });

    // Exportación JSON coincide exactamente con la pantalla y queda registrada.
    const jsonExport = await asAdmin.mutation(api.presentation.reports.exportAggregateReport, {
      from: "2026-10-01",
      to: "2026-10-31",
      modality: "all",
      format: "json",
    });
    expect(jsonExport.report).toEqual(screenReport);
    expect(JSON.parse(jsonExport.content)).toEqual(screenReport);

    // Exportación CSV coincide con la pantalla y no contiene correos ni nombres.
    const csvExport = await asAdmin.mutation(api.presentation.reports.exportAggregateReport, {
      from: "2026-10-01",
      to: "2026-10-31",
      modality: "all",
      format: "csv",
    });
    expect(csvExport.content).toContain("solicitudes,received,,,Suprimido (< 5)");
    expect(csvExport.content).toContain("solicitudes,under_review,,,Suprimido (complementario)");
    expect(csvExport.content).toContain("solicitudes,accepted,,,6");
    expect(csvExport.content).not.toContain("@alu.uct.cl");
    expect(csvExport.content).not.toContain("Estudiante Reporte Ficticio");

    // Ambas exportaciones quedaron registradas en `reportExports`.
    const recordedExports = await t.run(async (ctx) => {
      return await ctx.db.query("reportExports").collect();
    });
    expect(recordedExports).toHaveLength(2);
    expect(recordedExports.map((row) => row.format).sort()).toEqual(["csv", "json"]);
  });

  test("el umbral se configura solo desde 5 hacia arriba y cada cambio queda auditado", async () => {
    const t = convexTest(schema, modules);
    await seedActors(t);
    await t.mutation(internal.operations.fictitiousData.loadReportSamples, {});
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);

    // Nunca por debajo de 5
    await expect(
      asAdmin.mutation(api.presentation.reports.updateMinimumGroupSize, {
        minimumGroupSize: 4,
      }),
    ).rejects.toThrow("mayor o igual a 5");

    // Subir a 7 registra evento en auditoría y suprime el grupo de 6.
    const updated = await asAdmin.mutation(api.presentation.reports.updateMinimumGroupSize, {
      minimumGroupSize: 7,
    });
    expect(updated.previousThreshold).toBe(5);
    expect(updated.newThreshold).toBe(7);
    expect(updated.auditEventId).not.toBeNull();

    const auditEvents = await t.run(async (ctx) => {
      return await ctx.db.query("reportThresholdAuditEvents").collect();
    });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]).toMatchObject({
      previousThreshold: 5,
      newThreshold: 7,
    });

    const reportAfterRaise = await asAdmin.query(api.presentation.reports.getAggregateReport, {
      from: "2026-10-01",
      to: "2026-10-31",
      modality: "all",
    });
    expect(reportAfterRaise.metadata.minimumGroupSize).toBe(7);
    // Ahora `accepted` (6 < 7) también queda suprimido.
    const accepted = reportAfterRaise.requests.rows.find((row) => row.status === "accepted");
    expect(accepted?.cell).toEqual({ suppressed: true, reason: "below_threshold" });
  });
});
