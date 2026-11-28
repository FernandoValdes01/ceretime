import { describe, expect, test } from "vitest";
import type { PrivacyDataCategory } from "../../domain/privacy/privacy_controls";
import {
  guardPrivacyTreatment,
  type ActivePrivacyBlockForGuard,
  type PrivacyBlockGuardDeps,
  type PrivacyTreatment,
  type PrivacyTreatmentResult,
} from "./blocking";

/**
 * Pruebas del guardia único del bloqueo temporal (TI2-168).
 *
 * El estado del bloqueo se deriva del dominio, nunca de una columna paralela.
 * Acá se fijan los cuatro estados, el alcance total y por categoría, y las
 * decisiones del guardia para los cuatro tratamientos que declara (consulta,
 * cambio, aviso y exportación). El efecto real de cada vía se comprueba en su
 * propia prueba de API o de caso de uso: aquí el doble solo verifica que, al
 * estar bloqueado, ninguna vía muta el registro.
 */

const NOW = Date.UTC(2026, 10, 15, 12);
const SUBJECT = "usr-titular";

function sampleBlock(
  overrides: Partial<ActivePrivacyBlockForGuard> = {},
): ActivePrivacyBlockForGuard {
  return {
    id: "block-1",
    scope: "all_personal_data",
    startsAt: NOW - 60_000,
    endsAt: NOW + 60_000,
    ...overrides,
  };
}

function guardDeps(
  blocks: readonly ActivePrivacyBlockForGuard[],
  now: number = NOW,
): PrivacyBlockGuardDeps<string> {
  return {
    blocks: {
      listActiveBlocksForSubject: async (subjectId) => (subjectId === SUBJECT ? blocks : []),
    },
    now: () => now,
  };
}

async function decide(
  blocks: readonly ActivePrivacyBlockForGuard[],
  treatment: PrivacyTreatment,
  category: PrivacyDataCategory,
  now: number = NOW,
): Promise<PrivacyTreatmentResult> {
  return await guardPrivacyTreatment(guardDeps(blocks, now), {
    subjectId: SUBJECT,
    category,
    treatment,
  });
}

/**
 * Cuatro vías mínimas sobre el mismo registro. Solo mutan cuando el guardia
 * dice `ok`; así la prueba comprueba el efecto comprobado y la conservación.
 */
interface TreatmentRecord {
  value: string;
  reads: number;
  deliveries: number;
  exported: boolean;
}

async function applyTreatment(
  treatment: PrivacyTreatment,
  decision: PrivacyTreatmentResult,
  record: TreatmentRecord,
): Promise<void> {
  if (decision.status === "blocked") return;
  if (treatment === "query") {
    record.reads += 1;
    return;
  }
  if (treatment === "change") {
    record.value = "Modificado";
    return;
  }
  if (treatment === "notice") {
    record.deliveries += 1;
    return;
  }
  record.exported = true;
}

function freshRecord(): TreatmentRecord {
  return { value: "Original", reads: 0, deliveries: 0, exported: false };
}

const TREATMENTS = ["query", "change", "notice", "export"] as const;

const EFFECT_APPLIED: Record<PrivacyTreatment, (record: TreatmentRecord) => boolean> = {
  query: (record) => record.reads === 1,
  change: (record) => record.value === "Modificado",
  notice: (record) => record.deliveries === 1,
  export: (record) => record.exported,
};

describe("guardPrivacyTreatment", () => {
  test("un bloqueo vigente de alcance total bloquea los cuatro tratamientos sin alterar los datos", async () => {
    for (const treatment of TREATMENTS) {
      const record = freshRecord();
      const decision = await decide([sampleBlock()], treatment, "appointments");
      expect(decision).toEqual({
        status: "blocked",
        treatment,
        blockId: "block-1",
        scope: "all_personal_data",
        endsAt: NOW + 60_000,
      });
      await applyTreatment(treatment, decision, record);
      expect(record).toEqual(freshRecord());
    }
  });

  test("sin bloqueo las cuatro vías siguen y el guardia no inventa un blockId", async () => {
    for (const treatment of TREATMENTS) {
      const record = freshRecord();
      const decision = await decide([], treatment, "appointments");
      expect(decision).toEqual({ status: "ok", treatment });
      await applyTreatment(treatment, decision, record);
      expect(EFFECT_APPLIED[treatment](record)).toBe(true);
    }
  });

  test("un bloqueo programado todavía no suspende", async () => {
    const decision = await decide([sampleBlock({ startsAt: NOW + 1 })], "query", "appointments");
    expect(decision).toEqual({ status: "ok", treatment: "query" });
  });

  test("un bloqueo vencido deja el tratamiento en curso", async () => {
    const decision = await decide([sampleBlock({ endsAt: NOW })], "query", "appointments");
    expect(decision).toEqual({ status: "ok", treatment: "query" });
  });

  test("un bloqueo levantado deja el tratamiento en curso aunque esté dentro de la ventana", async () => {
    const decision = await decide([sampleBlock({ liftedAt: NOW - 1000 })], "query", "appointments");
    expect(decision).toEqual({ status: "ok", treatment: "query" });
  });

  test("el alcance total cubre cualquier categoría inventariada", async () => {
    const categories: readonly PrivacyDataCategory[] = [
      "accompaniment_requests",
      "accompaniments",
      "appointments",
      "follow_up",
      "notifications",
      "calendar",
      "account_profile",
      "audit_records",
    ];
    for (const category of categories) {
      const decision = await decide([sampleBlock()], "query", category);
      expect(decision.status).toBe("blocked");
    }
  });

  test("un bloqueo de otra categoría no cubre la categoría consultada", async () => {
    const decision = await decide(
      [sampleBlock({ scope: "calendar", id: "block-calendar" })],
      "query",
      "appointments",
    );
    expect(decision).toEqual({ status: "ok", treatment: "query" });
  });

  test("un bloqueo de la categoría exacta sí cubre esa categoría", async () => {
    const decision = await decide(
      [sampleBlock({ scope: "notifications", id: "block-notice" })],
      "notice",
      "notifications",
    );
    expect(decision).toEqual({
      status: "blocked",
      treatment: "notice",
      blockId: "block-notice",
      scope: "notifications",
      endsAt: NOW + 60_000,
    });
  });

  test("el reloj entra por dependencia: un bloqueo activo hoy puede estar vencido mañana", async () => {
    const block = sampleBlock();
    expect((await decide([block], "export", "calendar")).status).toBe("blocked");
    expect((await decide([block], "export", "calendar", block.endsAt)).status).toBe("ok");
  });

  test("un bloqueo ajeno al titular nunca se aplica", async () => {
    const decision = await guardPrivacyTreatment(guardDeps([sampleBlock()]), {
      subjectId: "otro",
      category: "appointments",
      treatment: "query",
    });
    expect(decision).toEqual({ status: "ok", treatment: "query" });
  });
});
