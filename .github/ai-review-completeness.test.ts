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
