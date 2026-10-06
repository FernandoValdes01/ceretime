import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { expandAvailabilitySlots } from "./fixtures/pr73-availability";
import { decideFinding, verifyAssessment, publishable } from "./ai-review-verification.cjs";
import { publishFindings } from "./ai-review-chunks.cjs";
const sha = "a".repeat(40),
  path = ".github/fixtures/pr73-availability.ts";
const source = readFileSync(`${import.meta.dir}/fixtures/pr73-availability.ts`, "utf8");
const date = "2026-10-05";
const window = (startMinute = 600, spaceId = "a") => ({
  startMinute,
  endMinute: startMinute + 30,
  slotMinutes: 30,
  modality: "inPerson" as const,
  spaceId,
});
const input = (blocks: any[] = [], exceptions: any[] = []) => ({
  professionalId: "professional",
  blocks,
  exceptions,
  from: date,
  to: date,
  timeZone: "UTC",
});
const added = (start: number) => ({ date, kind: "added", windows: [window(start)], version: "v1" });
const candidates = ["const key =", "dayExceptions.some", "slots.sort"]
  .map((needle) => source.split("\n").findIndex((line) => line.includes(needle)) + 1)
  .map((line, index) => ({
    path,
    line,
    side: "RIGHT",
    severity: "important",
    issue_key: ["added-collision", "cancel-added", "sort-ids"][index],
    cause: [
      "La clave kind y blockId colisiona entre dos agregados distintos.",
      "El continue de cancelled descarta las ventanas added.",
      "El sort final cambia IDs ya asignados.",
    ][index],
    impact: "Resultado de expansión incorrecto.",
    fix: "Conservar el contrato.",
    body: "Defecto funcional.",
  }));
const part = {
  path,
  patch: "",
  anchors: candidates.map((f) => `RIGHT:${f.line}`),
  context: [{ path, head: source, headComplete: true }],
};
const proof = (index: number, extra = {}) => ({
  index,
  issue_key: candidates[index].issue_key,
  verdict: index === 2 ? "refuted" : "confirmed",
  symbol: "expandAvailabilitySlots",
  input:
    index === 0
      ? "Dos added distintos en la misma fecha"
      : index === 1
        ? "cancelled sin blockId y added para la misma fecha"
        : "Invertir tres bloques con inicios iguales",
  actual: index === 0 ? "Lanza excepción" : index === 1 ? "0 cupos" : "IDs y espacios estables",
  expected: index === 0 ? "2 cupos" : index === 1 ? "1 cupo" : "IDs y espacios estables",
  trace:
    index === 2
      ? "compareWindows ordena ventanas y expandWindow asigna IDs antes del sort"
      : "La condición de la expansión produce el resultado observado",
  counterevidence:
    "Comprobados los validadores, la prioridad documentada y el productor de identidad antes del sort",
  expectedContract: {
    path,
    quote: "y el agregado convive con ambas.",
    rule: "Cada agregado conserva sus ventanas e identidad; convive con cancelaciones.",
  },
  impactTrace:
    "La expansión devuelve cupos: dos agregados deberían producir dos cupos y una cancelación con agregado debe conservar el agregado.",
  references: [
    {
      path,
      quote:
        index === 0
          ? 'const key = `${exception.kind}|${exception.blockId ?? ""}`;'
          : index === 1
            ? 'dayExceptions.some((e) => e.kind === "cancelled" && e.blockId === undefined)'
            : "const ordered = [...dayWindows].sort(compareWindows);",
    },
  ],
  ...extra,
});
test("PR73 archived defects remain demonstrable and stable identities refute the third finding", () => {
  expect(() => expandAvailabilitySlots(input([], [added(600), added(660)]))).toThrow(
    "más de una excepción",
  );
  expect(
    expandAvailabilitySlots(input([], [{ date, kind: "cancelled", version: "v1" }, added(600)])),
  ).toHaveLength(0);
  const blocks = ["c", "a", "b"].map((spaceId) => ({
    ...window(600, spaceId),
    id: spaceId,
    professionalId: "professional",
    weekday: 1,
    version: "v1",
  }));
  const normal = expandAvailabilitySlots(input(blocks));
  expect(normal).toHaveLength(3);
  expect(expandAvailabilitySlots(input([...blocks].reverse()))).toEqual(normal);
  expect(normal.map((s) => [s.spaceId, s.id.split("#")[1] ?? "0"])).toEqual([
    ["a", "0"],
    ["b", "1"],
    ["c", "2"],
  ]);
});
for (const extra of [
  { input: "" },
  { actual: "" },
  { symbol: "nonexistent" },
  { references: [{ path, quote: "invented unsupported quotation" }] },
  { verdict: "insufficient" },
  { counterevidence: "" },
  { expectedContract: undefined },
  {
    expectedContract: {
      path,
      quote: "a new obligation invented by the reviewer",
      rule: "invented",
    },
  },
  { impactTrace: "" },
])
  test(`unproven candidate is omitted ${JSON.stringify(extra)}`, () => {
    expect(decideFinding(candidates[0], proof(0, extra), part)).toBe("insufficient");
  });
test("proof can preserve true positives without increasing confidence thresholds", () => {
  expect(decideFinding(candidates[0], proof(0), part)).toBe("confirmed");
  expect(decideFinding(candidates[1], proof(1), part)).toBe("confirmed");
  expect(decideFinding(candidates[2], proof(2), part)).toBe("refuted");
  expect(decideFinding(candidates[0], { verdict: "refuted" }, part)).toBe("insufficient");
});
test("real verifier publishes only the two witnessed defects and validates proof integrity", async () => {
  const result = await verifyAssessment({
    assessment: { findings: candidates, limitations: [], resolutions: [] },
    chunk: { parts: [part] },
    sha,
    apiKey: "fixture",
    budget: 1,
    isCurrent: async () => true,
    fetchImpl: async (_url: string, request: any) => {
      const messages = JSON.parse(request.body).messages;
      expect(messages[0].content).toContain("evidencia que contradiga");
      expect(messages[1].content).toContain("compareWindows");
      expect(messages[1].content).toContain("takenIds.set");
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify({ decisions: [proof(0), proof(1), proof(2)] }) },
            },
          ],
        }),
      };
    },
  });
  expect(result.assessment.findings.map((f: any) => f.issue_key)).toEqual([
    "added-collision",
    "cancel-added",
  ]);
  expect(result.assessment.limitations).toEqual([]);
  expect(publishable(result.assessment.findings[0], sha)).toBe(true);
  expect(publishable({ ...result.assessment.findings[0], cause: "tampered" }, sha)).toBe(false);
  expect(publishable(result.assessment.findings[0], "b".repeat(40))).toBe(false);
  const writes: any[] = [];
  const github = {
    paginate: async () => [],
    rest: {
      pulls: { listReviewComments: () => {}, createReview: async (x: any) => writes.push(x) },
    },
  };
  await publishFindings({
    github,
    args: { owner: "owner", repo: "repo", pull_number: 73 },
    sha,
    botLogin: "bot",
    report: { sha, findings: result.assessment.findings },
  });
  expect(writes[0].comments).toHaveLength(2);
  await expect(
    publishFindings({
      github,
      args: {},
      sha,
      botLogin: "bot",
      report: { sha, findings: [candidates[2]] },
    }),
  ).rejects.toThrow();
});
test("exhausted verification budget omits findings and leaves coverage incomplete", async () => {
  const result = await verifyAssessment({
    assessment: { findings: [candidates[0]], limitations: [], resolutions: [] },
    chunk: { parts: [part] },
    sha,
    budget: 0,
    isCurrent: async () => true,
    fetchImpl: async () => {
      throw Error("unexpected inference");
    },
  });
  expect(result.assessment.findings).toEqual([]);
  expect(result.assessment.limitations).toHaveLength(1);
});
test("prepare candidates, verify behavior and aggregate without publishing the sort finding", async () => {
  const { buildPlan, reviewPlan } = await import("./ai-review-chunks.cjs");
  const lines = source.trimEnd().split("\n");
  const plan = buildPlan(
    [
      {
        filename: path,
        status: "added",
        additions: 3,
        deletions: 0,
        patch: candidates
          .map((f) => `@@ -${f.line},0 +${f.line} @@\n+${lines[f.line - 1]}`)
          .join("\n"),
        context: part.context,
      },
    ],
    {},
    sha,
  );
  expect(plan.issues).toEqual([]);
  let calls = 0;
  const report = await reviewPlan({
    plan,
    instructions: "Contract regression.",
    apiKey: "fixture",
    sleep: async () => {},
    fetchImpl: async (_url: string, request: any) => {
      calls++;
      const payload = JSON.parse(request.body);
      const verification = payload.messages[0].content.startsWith(
        "Verifica de forma independiente",
      );
      const result = verification
        ? { decisions: [proof(0), proof(1), proof(2)] }
        : { findings: candidates };
      return {
        ok: true,
        headers: new Headers(),
        json: async () => ({
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }],
        }),
      };
    },
  });
  expect(calls).toBe(2);
  expect(report.calls).toBe(2);
  expect(report.reasons).toEqual([]);
  expect(report.coverage).toBe("complete");
  expect(report.score).toBe(2);
  expect(report.findings.map((f: any) => f.issue_key)).toEqual(["added-collision", "cancel-added"]);
});
test("verification 429 retains the candidate and honors Retry-After without repeating detection", async () => {
  const { buildPlan, reviewPlan } = await import("./ai-review-chunks.cjs");
  const f = candidates[0];
  const line = source.split("\n")[f.line - 1];
  const plan = buildPlan(
    [
      {
        filename: path,
        status: "added",
        additions: 1,
        deletions: 0,
        patch: `@@ -${f.line},0 +${f.line} @@\n+${line}`,
        context: part.context,
      },
    ],
    {},
    sha,
  );
  const phases: string[] = [],
    pauses: number[] = [];
  const report = await reviewPlan({
    plan,
    instructions: "Contract regression.",
    apiKey: "fixture",
    sleep: async (ms: number) => {
      pauses.push(ms);
    },
    fetchImpl: async (_url: string, request: any) => {
      const verification = JSON.parse(request.body).messages[0].content.startsWith(
        "Verifica de forma independiente",
      );
      phases.push(verification ? "verify" : "detect");
      if (phases.length === 2)
        return {
          ok: false,
          status: 429,
          headers: new Headers({ "retry-after": "60" }),
          json: async () => ({ error: { message: "rate limit" } }),
        };
      return {
        ok: true,
        headers: new Headers(),
        json: async () => ({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify(
                  verification ? { decisions: [proof(0)] } : { findings: [f] },
                ),
              },
            },
          ],
        }),
      };
    },
  });
  expect(phases).toEqual(["detect", "verify", "verify"]);
  expect(pauses.some((ms) => ms >= 60000)).toBe(true);
  expect(report.calls).toBe(3);
  expect(report.coverage).toBe("complete");
  expect(report.findings).toHaveLength(1);
});
test("failed verification cannot certify 5/5 by regenerating a different detection", async () => {
  const { buildPlan, reviewPlan } = await import("./ai-review-chunks.cjs");
  const f = candidates[0];
  const plan = buildPlan(
    [
      {
        filename: path,
        status: "added",
        additions: 1,
        deletions: 0,
        patch: `@@ -${f.line},0 +${f.line} @@\n+${source.split("\n")[f.line - 1]}`,
        context: part.context,
      },
    ],
    {},
    sha,
  );
  let calls = 0;
  const report = await reviewPlan({
    plan,
    instructions: "Regression.",
    apiKey: "fixture",
    sleep: async () => {},
    fetchImpl: async () => {
      calls++;
      if (calls === 2) return { ok: false, status: 503 };
      return {
        ok: true,
        headers: new Headers(),
        json: async () => ({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify({ findings: calls === 1 ? [f] : [] }) },
            },
          ],
        }),
      };
    },
  });
  expect(calls).toBe(2);
  expect(report.coverage).toBe("incomplete");
  expect(report.score).toBe(0);
  expect(report.findings).toEqual([]);
});
test("lack of verification budget cannot maintain a prior finding", async () => {
  const result = await verifyAssessment({
    assessment: {
      findings: [{ ...candidates[0], threadId: "1" }],
      limitations: [],
      resolutions: [{ id: "1", status: "maintain", explanation: "Pending candidate." }],
    },
    chunk: { parts: [part] },
    sha,
    budget: 0,
    isCurrent: async () => true,
  });
  expect(result.assessment.findings).toEqual([]);
  expect(result.assessment.resolutions[0].status).toBe("needs_context");
});

test("live reviewer regressions refute busy-state, payload accounting and declaration-completeness claims", () => {
  const evidencePath = ".github/ai-review-evidence.cjs";
  const providerPath =
    "apps/mobile/src/presentation/accessibility/accessibility-preferences-provider.tsx";
  const evidenceSource = readFileSync(`${import.meta.dir}/ai-review-evidence.cjs`, "utf8");
  const providerSource = readFileSync(`${import.meta.dir}/../${providerPath}`, "utf8");
  const cases = [
    {
      path: providerPath,
      source: providerSource,
      symbol: "AccessibilityPreferencesProvider",
      quote: 'setStatus("loading");',
      actual: "false mientras status informa loading",
      claim: "No se distingue ocupado de fallo",
    },
    {
      path: evidencePath,
      source: evidenceSource,
      symbol: "recoverEvidence",
      quote: "recoveredChars += text.length;",
      actual: "El acumulador cuenta exactamente los caracteres transmitidos",
      claim: "Los imports se cuentan doble y agotan un presupuesto ficticio",
    },
    {
      path: evidencePath,
      source: evidenceSource,
      symbol: "recoverEvidence",
      quote: "declarationComplete: end === selected.text.length,",
      actual: "Archivo parcial, declaración completa y cero solicitudes pendientes",
      claim: "headComplete false obliga otra recuperación",
    },
  ];
  for (const item of cases) {
    const candidate = { ...candidates[0], path: item.path, cause: item.claim };
    const available = {
      path: item.path,
      patch: "",
      context: [{ path: item.path, head: item.source }],
    };
    const observation = {
      ...proof(0),
      symbol: item.symbol,
      actual: item.claim,
      expected: item.actual,
      expectedContract: undefined,
      references: [{ path: item.path, quote: item.quote }],
    };
    expect(decideFinding(candidate, observation, available)).toBe("insufficient");
    expect(
      decideFinding(
        candidate,
        {
          ...observation,
          verdict: "refuted",
          actual: item.actual,
          expected: item.actual,
          counterevidence:
            "El productor, el contrato y el consumidor muestran que el comportamiento observado cumple la regla vigente.",
        },
        available,
      ),
    ).toBe("refuted");
  }
});
