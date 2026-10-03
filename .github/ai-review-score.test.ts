import "./ai-review-memory.test.ts";
import "./ai-review-conversation.test.ts";
import "./ai-review-flow.test.ts";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildPlan,
  LIMITS,
  reviewPlan,
  validateAssessment,
  aggregate,
} from "./ai-review-chunks.cjs";
import { parseSummary, evaluateReview, formatReview } from "./ai-review-score.cjs";
import { classifyFile } from "./ai-review-selection.cjs";
import { formatInline, withoutBold } from "./ai-review-presentation.cjs";
import { verifyScale } from "./ai-review-scale.cjs";
const sha = "a".repeat(40);
const config = Bun.YAML.parse(readFileSync(`${import.meta.dir}/../.pr-reviewer.yml`, "utf8"));
function chunkFile(filename: string, lines = 80, width = 70) {
  return {
    filename,
    additions: lines,
    deletions: 0,
    status: "added",
    patch: `@@ -0,0 +1,${lines} @@\n${Array.from({ length: lines }, (_, i) => `+${String(i).padStart(5, "0")}${"x".repeat(width)}`).join("\n")}`,
  };
}
const finding = (overrides = {}) => ({
  path: "file.ts",
  line: 1,
  side: "RIGHT",
  severity: "important",
  issue_key: "owner-check",
  cause: "La línea añadida omite comprobar ownership.",
  impact: "Otro usuario puede leer datos ajenos.",
  fix: "Comprobar el propietario en backend.",
  ...overrides,
});
const jsonResponse = (data: unknown, extra = {}) => ({
  ok: true,
  headers: new Headers(),
  json: async () => ({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(data) } }],
  }),
  ...extra,
});
async function runChunks(plan: any, responses?: any[], fetchOverride?: any) {
  const requests: any[] = [];
  const result = await reviewPlan({
    plan,
    instructions: "CERETIME: autorización en backend.",
    apiKey: "simulation",
    sleep: async () => {},
    fetchImpl:
      fetchOverride ??
      (async (url: string, request: any) => {
        expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
        expect(request.headers.Authorization).toBe("Bearer simulation");
        expect(JSON.parse(request.body)).toMatchObject({
          model: "deepseek/deepseek-v4.1-flash",
          reasoning: { effort: "low" },
          response_format: { type: "json_object" },
        });
        requests.push(JSON.parse(request.body));
        return jsonResponse(responses?.length ? responses.shift() : { findings: [] });
      }),
  });
  return { result, requests };
}
for (const [severity, score, risk] of [
  ["minor", 4, "low"],
  ["warning", 3, "medium"],
  ["important", 2, "high"],
  ["critical", 1, "high"],
])
  test(`score derives from validated severity ${severity}`, () => {
    const plan = buildPlan([chunkFile("file.ts", 10)], {}, sha);
    const report = aggregate(
      plan,
      [validateAssessment({ findings: [finding({ severity })] }, plan.chunks[0])],
      1,
    );
    expect(report).toMatchObject({ score, risk, coverage: "complete" });
    expect(parseSummary(report.summary)).toMatchObject({ score, risk, sha, findings: 1 });
  });
for (const data of [
  { score: 2, risk: "high", findings: [] },
  { findings: [finding({ cause: "" })] },
  { findings: [finding({ line: 100 })] },
  { findings: [finding({ severity: "suggestion" })] },
  { findings: [finding({ path: "other.ts" })] },
])
  test(`rejects invalid or ungrounded assessment ${JSON.stringify(data)}`, () => {
    expect(() =>
      validateAssessment(data, buildPlan([chunkFile("file.ts", 10)], {}, sha).chunks[0]),
    ).toThrow();
  });
test("no eligible changes require no key or inference and remain explicit", async () => {
  const plan = buildPlan(
    [{ filename: "image.png" }, { filename: "bun.lock" }, chunkFile("docs/notes.md", 1)],
    config,
    sha,
  );
  const report = await reviewPlan({
    plan,
    instructions: "CERETIME",
    fetchImpl: async () => {
      throw new Error("Unexpected inference");
    },
  });
  expect(report).toMatchObject({ calls: 0, score: 5, risk: "low", coverage: "complete", total: 0 });
  expect(report.skipped).toHaveLength(3);
  expect(report.summary).toContain("Sin cambios que requieran análisis con IA");
});
test("binary files never prevent reviewing eligible code", async () => {
  const plan = buildPlan(
    [chunkFile("file.ts", 5), { filename: "apps/mobile/assets/new.png" }],
    config,
    sha,
  );
  expect(plan.files).toBe(1);
  expect((await runChunks(plan)).result.coverage).toBe("complete");
});
test("configuration selection compares functional meaning conservatively", () => {
  const check = (filename: string, before: string, after: string) =>
    classifyFile({ filename, status: "modified", before, after }, config);
  expect(
    check(
      "package.json",
      '{"scripts":{"test":"bun test"},"description":"old"}',
      '{"description":"new","scripts":{"test":"bun test"}}',
    ).eligible,
  ).toBe(false);
  for (const key of [
    "name",
    "version",
    "scripts",
    "dependencies",
    "exports",
    "engines",
    "workspaces",
  ])
    expect(
      check("package.json", JSON.stringify({ [key]: "old" }), JSON.stringify({ [key]: "new" }))
        .eligible,
    ).toBe(true);
  expect(
    check(
      ".github/workflows/ci.yml",
      "permissions:\n  contents: read\n",
      "permissions:\n  contents: write\n",
    ),
  ).toMatchObject({ eligible: true, kind: "workflow" });
  expect(
    check("config.json", '{"flag":true,"port":80}', '{ "port": 80, "flag": true }').eligible,
  ).toBe(false);
  expect(check("config.json", '{"flag":true}', '{"flag":false}').eligible).toBe(true);
  expect(check("config.json", '{"flag":true}', "invalid").eligible).toBe(true);
  expect(classifyFile(chunkFile("CONTEXT.md", 1), config).eligible).toBe(true);
  expect(classifyFile(chunkFile("docs/adr/decision.md", 1), config).eligible).toBe(true);
});
test("spacing filters preserve syntax and whitespace-sensitive languages", () => {
  const eligible = (filename: string, before: string, after: string) =>
    classifyFile({ filename, status: "modified", before, after }, config).eligible;
  expect(eligible("file.ts", "const x = 1;\n", "  const x = 1;\n")).toBe(false);
  for (const [filename, before, after] of [
    ["auth.ts", "return allowed;", "returnallowed;"],
    ["auth.ts", "return\nallowed;", "return allowed;"],
    ["auth.ts", "const regex = /a b/;", "const regex = /ab/;"],
    ["auth.ts", 'const text = "a b";', 'const text = "ab";'],
    ["auth.py", "if ok:\n  audit()", "if ok:\naudit()"],
    ["page.tsx", "<p>Hello world</p>", "<p>Helloworld</p>"],
    ["style.css", ".a .b {}", ".a.b {}"],
    ["page.html", "Hello world", "Helloworld"],
  ])
    expect(eligible(filename, before, after)).toBe(true);
});
for (const size of [10, 500, 1400])
  test(`all changed lines covered across packed blocks: ${size}`, async () => {
    const plan = buildPlan([chunkFile("file.ts", size)], {}, sha);
    const anchors = plan.chunks.flatMap((c: any) => c.parts.flatMap((p: any) => p.anchors));
    expect(anchors).toHaveLength(size);
    expect(new Set(anchors).size).toBe(size);
    for (const chunk of plan.chunks)
      expect(
        JSON.stringify(
          chunk.parts.map(({ anchors: _anchors, contextKey: _key, ...part }: any) => part),
        ).length,
      ).toBeLessThanOrEqual(LIMITS.chunkChars);
    const { result, requests } = await runChunks(plan);
    expect(result.coverage).toBe("complete");
    expect(requests).toHaveLength(plan.chunks.length);
    expect(requests[0].messages[0].content).toContain("main es la base válida");
    expect(requests[0]).toHaveProperty("max_tokens", LIMITS.outputTokens);
  });
test("large reviews fit the OpenRouter profile without dropping changed lines", async () => {
  const plan = buildPlan(
    Array.from({ length: 33 }, (_, i) => chunkFile(`large-${i}.ts`, 80, 95)),
    config,
    sha,
  );
  expect(plan.issues).toEqual([]);
  expect(plan.chunks.length).toBeLessThanOrEqual(plan.limits.maxChunks);
  const parts = plan.chunks.flatMap((chunk: any) => chunk.parts);
  for (let i = 0; i < 33; i++) {
    const anchors = parts
      .filter((part: any) => part.path === `large-${i}.ts`)
      .flatMap((part: any) => part.anchors);
    expect(anchors).toHaveLength(80);
    expect(new Set(anchors).size).toBe(80);
  }
  const { result } = await runChunks(plan);
  expect(result.coverage).toBe("complete");
  expect(result.processed).toBe(plan.chunks.length);
});
test("each inference identifies its scope within the complete review plan", async () => {
  const plan = buildPlan([chunkFile("file.ts", 1400)], {}, sha);
  const { requests } = await runChunks(plan);
  expect(requests.length).toBeGreaterThan(1);
  for (const [index, request] of requests.entries()) {
    expect(JSON.parse(request.messages[1].content).scope).toEqual({
      block: index + 1,
      totalBlocks: plan.chunks.length,
      paths: [...new Set(plan.chunks[index].parts.map((part: any) => part.path))],
    });
    expect(request.messages[0].content).toContain("Los demás bloques se revisan por separado");
    expect(request.messages[0].content).toContain("contrato necesario para evaluar estas partes");
  }
});
test("small files share calls while hunks keep independent units", async () => {
  const file = {
    filename: "multi.ts",
    additions: 2,
    deletions: 0,
    patch: "@@ -0,0 +1 @@\n+first();\n@@ -20,0 +22 @@\n+second();",
  };
  const plan = buildPlan([file, chunkFile("file.ts", 1)], {}, sha);
  expect(plan.chunks).toHaveLength(1);
  expect(plan.chunks[0].parts).toHaveLength(3);
  expect((await runChunks(plan)).result.calls).toBe(1);
});
test("missing, truncated or invalid patches cannot certify coverage", async () => {
  for (const file of [
    { filename: "missing.ts", additions: 1, deletions: 0 },
    { ...chunkFile("file.ts", 10), patch: "@@ -0,0 +1,10 @@\n+only one line" },
  ]) {
    const { result, requests } = await runChunks(buildPlan([file], {}, sha));
    expect(result).toMatchObject({ score: 0, coverage: "incomplete" });
    expect(requests).toHaveLength(0);
  }
  const plan = buildPlan([chunkFile("file.ts", 1)], {}, sha);
  expect(
    (
      await runChunks(plan, undefined, async () =>
        jsonResponse(
          { findings: [] },
          {
            json: async () => ({
              choices: [{ finish_reason: "length", message: { content: '{"findings":[]}' } }],
            }),
          },
        ),
      )
    ).result.coverage,
  ).toBe("incomplete");
});
test("invalid responses retry once and technical uncertainty is not a finding", async () => {
  const plan = buildPlan([chunkFile("file.ts", 1)], {}, sha);
  expect((await runChunks(plan, [null, { findings: [] }])).result).toMatchObject({
    coverage: "complete",
    calls: 2,
    score: 5,
  });
  const uncertain = await runChunks(plan, [
    { findings: [], limitations: ["Falta el contrato externo para comprobar el cambio."] },
  ]);
  expect(uncertain.result).toMatchObject({ coverage: "incomplete", calls: 1, score: 0 });
  expect(uncertain.result.findings).toHaveLength(0);
});
test("aggregate caps findings and rejects contradictory thread decisions", () => {
  const plan = buildPlan([chunkFile("file.ts", 10)], {}, sha);
  const findings = Array.from({ length: 8 }, (_, i) =>
    finding({ line: i + 1, issue_key: `problem-${i}`, severity: i === 7 ? "critical" : "warning" }),
  );
  const report = aggregate(plan, [{ findings, resolutions: [] }], 1);
  expect(report.findings).toHaveLength(5);
  expect(report).toMatchObject({ score: 1, risk: "high", totalFindings: 8 });
  const conflict = aggregate(
    { ...plan, chunks: [{}, {}] },
    [
      { findings: [finding({ threadId: "1" })], resolutions: [{ id: "1", status: "maintain" }] },
      { findings: [], resolutions: [{ id: "1", status: "resolved" }] },
    ],
    2,
  );
  expect(conflict).toMatchObject({ score: 0, coverage: "incomplete" });
});
test("budgets and obsolete heads stop inference without inventing coverage", async () => {
  const plan = buildPlan([chunkFile("file.ts", 400)], { chunking: { maxCalls: 1 } }, sha);
  expect((await runChunks(plan)).result).toMatchObject({
    coverage: "incomplete",
    score: 0,
    calls: 1,
  });
  expect(
    (await runChunks(buildPlan([chunkFile("file.ts", 400)], { chunking: { maxChunks: 1 } }, sha)))
      .result.calls,
  ).toBe(0);
  const stale = await reviewPlan({
    plan,
    instructions: "CERETIME",
    apiKey: "simulation",
    isCurrent: async () => false,
    fetchImpl: async () => {
      throw new Error("Unexpected inference");
    },
  });
  expect(stale).toMatchObject({ calls: 0, score: 0, coverage: "incomplete" });
});
test("publication contract rejects stale missing inconsistent and failed summaries", () => {
  const report = aggregate(buildPlan([], {}, sha), [], 0);
  const input = {
    outcome: "success",
    summary: report.summary,
    risk: report.risk,
    commentsCount: "0",
    expectedSha: sha,
    currentSha: sha,
    coverage: "complete",
  };
  expect(evaluateReview(input).state).toBe("success");
  for (const extra of [
    { currentSha: "b".repeat(40) },
    { summary: "" },
    { outcome: "failure" },
    { coverage: "incomplete" },
    { commentsCount: "1" },
    { risk: "high" },
    { summary: report.summary.replace("5/5", "6/5") },
  ])
    expect(evaluateReview({ ...input, ...extra }).state).toBe("failure");
  const body = formatReview(
    evaluateReview(input),
    sha,
    "https://github.com/test/repo/actions/runs/1",
    "",
    { report, commitTitle: "ci: [review]\nignored" },
  );
  expect(body).toContain("Sin cambios que requieran análisis con IA");
  expect(body).not.toContain("ignored");
  expect(verifyScale()).toContain("5/5");
});
test("presentation preserves literal code and suggestions", () => {
  const input = "**Prosa**\n```suggestion\nconst value = '**literal**';\n```";
  expect(withoutBold(input)).toContain("const value = '**literal**'");
  expect(withoutBold(input)).toStartWith("Prosa");
  expect(formatInline("plain text")).toBe("plain text");
});
test("workflow has one engine pinned actions and no second inference for the score", () => {
  const text = readFileSync(`${import.meta.dir}/workflows/ai-code-review.yml`, "utf8");
  const workflow = Bun.YAML.parse(text);
  expect(workflow.on.pull_request.branches).toEqual(["main"]);
  expect(workflow.on.pull_request.types).toContain("synchronize");
  expect(workflow.permissions).toEqual({
    contents: "read",
    "pull-requests": "write",
    statuses: "write",
  });
  expect(workflow.concurrency["cancel-in-progress"]).toBe(true);
  expect(workflow.on).not.toHaveProperty("workflow_dispatch");
  expect(Object.keys(workflow.jobs)).toEqual(["review"]);
  const inference = workflow.jobs.review.steps.find((step: any) => step.id === "confidence");
  expect(inference.env.OPENROUTER_API_KEY).toBe("${{ secrets.OPENROUTER_API_KEY }}");
  expect(inference.env).not.toHaveProperty("GROQ_API_KEY");
  expect(text).not.toContain("mara-werils");
  expect(text).not.toContain("steps.ai_review");
  for (const step of workflow.jobs.review.steps)
    if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
  const ci = Bun.YAML.parse(readFileSync(`${import.meta.dir}/workflows/ci.yml`, "utf8"));
  expect(ci.jobs["lint-and-format"].steps.at(-1).run).toBe(
    "bun test ./.github/ai-review-score.test.ts",
  );
  for (const job of ["mobile", "web", "backend"]) expect(ci.jobs[job]).toBeDefined();
});

test("paces chunks and recovers repeated 429 without skipping required coverage", async () => {
  const plan = buildPlan([chunkFile("rate.ts", 10)], {}, sha);
  let calls = 0;
  const pauses: number[] = [];
  const result = await reviewPlan({
    plan,
    instructions: "CERETIME",
    apiKey: "test",
    sleep: async (ms: number) => {
      pauses.push(ms);
    },
    fetchImpl: async () => {
      calls++;
      if (calls <= 2)
        return {
          ok: false,
          status: 429,
          headers: new Headers({ "retry-after": "90", "x-ratelimit-reset-tokens": "1m40s" }),
        };
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  findings: [],
                }),
              },
            },
          ],
        }),
      };
    },
  });
  expect(result.coverage).toBe("complete");
  expect(result.processed).toBe(plan.chunks.length);
  expect(calls).toBe(3);
  expect(pauses[0]).toBeGreaterThanOrEqual(91000);
  expect(pauses[1]).toBeGreaterThanOrEqual(91000);
  expect(LIMITS.intervalMs).toBe(1000);
});

test("persistent 429 reports quota failure and respects the maximum call count", async () => {
  const plan = buildPlan([chunkFile("quota.ts", 10)], {}, sha);
  const result = await reviewPlan({
    plan,
    instructions: "CERETIME",
    apiKey: "test",
    sleep: async () => {},
    fetchImpl: async () => ({ ok: false, status: 429, headers: new Headers() }),
  });
  expect(result.calls).toBe(3);
  expect(result.coverage).toBe("incomplete");
  expect(result.score).toBe(0);
  expect(result.reasons.join(" ")).toContain("HTTP 429");
});

test("daily quota cannot cause an early retry before the requested reset", async () => {
  const plan = buildPlan([chunkFile("daily.ts", 10)], {}, sha);
  const pauses: number[] = [];
  const result = await reviewPlan({
    plan,
    instructions: "CERETIME",
    apiKey: "test",
    sleep: async (ms: number) => {
      pauses.push(ms);
    },
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      headers: new Headers({
        "retry-after": "7200",
        "x-ratelimit-remaining-requests": "0",
        "x-ratelimit-reset-requests": "2h",
      }),
    }),
  });
  expect(result.calls).toBe(1);
  expect(pauses).toHaveLength(0);
  expect(result.reasons.join(" ")).toContain("supera el presupuesto permitido");
});

test("all chunks remain eligible while respecting the configured interval", async () => {
  const plan = buildPlan(
    Array.from({ length: 25 }, (_, i) => chunkFile(`paced-${i}.ts`, 100)),
    {},
    sha,
  );
  let elapsed = 0,
    lastRequest = -LIMITS.intervalMs;
  const result = await reviewPlan({
    plan,
    instructions: "CERETIME",
    apiKey: "test",
    sleep: async (ms: number) => {
      elapsed += ms;
    },
    fetchImpl: async () => {
      expect(elapsed - lastRequest).toBeGreaterThanOrEqual(LIMITS.intervalMs);
      lastRequest = elapsed;
      return {
        ok: true,
        headers: new Headers(),
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  findings: [],
                }),
              },
            },
          ],
        }),
      };
    },
  });
  expect(result.coverage).toBe("complete");
  expect(result.processed).toBe(plan.chunks.length);
  expect(result.score).toBe(5);
});

test("quota wait budget stops bounded retries and the current head is checked after waiting", async () => {
  const plan = buildPlan(
    [chunkFile("budget.ts", 10)],
    { chunking: { maxRateLimitWaitMs: 1000 } },
    sha,
  );
  const limited = await reviewPlan({
    plan,
    instructions: "CERETIME",
    apiKey: "test",
    sleep: async () => {},
    fetchImpl: async () => ({ ok: false, status: 429, headers: new Headers() }),
  });
  expect(limited.calls).toBe(1);
  expect(limited.coverage).toBe("incomplete");
  const currentPlan = buildPlan([chunkFile("changed.ts", 10)], {}, sha);
  let current = true,
    calls = 0;
  const changed = await reviewPlan({
    plan: currentPlan,
    instructions: "CERETIME",
    apiKey: "test",
    isCurrent: async () => current,
    sleep: async () => {
      current = false;
    },
    fetchImpl: async () => {
      calls++;
      return { ok: false, status: 429, headers: new Headers() };
    },
  });
  expect(calls).toBe(1);
  expect(changed.coverage).toBe("incomplete");
  expect(changed.reasons).toContain("El head cambió durante la revisión.");
});

test("successful low-token headers delay the next chunk until reset", async () => {
  const plan = buildPlan([chunkFile("tokens-a.ts", 200), chunkFile("tokens-b.ts", 200)], {}, sha);
  const pauses: number[] = [];
  const result = await reviewPlan({
    plan,
    instructions: "CERETIME",
    apiKey: "test",
    sleep: async (ms: number) => {
      pauses.push(ms);
    },
    fetchImpl: async () => ({
      ok: true,
      headers: new Headers({
        "x-ratelimit-remaining-tokens": "100",
        "x-ratelimit-reset-tokens": "1m15s",
      }),
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                findings: [],
              }),
            },
          },
        ],
      }),
    }),
  });
  expect(result.coverage).toBe("complete");
  expect(pauses[0]).toBe(76000);
});

test("429 retry-after identifies the affected limit instead of unrelated reset windows", async () => {
  const plan = buildPlan([chunkFile("quota-reset.ts", 10)], {}, sha);
  const pauses: number[] = [];
  let calls = 0;
  const result = await reviewPlan({
    plan,
    instructions: "CERETIME",
    apiKey: "test",
    sleep: async (ms: number) => {
      pauses.push(ms);
    },
    fetchImpl: async () => {
      calls++;
      if (calls === 1)
        return {
          ok: false,
          status: 429,
          headers: new Headers({
            "retry-after": "10",
            "x-ratelimit-reset-tokens": "20m",
            "x-ratelimit-reset-requests": "12h",
          }),
          json: async () => ({
            error: {
              message:
                "Rate limit on tokens per minute (TPM): Limit 8000, Used 7000, Requested 3000. Please try again in 10s. Organization private-id",
              code: "rate_limit_exceeded",
            },
          }),
        };
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  findings: [],
                }),
              },
            },
          ],
        }),
      };
    },
  });
  expect(result.coverage).toBe("complete");
  expect(pauses).toEqual([11000]);
});

test("daily token exhaustion reports safe numeric evidence without provider identifiers", async () => {
  const plan = buildPlan([chunkFile("daily-evidence.ts", 10)], {}, sha);
  const logs: string[] = [];
  const result = await reviewPlan({
    plan,
    instructions: "CERETIME",
    apiKey: "test",
    sleep: async () => {},
    onProgress: (message: string) => {
      logs.push(message);
    },
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      headers: new Headers({ "retry-after": "900" }),
      json: async () => ({
        error: {
          message:
            "Rate limit for organization PRIVATE_ORG on tokens per day (TPD): Limit 200000, Used 199000, Requested 3000. Please try again in 15m. KEY_PRIVATE_SOURCE",
        },
      }),
    }),
  });
  expect(result.calls).toBe(1);
  expect(result.reasons.join(" ")).toContain("tokens por día");
  expect(result.reasons.join(" ")).toContain("límite: 200000");
  expect(result.reasons.join(" ")).toContain("901 segundos");
  expect(JSON.stringify({ result, logs })).not.toContain("PRIVATE_ORG");
  expect(JSON.stringify({ result, logs })).not.toContain("KEY_PRIVATE_SOURCE");
});

test("a request exceeding the minute allowance reports that waits cannot fix its size", async () => {
  const plan = buildPlan([chunkFile("oversized-tokens.ts", 10)], {}, sha);
  const result = await reviewPlan({
    plan,
    instructions: "CERETIME",
    apiKey: "test",
    sleep: async () => {},
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      headers: new Headers(),
      json: async () => ({
        error: {
          message: "Rate limit on tokens per minute (TPM): Limit 8000, Used 0, Requested 9000.",
        },
      }),
    }),
  });
  expect(result.calls).toBe(1);
  expect(result.reasons.join(" ")).toContain("esperar no lo resuelve");
  expect(result.coverage).toBe("incomplete");
});
