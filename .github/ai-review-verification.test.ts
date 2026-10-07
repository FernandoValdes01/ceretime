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
  context: [
    {
      path,
      head: source,
      headComplete: true,
      evidenceSelector: { symbols: ["expandAvailabilitySlots"] },
    },
  ],
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
    quote:
      "la cancelación de un día elimina el día completo, la cancelación con `blockId` descuenta solo ese bloque y conserva los demás, y el agregado convive con ambas.",
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
test("an implementation expression cannot serve as its own expected contract", () => {
  const candidate = { ...candidates[0], path: ".github/ai-review-evidence.cjs" };
  const part = {
    path: candidate.path,
    patch: "",
    context: [
      {
        path: candidate.path,
        head: "const capacity = MAX_RECOVERED - recoveredChars - imports.length;",
      },
    ],
  };
  expect(
    decideFinding(
      candidate,
      {
        ...proof(0),
        expectedContract: {
          path: candidate.path,
          quote: "const capacity = MAX_RECOVERED - recoveredChars - imports.length;",
          rule: "recoveredChars must exclude imports",
        },
      },
      part,
    ),
  ).toBe("insufficient");
});
test("historical contracts cannot validate a candidate against the current head", () => {
  const candidate = {
    ...candidates[0],
    path: "worker.ts",
    line: 1,
    side: "RIGHT",
  };
  const available = {
    path: candidate.path,
    patch: "@@ -0,0 +1 @@\n[RIGHT:1] +export function worker() { return allowedQuota; }",
    anchors: ["RIGHT:1"],
    context: [
      {
        path: "worker.ts",
        head: "export function worker() { return allowedQuota; }",
        base: "export function worker() { return allowedQuota; }",
      },
      {
        path: "quota.ts",
        head: "export const allowedQuota = 20;",
        base: "export const allowedQuota = 10;",
      },
    ],
  };
  const historicalOnly = {
    ...proof(0),
    symbol: "worker",
    actual: "20",
    expected: "10",
    expectedContract: {
      path: "quota.ts",
      quote: "export const allowedQuota = 10;",
      rule: "The quota remains ten.",
    },
    references: [
      { path: "worker.ts", quote: "export function worker() { return allowedQuota; }" },
      { path: "quota.ts", side: "base", quote: "export const allowedQuota = 10;" },
    ],
  };
  expect(decideFinding(candidate, historicalOnly, available)).toBe("insufficient");
  expect(
    decideFinding(
      candidate,
      {
        ...historicalOnly,
        expected: "20",
        expectedContract: {
          path: "quota.ts",
          quote: "export const allowedQuota = 20;",
          rule: "The current quota is twenty.",
        },
        references: [
          { path: "worker.ts", quote: "export function worker() { return allowedQuota; }" },
          { path: "quota.ts", quote: "export const allowedQuota = 10;" },
        ],
      },
      available,
    ),
  ).toBe("insufficient");
  expect(
    decideFinding(
      candidate,
      {
        ...historicalOnly,
        expected: "20",
        expectedContract: {
          path: "quota.ts",
          quote: "export const allowedQuota = 20;",
          rule: "The current quota is twenty.",
        },
      },
      available,
    ),
  ).toBe("refuted");
});
test("the verifier confirms a deleted function from its LEFT patch when base context is clipped", async () => {
  const currentPath = "apps/web/src/amount.ts";
  const historicalPath = "apps/web/src/old-amount.ts";
  const contractPath = "apps/web/src/amount-consumer.ts";
  const candidate = {
    path: currentPath,
    line: 9,
    side: "LEFT",
    severity: "important",
    issue_key: "deleted-multiplier",
    cause: "El diff elimina el multiplicador del cálculo del importe.",
    impact: "El importe calculado deja de seguir el contrato.",
    fix: "Conservar el cálculo que exige el contrato.",
  };
  const historicalPart = {
    path: currentPath,
    change: { oldPath: historicalPath, newPath: currentPath },
    anchors: ["LEFT:9"],
    patch: [
      "@@ -8,3 +7,0 @@",
      "[LEFT:8] -export function calculateFare(amount: number) {",
      "[LEFT:9] -  return amount * 2;",
      "[LEFT:10] -}",
    ].join("\n"),
    context: [
      {
        path: currentPath,
        basePath: historicalPath,
        base: "export const unrelatedHelper = 1;",
        head: "export const updated = true;",
        baseComplete: false,
        headComplete: false,
      },
      {
        path: contractPath,
        head: "// calculateFare must preserve the requested amount.",
        headComplete: true,
      },
    ],
  };
  let calls = 0;
  const result = await verifyAssessment({
    assessment: { findings: [candidate], limitations: [], resolutions: [] },
    chunk: { parts: [historicalPart] },
    sha,
    apiKey: "fixture",
    budget: 1,
    isCurrent: async () => true,
    fetchImpl: async (_url: string, request: any) => {
      calls++;
      const payload = JSON.parse(JSON.parse(request.body).messages[1].content);
      expect(payload.candidates[0].patch).toContain("[LEFT:9] -  return amount * 2;");
      expect(payload.evidence.some((item: any) => item.path.base === historicalPath)).toBe(true);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  decisions: [
                    {
                      index: payload.candidates[0].index,
                      verdict: "confirmed",
                      symbol: "calculateFare",
                      input: "calculateFare(5)",
                      actual: "10",
                      expected: "5",
                      trace: "La implementación histórica multiplicaba por dos el importe.",
                      counterevidence: "Se revisaron el consumidor y el contrato vigente.",
                      expectedContract: {
                        path: contractPath,
                        quote: "// calculateFare must preserve the requested amount.",
                        rule: "El importe debe conservar el valor solicitado.",
                      },
                      impactTrace: "El consumidor vigente muestra el importe al estudiante.",
                      references: [
                        {
                          path: historicalPath,
                          side: "base",
                          quote: "return amount * 2;",
                        },
                        {
                          path: contractPath,
                          quote: "// calculateFare must preserve the requested amount.",
                        },
                      ],
                    },
                  ],
                }),
              },
            },
          ],
        }),
      };
    },
  });
  expect(calls).toBe(1);
  expect(result.assessment.evidenceRequests).toEqual([]);
  expect(result.assessment.limitations).toEqual([]);
  expect(result.assessment.findings.map((finding: any) => finding.issue_key)).toEqual([
    "deleted-multiplier",
  ]);
  expect(publishable(result.assessment.findings[0], sha)).toBe(true);
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
      const payload = JSON.parse(messages[1].content);
      expect(messages[0].content).toContain("evidencia que contradiga");
      expect(payload.candidates).toHaveLength(3);
      expect(payload.evidence).toHaveLength(1);
      expect(payload.evidenceVersion).toEqual({ base: null, head: sha });
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
test("candidate verification sends only its related hunk and evidence", async () => {
  const candidate = candidates[0];
  const marker = `RIGHT:${candidate.line}`;
  const unrelatedPath = "apps/mobile/src/unrelated.ts";
  const consumerPath = "apps/mobile/src/consumer.ts";
  const result = await verifyAssessment({
    assessment: { findings: [candidate], limitations: [], resolutions: [] },
    chunk: {
      parts: [
        {
          ...part,
          context: [
            ...part.context,
            {
              path: consumerPath,
              relationship: "consumer",
              head: "export const result = expandAvailabilitySlots(input);",
              evidenceSelector: { symbols: ["expandAvailabilitySlots"] },
            },
            {
              path: unrelatedPath,
              relationship: "dependency",
              head: "export function unrelatedMarker() { return true; }",
              evidenceSelector: { symbols: ["unrelatedMarker"] },
            },
          ],
          patch: [
            `@@ -${candidate.line - 1},0 +${candidate.line} @@`,
            `[${marker}] +const key = \`unrelated-to-other-hunk\`;`,
            "@@ -80,0 +81 @@",
            "[RIGHT:81] +otherChangedBehavior();",
          ].join("\n"),
        },
        {
          path: unrelatedPath,
          anchors: ["RIGHT:4"],
          patch: "@@ -3,0 +4 @@\n[RIGHT:4] +unrelatedMarker();",
          context: [{ path: unrelatedPath, head: "const unrelatedMarker = true;" }],
        },
      ],
    },
    sha,
    apiKey: "fixture",
    budget: 1,
    isCurrent: async () => true,
    fetchImpl: async (_url: string, request: any) => {
      const messages = JSON.parse(request.body).messages;
      const payload = JSON.parse(messages[1].content);
      expect(payload.candidates).toHaveLength(1);
      expect(payload.candidates[0].patch).toContain("unrelated-to-other-hunk");
      expect(payload.candidates[0].patch).not.toContain("otherChangedBehavior");
      expect(payload.evidence.map((item: any) => item.path.head)).toEqual([consumerPath, path]);
      expect(JSON.stringify(payload)).not.toContain(unrelatedPath);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify({ decisions: [proof(0)] }) },
            },
          ],
        }),
      };
    },
  });
  expect(result.calls).toBe(1);
  expect(result.assessment.findings.map((finding: any) => finding.issue_key)).toEqual([
    "added-collision",
  ]);
});
test("candidates without shared evidence use separate verifier requests", async () => {
  const paths = ["apps/mobile/src/alpha.ts", "apps/mobile/src/beta.ts"];
  const findings = paths.map((candidatePath, index) => ({
    ...candidates[0],
    path: candidatePath,
    line: 1,
    issue_key: `independent-${index}`,
  }));
  const parts = paths.map((candidatePath, index) => ({
    path: candidatePath,
    anchors: ["RIGHT:1"],
    patch: `@@ -0,0 +1 @@\n[RIGHT:1] +export const ${index ? "beta" : "alpha"} = true;`,
    context: [
      {
        path: candidatePath,
        head: `export function ${index ? "beta" : "alpha"}() { return true; }`,
        evidenceSelector: { symbols: [index ? "beta" : "alpha"] },
      },
    ],
  }));
  let calls = 0;
  const result = await verifyAssessment({
    assessment: { findings, limitations: [], resolutions: [] },
    chunk: { parts },
    sha,
    apiKey: "fixture",
    budget: 2,
    isCurrent: async () => true,
    fetchImpl: async (_url: string, request: any) => {
      calls++;
      const payload = JSON.parse(JSON.parse(request.body).messages[1].content);
      expect(payload.candidates).toHaveLength(1);
      const candidate = payload.candidates[0].finding;
      const candidateIndex = payload.candidates[0].index;
      const index = paths.indexOf(candidate.path);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(payload.evidence.map((item: any) => item.path.head)).toEqual([candidate.path]);
      const symbol = index ? "beta" : "alpha";
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  decisions: [
                    {
                      index: candidateIndex,
                      verdict: "refuted",
                      symbol,
                      input: "Una entrada válida",
                      actual: "true",
                      expected: "true",
                      trace: "La implementación conserva el resultado esperado.",
                      counterevidence: "La declaración devuelve el valor contractual.",
                      references: [
                        {
                          path: candidate.path,
                          quote: `export function ${symbol}() { return true; }`,
                        },
                      ],
                    },
                  ],
                }),
              },
            },
          ],
        }),
      };
    },
  });
  expect(calls).toBe(2);
  expect(result.calls).toBe(2);
  expect(result.assessment.findings).toEqual([]);
  expect(result.assessment.limitations).toEqual([]);
});
test("verification groups retain more than eight recovery requests for bounded later batches", async () => {
  const paths = ["apps/mobile/src/alpha.ts", "apps/mobile/src/beta.ts"];
  const findings = paths.map((candidatePath, index) => ({
    ...candidates[0],
    path: candidatePath,
    line: 1,
    issue_key: `independent-${index}`,
  }));
  const parts = paths.map((candidatePath, index) => ({
    path: candidatePath,
    anchors: ["RIGHT:1"],
    patch: `@@ -0,0 +1 @@\n[RIGHT:1] +export const ${index ? "beta" : "alpha"} = true;`,
    context: [
      {
        path: candidatePath,
        head: `export function ${index ? "beta" : "alpha"}() { return true; }`,
        evidenceSelector: { symbols: [index ? "beta" : "alpha"] },
      },
    ],
  }));
  let groupIndex = 0;
  const result = await verifyAssessment({
    assessment: { findings, limitations: [], resolutions: [] },
    chunk: { parts },
    sha,
    apiKey: "fixture",
    budget: 2,
    isCurrent: async () => true,
    fetchImpl: async (_url: string, request: any) => {
      const payload = JSON.parse(JSON.parse(request.body).messages[1].content);
      const candidate = payload.candidates[0].finding;
      const candidateIndex = payload.candidates[0].index;
      const symbol = candidate.path.endsWith("alpha.ts") ? "alpha" : "beta";
      const evidenceRequests = Array.from({ length: 5 }, (_, index) => ({
        path: `apps/mobile/src/${symbol}-${index}.ts`,
        symbol: `Context${symbol}${index}`,
        side: "head",
        reason: `Check ${symbol} dependency ${index}.`,
      }));
      groupIndex++;
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  decisions: [
                    {
                      index: candidateIndex,
                      verdict: "refuted",
                      symbol,
                      input: "Una entrada válida",
                      actual: "true",
                      expected: "true",
                      trace: "La implementación conserva el resultado esperado.",
                      counterevidence: "La declaración devuelve el valor contractual.",
                      references: [
                        {
                          path: candidate.path,
                          quote: `export function ${symbol}() { return true; }`,
                        },
                      ],
                    },
                  ],
                  evidenceRequests,
                }),
              },
            },
          ],
        }),
      };
    },
  });
  expect(groupIndex).toBe(2);
  expect(result.assessment.findings).toEqual([]);
  expect(result.assessment.evidenceRequests).toHaveLength(10);
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
  expect(report.score).toBeNull();
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
