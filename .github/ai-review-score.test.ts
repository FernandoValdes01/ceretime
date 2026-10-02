import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeConfidence } from "./ai-review-confidence.cjs";
import {
  evaluateReview,
  formatReview,
  parseSummary,
  prepareReview,
  publishReview,
} from "./ai-review-score.cjs";

const sha = "a".repeat(40);
const oldSha = "b".repeat(40);
const runUrl = "https://github.com/owner/repo/actions/runs/1";
const workflow = Bun.YAML.parse(
  await Bun.file(`${import.meta.dir}/workflows/ai-code-review.yml`).text(),
) as any;
const config = Bun.YAML.parse(
  await Bun.file(`${import.meta.dir}/../.pr-reviewer.yml`).text(),
) as any;
const ci = Bun.YAML.parse(await Bun.file(`${import.meta.dir}/workflows/ci.yml`).text()) as any;
const summary = (score = 5, reviewedSha = sha, risk = "low", findings = 0) =>
  `Confidence Score: ${score}/5; Risk: ${risk}; Reviewed commit: ${reviewedSha}; Hallazgos: ${findings}; Resumen: No se detectan problemas relevantes.`;
const input = (overrides = {}) => ({
  outcome: "success",
  summary: summary(),
  risk: "low",
  commentsCount: "0",
  expectedSha: sha,
  currentSha: sha,
  coverage: "complete",
  ...overrides,
});

test("accepts a current 5/5 review with no findings and low risk", () => {
  expect(evaluateReview(input())).toMatchObject({ state: "success", score: 5 });
});

for (const score of [0, 1, 2, 3, 4]) {
  test(`keeps ${score}/5 informative and failing`, () => {
    expect(evaluateReview(input({ summary: summary(score) }))).toMatchObject({
      state: "failure",
      score,
      reason: "reviewed",
    });
  });
}

test("rejects missing, stale and failed reviews", () => {
  expect(evaluateReview(input({ summary: "" }))).toMatchObject({
    state: "failure",
    reason: "missing",
  });
  expect(evaluateReview(input({ summary: summary(5, oldSha) }))).toMatchObject({
    state: "failure",
    reason: "stale",
  });
  expect(evaluateReview(input({ outcome: "failure" }))).toMatchObject({
    state: "failure",
    score: 0,
    reason: "failed",
  });
});

for (const invalid of [
  "No issues found",
  summary(6),
  summary(-1),
  summary(5).replace("5/5", "5.0/5"),
  summary(5).replace("Confidence Score: 5/5; ", ""),
  summary(5).replace(sha, "merge-sha"),
  summary(5).replace("Risk: low", "Risk: critical"),
  summary(5).replace("Hallazgos: 0", "Hallazgos: 6"),
  `${summary()}; Confidence Score: 5/5`,
  `${summary()}\nConfidence Score: 5/5`,
]) {
  test(`rejects malformed output ${invalid.slice(0, 55)}`, () => {
    expect(parseSummary(invalid)).toBeNull();
    expect(evaluateReview(input({ summary: invalid })).state).toBe("failure");
  });
}

test("rejects inconsistent outputs and an incomplete diff", () => {
  for (const overrides of [
    { risk: "high" },
    { commentsCount: "1" },
    { coverage: "incomplete" },
    { summary: summary(5, sha, "medium"), risk: "medium" },
    { summary: summary(5, sha, "low", 1), commentsCount: "1" },
  ]) {
    expect(evaluateReview(input(overrides))).toMatchObject({ state: "failure", score: 0 });
  }
});

function harness(heads = [sha], draft = false) {
  const statuses: any[] = [];
  const reviews: any[] = [];
  let reads = 0;
  const existing = [
    {
      id: 10,
      user: { login: "github-actions[bot]" },
      commit_id: sha,
      body: `## AI Code Review\n\n> ${summary()}`,
    },
  ];
  const github = {
    rest: {
      pulls: {
        get: async () => ({
          data: {
            head: { sha: heads[Math.min(reads++, heads.length - 1)] },
            base: { ref: "main" },
            state: "open",
            draft,
          },
        }),
        listReviews: () => {},
        listFiles: () => {},
        createReview: async (args: any) => reviews.push(args),
        updateReview: async (args: any) => reviews.push(args),
      },
      repos: { createCommitStatus: async (args: any) => statuses.push(args) },
    },
    paginate: async (method: unknown) => (method === github.rest.pulls.listReviews ? existing : []),
    request: async () => ({ data: "diff" }),
  };
  const context = {
    repo: { owner: "owner", repo: "repo" },
    payload: { pull_request: { number: 1 } },
    sha: "merge-sha",
  };
  const env = {
    REVIEW_SHA: sha,
    RUN_URL: runUrl,
    REVIEW_OUTCOME: "success",
    REVIEW_SUMMARY: summary(),
    REVIEW_RISK: "low",
    REVIEW_COMMENTS: "0",
    REVIEW_COVERAGE: "complete",
    REVIEW_COST: "0.0000",
  };
  const outputs: Record<string, string> = {};
  const core = {
    info: () => {},
    setOutput: (name: string, value: string) => {
      outputs[name] = value;
    },
  };
  return { github, context, env, core, outputs, statuses, reviews, existing };
}

test("publishes the head SHA rather than the temporary merge SHA", async () => {
  const h = harness();
  await publishReview(h);
  expect(h.statuses).toHaveLength(1);
  expect(h.statuses[0]).toMatchObject({ sha, state: "success", context: "AI Review 5/5" });
  expect(h.reviews[0]).toMatchObject({ review_id: 10 });
  expect(h.reviews[0].body).toContain(`Reviewed commit: ${sha}`);
});

test("creates a COMMENT review with a commit association when there are no inline findings", async () => {
  const h = harness();
  h.existing.length = 0;
  await publishReview(h);
  expect(h.reviews[0]).toMatchObject({ commit_id: sha, event: "COMMENT" });
  expect(h.reviews[0].body).toContain("Hallazgos: 0");
  expect(h.reviews[0].body).toContain("NO autoriza merge");
});

test("preserves the inline review when a separate model assessment changes its summary", async () => {
  const h = harness();
  const actionSummary = "Observaciones del cambio sin evaluación estructurada.";
  h.existing[0].body = `## AI Code Review\n\n> ${actionSummary}`;
  await publishReview({ ...h, env: { ...h.env, ACTION_SUMMARY: actionSummary } });
  expect(h.reviews).toHaveLength(1);
  expect(h.reviews[0]).toMatchObject({ review_id: 10 });
  expect(h.reviews[0].body).toContain("Confidence Score: 5/5");
  expect(h.reviews[0].body).toContain(actionSummary);
  expect(h.statuses[0]).toMatchObject({ sha, state: "success" });
});

test("ignores summaries from another author", async () => {
  const h = harness();
  h.existing[0].user.login = "someone";
  await publishReview(h);
  expect(h.reviews[0]).toMatchObject({ commit_id: sha, event: "COMMENT" });
});

for (const [outcome, body, reason] of [
  ["success", "", "missing"],
  ["failure", summary(), "failed"],
  ["success", summary(5, oldSha), "stale"],
]) {
  test(`publishes ${reason} as a failure with score zero`, async () => {
    const h = harness();
    h.env.REVIEW_OUTCOME = outcome;
    h.env.REVIEW_SUMMARY = body;
    await publishReview(h);
    expect(h.statuses[0]).toMatchObject({ sha, state: "failure" });
    expect(h.reviews[0].body).toContain("Confidence Score: 0/5");
  });
}

test("an old run never publishes success on a newer head", async () => {
  for (const heads of [[oldSha], [sha, oldSha], [sha, sha, oldSha]]) {
    const h = harness(heads);
    await publishReview(h);
    expect(h.statuses.every((status) => status.sha === sha && status.state !== "success")).toBe(
      true,
    );
    expect(h.reviews.every((review) => review.commit_id !== oldSha)).toBe(true);
  }
});

test("drafts do not publish a review or status", async () => {
  const h = harness([sha], true);
  await publishReview(h);
  await prepareReview(h);
  expect(h.reviews).toHaveLength(0);
  expect(h.statuses).toHaveLength(0);
  expect(h.outputs.current).toBe("false");
});

test("a synchronize run invalidates the new SHA before calling the model", async () => {
  const h = harness();
  const workspace = mkdtempSync(join(tmpdir(), "ai-review-test-"));
  const configPath = join(workspace, ".pr-reviewer.yml");
  mkdirSync(join(workspace, ".git"));
  writeFileSync(
    configPath,
    "custom_instructions: >-\n  SHA: __REVIEWED_SHA__\n  Coverage: __COVERAGE__\n",
  );
  try {
    await prepareReview({ ...h, env: { ...h.env, GITHUB_WORKSPACE: workspace } });
    expect(h.statuses[0]).toMatchObject({
      sha,
      state: "failure",
      description: "Falta la revisión de IA para este commit.",
    });
    expect(h.outputs).toEqual({
      coverage: "complete",
      current: "true",
      instructions: `SHA: ${sha} Coverage: complete`,
    });
    expect(readFileSync(configPath, "utf8")).toContain(sha);
    expect(readFileSync(configPath, "utf8")).not.toContain("__REVIEWED_SHA__");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("preparation does not overwrite a newer head", async () => {
  const h = harness([oldSha]);
  await prepareReview(h);
  expect(h.statuses).toHaveLength(0);
  expect(h.outputs.current).toBe("false");
});

test("failure summaries are explicit and never reuse an invalid evaluation", () => {
  const body = formatReview(evaluateReview(input({ outcome: "failure" })), sha, runUrl, "invalid");
  expect(body).toContain("Confidence Score: 0/5");
  expect(body).toContain("Risk: high");
  expect(body).toContain("no disponible");
  expect(body).not.toContain("No se detectan problemas relevantes");
});

test("pins the action and keeps review permissions, events and concurrency separate from CI", () => {
  expect(workflow.on.pull_request.branches).toEqual(["main"]);
  expect(workflow.on.pull_request.types).toEqual([
    "opened",
    "reopened",
    "synchronize",
    "ready_for_review",
  ]);
  expect(workflow.permissions).toEqual({
    contents: "read",
    "pull-requests": "write",
    statuses: "write",
  });
  expect(workflow.concurrency).toEqual({
    group: "ai-code-review-${{ github.event.pull_request.number }}",
    "cancel-in-progress": true,
  });
  expect(workflow.jobs.review.if).toContain("!github.event.pull_request.draft");
  const steps = workflow.jobs.review.steps;
  const action = steps.find((step: any) => step.id === "ai_review");
  expect(action.uses).toBe("mara-werils/ai-code-reviewer@2f6bb8c98d791de5b84dc425eacadcf0a7052fcf");
  expect(action.env).toEqual({ GROQ_API_KEY: "${{ secrets.GROQ_API_KEY }}" });
  expect(action.with.custom_instructions).toBe("${{ steps.prepare.outputs.instructions }}");
  expect(action.with).toEqual({
    provider: "groq",
    model: "openai/gpt-oss-120b",
    language: "es",
    review_style: "minimal",
    max_comments: "5",
    auto_summarize: "true",
    suggest_tests: "true",
    label_pr: "false",
    custom_instructions: "${{ steps.prepare.outputs.instructions }}",
  });
  expect(steps[0].with.ref).toBe("${{ github.event.pull_request.head.sha }}");
  expect(steps[0].with["persist-credentials"]).toBe(false);
  expect(steps.at(-1).env.REVIEW_OUTCOME).toBe(
    "${{ steps.confidence.outcome == 'failure' && 'failure' || steps.ai_review.outcome }}",
  );
  expect(steps.at(-1).env.REVIEW_SUMMARY).toBe("${{ steps.confidence.outputs.summary }}");
  expect(steps.at(-1).if).toBe("${{ always() && !cancelled() }}");
  for (const id of ["lint-and-format", "mobile", "web", "backend"])
    expect(ci.jobs[id]).toBeDefined();
  expect(ci.jobs["ai-review"]).toBeUndefined();
  expect(ci.jobs["lint-and-format"].steps.at(-1).run).toBe(
    "bun test ./.github/ai-review-score.test.ts",
  );
});

test("reviewer configuration covers generated files and requests the complete score rubric", () => {
  expect(config).toMatchObject({
    review_style: "minimal",
    max_comments: 5,
    max_diff_size: 10000,
    max_files: 50,
  });
  for (const pattern of [
    "bun.lock",
    "convex/_generated/**",
    "apps/web/src/routeTree.gen.ts",
    "dist/**",
    "build/**",
    "*.lock",
  ])
    expect(config.ignore_paths).toContain(pattern);
  expect(config.custom_instructions).toContain("No inventes hallazgos para completar el límite.");
  expect(config.custom_instructions).toContain("__REVIEWED_SHA__");
  expect(config.custom_instructions).toContain("__COVERAGE__");
});

async function confidence(
  responseBody: any,
  options: { status?: number; outcome?: string; summary?: string } = {},
) {
  const h = harness();
  const workspace = mkdtempSync(join(tmpdir(), "ai-confidence-test-"));
  mkdirSync(join(workspace, ".git"));
  writeFileSync(join(workspace, ".git/ai-review-diff.txt"), "example PR diff");
  const requests: any[] = [];
  try {
    await normalizeConfidence({
      core: h.core,
      env: {
        ...h.env,
        REVIEW_SUMMARY: options.summary ?? "Evaluación sin nota parseable.",
        REVIEW_OUTCOME: options.outcome ?? "success",
        GROQ_API_KEY: "test",
        GITHUB_WORKSPACE: workspace,
      },
      sleep: async () => {},
      fetchImpl: async (url: string, args: any) => {
        requests.push({ url, body: JSON.parse(args.body) });
        return {
          ok: (options.status ?? 200) === 200,
          status: options.status ?? 200,
          headers: new Headers(),
          json: async () => ({ choices: [{ message: { content: JSON.stringify(responseBody) } }] }),
        };
      },
    });
    return { outputs: h.outputs, requests };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

test("asks the configured model for a real confidence assessment when the Action returns prose", async () => {
  const result = await confidence({
    score: 5,
    explanation: "No se detectan problemas relevantes.",
  });
  expect(parseSummary(result.outputs.summary)).toMatchObject({
    score: 5,
    sha,
    risk: "low",
    findings: 0,
  });
  expect(result.requests[0].url).toBe("https://api.groq.com/openai/v1/chat/completions");
  expect(result.requests[0].body).toMatchObject({
    model: "openai/gpt-oss-120b",
    response_format: { type: "json_object" },
  });
  expect(JSON.parse(result.requests[0].body.messages[1].content)).toMatchObject({
    sha,
    diff: "example PR diff",
  });
});

test("does not ask Groq again for failed, missing or already structured reviews", async () => {
  for (const options of [
    { outcome: "failure" },
    { summary: "" },
    { summary: summary() },
    { summary: "No reviewable files in this PR (all files match ignore patterns)." },
  ]) {
    expect((await confidence(null, options)).requests).toHaveLength(0);
  }
});

test("reassesses structured summaries that contradict the Action outputs", async () => {
  const result = await confidence(
    { score: 0, explanation: "La revisión es incompleta." },
    { summary: summary(0, sha, "high") },
  );
  expect(result.requests).toHaveLength(1);
  expect(parseSummary(result.outputs.summary)).toMatchObject({
    score: 0,
    sha,
    risk: "low",
    findings: 0,
  });
});

test("never invents a score when the assessment fails or returns an invalid value", async () => {
  for (const body of [
    { score: 6, explanation: "Invalid" },
    { score: -1, explanation: "Invalid" },
    { score: "5", explanation: "Invalid" },
    { score: 5 },
    null,
  ]) {
    await expect(confidence(body)).rejects.toThrow("evaluación de confianza válida");
  }
  await expect(confidence(null, { status: 429 })).rejects.toThrow("HTTP 429");
  await expect(confidence(null, { status: 401 })).rejects.toThrow("HTTP 401");
});
