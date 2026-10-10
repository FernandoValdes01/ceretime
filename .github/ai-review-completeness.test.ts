import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { clipContext, enrichFiles, gitReader, relevantDeclarations } from "./ai-review-context.cjs";
import { evidenceRequests, recoverEvidence } from "./ai-review-evidence.cjs";
import { publicEvidenceBundle } from "./ai-review-payload.cjs";
import { aggregate, buildPlan, reviewPlan, validateAssessment } from "./ai-review-chunks.cjs";
import { completionRequest, tokenBudget } from "./ai-review-provider.cjs";
import { fixtureVerifier } from "./ai-review-test-verifier.cjs";

const sha = "a".repeat(40);
function repository(files: Record<string, string>, run: (directory: string, ref: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "review-context-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      writeFileSync(join(directory, path), text);
    }
    git("add", ".");
    git("commit", "-qm", "fixture");
    run(directory, git("rev-parse", "HEAD"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
function plan() {
  return buildPlan(
    [
      {
        filename: "file.ts",
        status: "added",
        additions: 1,
        deletions: 0,
        patch: "@@ -0,0 +1 @@\n+export const value = 1;",
      },
    ],
    {},
    sha,
  );
}
const finding = (line: number) => ({
  path: "file.ts",
  line,
  side: "RIGHT",
  severity: "important",
  issue_key: "value-contract",
  cause: "El cambio elimina una comprobación.",
  impact: "Se acepta una entrada inválida.",
  fix: "Validar la entrada.",
});
const response = (data: unknown, prompt = 10, completion = 2) => ({
  ok: true,
  headers: new Headers(),
  json: async () => ({
    usage: { prompt_tokens: prompt, completion_tokens: completion },
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(data) } }],
  }),
});

test("evidence accepts literal Expo and Unicode paths while rejecting traversal", () => {
  const path = "apps/mobile/app/(staff)/[id]/atención.tsx";
  expect(
    evidenceRequests([{ path, symbol: "value", reason: "Comprobar el contrato." }])[0].path,
  ).toBe(path);
  for (const unsafe of [
    "../file.ts",
    "a/../file.ts",
    "/file.ts",
    "C:/file.ts",
    "a\\file.ts",
    "a//file.ts",
    "a\nfile.ts",
  ])
    expect(() =>
      evidenceRequests([{ path: unsafe, scope: "file", reason: "Comprobar." }]),
    ).toThrow();
  repository(
    {
      [path]: "export const value = 1;\n",
      "apps/mobile/app/(staff)/i/atención.tsx": "export const value = 2;\n",
    },
    (directory, ref) => {
      expect(gitReader(directory).readState(ref, path)).toMatchObject({
        status: "present",
        text: "export const value = 1;\n",
      });
      const chunk = { parts: [{ path, context: [] }] };
      const recovered = recoverEvidence({
        directory,
        base: ref,
        sha: ref,
        chunk,
        requests: [{ path, symbol: "value", reason: "Comprobar el contrato." }],
      });
      expect(recovered.unresolved).toEqual([]);
      expect(recovered.chunk.parts[0].context[0].head).toContain("value = 1");
    },
  );
});

test("CSS evidence and consumers are available without importing the stylesheet", () => {
  const path = "theme.css",
    text = ":root { --brand: red; }\n";
  repository(
    { [path]: text, "card.tsx": "export const card = 'var(--brand)';\n" },
    (directory, ref) => {
      const files: any[] = [
        {
          filename: path,
          status: "modified",
          additions: 1,
          deletions: 1,
          patch: "@@ -1 +1 @@\n-:root { --brand: blue; }\n+:root { --brand: red; }",
        },
      ];
      enrichFiles(files, { directory, base: ref, sha: ref });
      expect(files[0].context.some((item: any) => item.path === "card.tsx")).toBe(true);
      expect(
        buildPlan(files, {}, ref)
          .chunks.flatMap((chunk: any) => chunk.parts)
          .flatMap((part: any) => part.context)
          .find((item: any) => item.path === "card.tsx").head,
      ).toContain("var(--brand)");
      const recovered = recoverEvidence({
        directory,
        base: ref,
        sha: ref,
        chunk: { parts: [{ path, context: [] }] },
        requests: [{ path, fragment: "--brand", reason: "Comprobar consumidores." }],
      });
      expect(recovered.unresolved).toEqual([]);
      expect(recovered.chunk.parts[0].context[0]).toMatchObject({
        head: text,
        declarationComplete: true,
      });
    },
  );
});

test("context budgets retain whole declarations instead of function prefixes", () => {
  const small = "export function small() { return 1; }";
  const large = `export function large() { return '${"x".repeat(1000)}'; }`;
  const selected = relevantDeclarations(
    `${large}\n${small}`,
    undefined,
    "head",
    100,
    ["large", "small"],
    "definitions",
  );
  expect(selected).toContain(small);
  expect(selected).not.toContain("function large");
  const clipped = JSON.parse(
    clipContext(
      [{ path: "file.ts", base: "", head: `${small}\n${large}`, headComplete: true }],
      300,
    ),
  );
  expect(clipped[0].head).toBe(small);
  expect(clipped[0].headComplete).toBe(false);
});

test("identical base and head evidence is sent once with explicit version semantics", () => {
  const text = "export const value = 1;";
  const context = [
    { path: "contract.ts", head: text, base: text, headComplete: true, baseComplete: true },
  ];
  const bundle = publicEvidenceBundle([{ path: "file.ts", context }]);
  expect(bundle.evidence[0]).toMatchObject({
    base: "",
    head: text,
    baseSameAsHead: true,
    baseComplete: true,
    headComplete: true,
  });
  expect(context[0].base).toBe(text);
});

test("one invalid coordinate preserves valid candidates without another analysis request", async () => {
  const current = plan();
  const assessment = validateAssessment(
    { findings: [finding(1), finding(99)] },
    current.chunks[0],
    { isolateInvalidFindings: true },
  );
  expect(assessment.findings).toHaveLength(1);
  expect(assessment.limitations).toHaveLength(1);
  let calls = 0;
  const report = await reviewPlan({
    plan: current,
    apiKey: "fixture",
    instructions: "",
    sleep: async () => {},
    verify: fixtureVerifier,
    fetchImpl: async () => {
      calls++;
      return response({
        summary: "Se modifica el contrato de entrada.",
        findings: [finding(1), finding(99)],
      });
    },
  });
  expect(calls).toBe(1);
  expect(report).toMatchObject({
    coverage: "incomplete",
    score: null,
    totalFindings: 1,
    changeSummaries: ["Se modifica el contrato de entrada."],
    files: [{ path: "file.ts", coverage: "incomplete" }],
  });
  expect(
    aggregate(current, [{ findings: [], resolutions: [{ id: "42", status: "needs_context" }] }], 1)
      .files,
  ).toEqual([{ path: "file.ts", coverage: "incomplete" }]);
});

test("token reservation settles once and unknown usage keeps the conservative reservation", () => {
  const body = JSON.stringify(completionRequest([{ role: "user", content: "Read." }], 10));
  const budget = tokenBudget(2000);
  const settle = budget.reserve(body);
  expect(budget.spent).toBeGreaterThan(500);
  settle({ usage: { prompt_tokens: 20, completion_tokens: 3 } });
  settle({ usage: { prompt_tokens: 20, completion_tokens: 3 } });
  expect(budget.spent).toBe(23);
  budget.reserve(body)({});
  expect(budget.spent).toBeGreaterThan(523);
  expect(() => tokenBudget(1).reserve(body)).toThrow("Presupuesto total de tokens agotado.");
});

test("the total token budget blocks provider requests and counts independent verification usage", async () => {
  const blocked = plan();
  blocked.limits.totalTokens = 1;
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return response({ findings: [finding(1)] });
  };
  const report = await reviewPlan({
    plan: blocked,
    apiKey: "fixture",
    instructions: "",
    sleep: async () => {},
    fetchImpl,
  });
  expect(calls).toBe(0);
  expect(report.coverage).toBe("incomplete");
  expect(report.reasons).toContain("Presupuesto total de tokens agotado.");
  const verified = await reviewPlan({
    plan: plan(),
    apiKey: "fixture",
    instructions: "",
    sleep: async () => {},
    fetchImpl,
    verify: async ({ assessment, fetchImpl: fetchProvider }: any) => {
      await (
        await fetchProvider("fixture", {
          body: JSON.stringify(completionRequest([{ role: "user", content: "Verify." }], 10)),
        })
      ).json();
      return {
        assessment: { ...assessment, findings: [], limitations: ["Falta confirmar el contrato."] },
      };
    },
  });
  expect(calls).toBe(2);
  expect(verified).toMatchObject({
    calls: 2,
    usage: { prompt: 20, completion: 4, measuredCalls: 2 },
    tokenBudget: { charged: 24 },
  });
});

test("every initial block is analyzed before recovery and deferred analysis is reused", async () => {
  const current = plan();
  const first = current.chunks[0].parts[0];
  current.files = 3;
  current.chunks = [
    { parts: [first] },
    { parts: [{ ...first, path: "other.ts" }] },
    { parts: [{ ...first, path: "last.ts" }] },
  ];
  const order: string[] = [];
  const request = { path: "helper.ts", symbol: "helper", reason: "Comprobar el contrato." };
  const report = await reviewPlan({
    plan: current,
    apiKey: "fixture",
    instructions: "",
    sleep: async () => {},
    fetchImpl: async (_url: any, envelope: any) => {
      const payload = JSON.parse(JSON.parse(envelope.body).messages[1].content);
      const path = payload.parts[0].path;
      order.push(`analyze:${path}`);
      const available = payload.evidence.some(
        (item: any) =>
          item.path.head === "helper.ts" && item.head.includes("export function helper"),
      );
      return response({
        findings: [],
        evidenceRequests: path !== "last.ts" && !available ? [request] : [],
      });
    },
    recoverContext: ({ chunk, requests }: any) => {
      order.push("recover:helper.ts");
      return {
        chunk: {
          parts: chunk.parts.map((part: any) => ({
            ...part,
            evidenceRecovery: requests.map((item: any) => ({ ...item, availability: "present" })),
            context: [
              ...(part.context ?? []),
              {
                path: "helper.ts",
                head: "export function helper() {}",
                base: "",
                recovered: true,
                evidenceSide: "head",
                evidenceSelector: { symbol: "helper" },
                offset: 0,
                declarationComplete: true,
              },
            ],
          })),
        },
        unresolved: [],
      };
    },
  });
  expect(order).toEqual([
    "analyze:file.ts",
    "analyze:other.ts",
    "analyze:last.ts",
    "recover:helper.ts",
    "analyze:file.ts",
    "analyze:other.ts",
  ]);
  expect(report).toMatchObject({
    coverage: "complete",
    calls: 5,
    analyzedFiles: ["file.ts", "last.ts", "other.ts"],
  });
});

test("the server controls continuation cursors and unknown resolutions cannot approve a block", () => {
  const current = plan();
  const request = {
    path: "file.ts",
    symbol: "value",
    side: "head",
    forPath: "file.ts",
    reason: "Comprobar el contrato.",
  };
  current.chunks[0].parts[0].evidenceRecovery = [
    { ...request, cursor: 8, availability: "partial" },
  ];
  const assessed = validateAssessment(
    {
      findings: [],
      evidenceRequests: [{ ...request, forPath: undefined, cursor: 999 }],
      evidenceResolutions: [
        {
          path: "unknown.ts",
          symbol: "unknown",
          side: "head",
          reason: "No se necesita.",
          status: "not_needed",
        },
      ],
    },
    current.chunks[0],
    { repairEvidenceProtocol: true },
  );
  expect(assessed.evidenceRequests[0]).toMatchObject({ cursor: 8, forPath: "file.ts" });
  expect(assessed.evidenceResolutions).toEqual([]);
  expect(aggregate(current, [assessed], 1)).toMatchObject({ coverage: "incomplete", score: null });
});

test("partitions share the original recovery allowance instead of resetting it", async () => {
  const current = plan();
  const part = current.chunks[0].parts[0];
  part.patch = Array.from(
    { length: 500 },
    (_, i) => `[RIGHT:${i + 1}] +const value${i} = '${"x".repeat(45)}';`,
  ).join("\n");
  part.anchors = Array.from({ length: 500 }, (_, i) => `RIGHT:${i + 1}`);
  const request = {
    path: "helper.ts",
    symbol: "largeHelper",
    reason: "Comprobar todas las ramas.",
  };
  let recoveries = 0;
  const report = await reviewPlan({
    plan: current,
    apiKey: "fixture",
    instructions: "",
    sleep: async () => {},
    fetchImpl: async () => response({ findings: [], evidenceRequests: [request] }),
    recoverContext: ({ chunk, requests }: any) => {
      recoveries++;
      return {
        chunk: {
          parts: chunk.parts.map((item: any) => ({
            ...item,
            context: [
              ...(item.context ?? []),
              {
                path: "helper.ts",
                head: "x".repeat(8000),
                base: "",
                recovered: true,
                evidenceSide: "head",
                evidenceSelector: { symbol: "largeHelper" },
                offset: (recoveries - 1) * 8000,
                declarationComplete: false,
              },
            ],
            evidenceRecovery: requests.map((requested: any) => ({
              ...requested,
              availability: "partial",
              cursor: recoveries * 8000,
            })),
          })),
        },
        unresolved: requests.map((requested: any) => ({
          ...requested,
          availability: "partial",
          cursor: recoveries * 8000,
        })),
      };
    },
  });
  expect(current.chunks.length).toBeGreaterThan(1);
  expect(recoveries).toBe(3);
  expect(report).toMatchObject({ coverage: "incomplete", score: null });
  expect(report.processed).toBe(report.total);
});

test("unreadable patch preserves review of valid files and verified findings", async () => {
  const current = buildPlan(
    [
      { filename: "broken.ts", status: "modified", additions: 1, deletions: 0 },
      {
        filename: "file.ts",
        status: "added",
        additions: 1,
        deletions: 0,
        patch: "@@ -0,0 +1 @@\n+export const value = 1;",
      },
    ],
    {},
    sha,
  );
  const report = await reviewPlan({
    plan: current,
    apiKey: "fixture",
    sleep: async () => {},
    verify: fixtureVerifier,
    fetchImpl: async () => response({ findings: [finding(1)] }),
  });
  expect(report.calls).toBe(1);
  expect(report.findings).toHaveLength(1);
  expect(report).toMatchObject({ coverage: "incomplete", score: null });
  expect(report.planningIssues).toContain("Patch no disponible: broken.ts");
});

test("verified defect is retained without recovering unrelated missing coverage", async () => {
  let recoveries = 0;
  const report = await reviewPlan({
    plan: plan(),
    apiKey: "fixture",
    sleep: async () => {},
    verify: fixtureVerifier,
    fetchImpl: async () =>
      response({
        findings: [finding(1)],
        evidenceRequests: [{ path: "other.ts", symbol: "helper", reason: "Comprobar otro flujo." }],
      }),
    recoverContext: async () => {
      recoveries++;
      throw new Error("Unexpected recovery");
    },
  });
  expect(recoveries).toBe(0);
  expect(report.calls).toBe(1);
  expect(report.findings).toHaveLength(1);
  expect(report.missingEvidence).toHaveLength(1);
  expect(report).toMatchObject({ coverage: "incomplete", score: null });
});

test("deferred candidates are verified before unrelated coverage recovery", async () => {
  const current = plan();
  const last = plan().chunks[0].parts[0];
  current.chunks.push({ parts: [{ ...last, path: "last.ts" }] });
  current.files = 2;
  const events: string[] = [];
  const report = await reviewPlan({
    plan: current,
    apiKey: "fixture",
    sleep: async () => {},
    verify: async (args: any) => {
      events.push(`verify:${args.chunk.parts[0].path}`);
      return fixtureVerifier(args);
    },
    fetchImpl: async (_url: any, options: any) => {
      const path = JSON.parse(JSON.parse(options.body).messages[1].content).parts[0].path;
      events.push(`analyze:${path}`);
      return response(
        path === "file.ts"
          ? {
              findings: [finding(1)],
              evidenceRequests: [
                { path: "other.ts", symbol: "helper", reason: "Comprobar otro flujo." },
              ],
            }
          : { findings: [] },
      );
    },
    recoverContext: async () => {
      throw new Error("Unrelated coverage must not precede verification");
    },
  });
  expect(events.indexOf("analyze:last.ts")).toBeLessThan(events.indexOf("verify:file.ts"));
  expect(report.findings).toHaveLength(1);
  expect(report.missingEvidence).toHaveLength(1);
  expect(report).toMatchObject({ calls: 2, coverage: "incomplete", score: null });
});

test("server continuation survives adding a changed-file association", () => {
  const current = plan().chunks[0];
  current.parts[0].evidenceRecovery = [
    {
      path: "helper.ts",
      symbol: "helper",
      side: "head",
      reason: "Comprobar el contrato.",
      cursor: 8,
      availability: "partial",
    },
  ];
  const result = validateAssessment(
    {
      findings: [],
      evidenceRequests: [
        {
          path: "helper.ts",
          symbol: "helper",
          reason: "Comprobar el contrato.",
          forPath: "file.ts",
          cursor: 999,
        },
      ],
    },
    current,
    { repairEvidenceProtocol: true },
  );
  expect(result.evidenceRequests[0]).toMatchObject({ cursor: 8, forPath: "file.ts" });
});

test("malformed context requests preserve valid candidates and requests", () => {
  const result = validateAssessment(
    {
      findings: [finding(1)],
      evidenceRequests: [
        { path: "helper.ts", symbol: "helper", reason: "Comprobar." },
        { path: "../secret", scope: "file", reason: "Invalid request" },
      ],
    },
    plan().chunks[0],
    { repairEvidenceProtocol: true, isolateInvalidFindings: true },
  );
  expect(result.findings).toHaveLength(1);
  expect(result.evidenceRequests).toHaveLength(1);
  expect(result.limitations[0]).toContain("Solicitud de contexto descartada");
});

test("path-only requests use bounded file recovery and line ranges reject unbounded input", () => {
  const current = plan().chunks[0];
  const result = validateAssessment(
    {
      findings: [],
      evidenceRequests: [
        { path: "helper.ts", reason: "Comprobar el contrato." },
        { path: "helper.ts", startLine: 1, endLine: 9000, reason: "Invalid range" },
      ],
    },
    current,
    { repairEvidenceProtocol: true },
  );
  expect(result.evidenceRequests).toHaveLength(1);
  expect(result.evidenceRequests[0].scope).toBe("file");
  expect(result.limitations[0]).toContain("range");
});

test("application changes receive analysis before reviewer infrastructure", async () => {
  const current = plan();
  current.chunks[0].parts[0].path = ".github/reviewer.ts";
  const application = plan().chunks[0];
  application.parts[0].path = "apps/mobile/task.ts";
  current.chunks.push(application);
  current.files = 2;
  const paths: string[] = [];
  const report = await reviewPlan({
    plan: current,
    apiKey: "fixture",
    sleep: async () => {},
    fetchImpl: async (_url: any, options: any) => {
      paths.push(JSON.parse(JSON.parse(options.body).messages[1].content).parts[0].path);
      return response({ findings: [] });
    },
  });
  expect(paths).toEqual(["apps/mobile/task.ts", ".github/reviewer.ts"]);
  expect(report.coverage).toBe("complete");
});
