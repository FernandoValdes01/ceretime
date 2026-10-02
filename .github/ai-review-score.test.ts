import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatInline, withoutBold } from "./ai-review-presentation.cjs";
import { normalizeConfidence } from "./ai-review-confidence.cjs";
import {
  buildPlan,
  LIMITS,
  matchesIgnore,
  reviewPlan,
  aggregate,
  validateAssessment,
  publishFindings,
} from "./ai-review-chunks.cjs";
import { verifyScale } from "./ai-review-scale.cjs";
import {
  evaluateReview,
  formatReview,
  parseSummary,
  prepareReview,
  publishReview,
  archiveReviewSummaries,
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

test("shows all six controlled scores without publishing simulated reviews", () => {
  const report = verifyScale();
  for (let score = 0; score <= 5; score++) {
    expect(report).toContain(
      `| ${score}/5 | ${score}/5 | ${score === 5 ? "success" : "failure"} |`,
    );
  }
  expect(report).toContain("No son evaluaciones de Groq");
  expect(
    workflow.jobs.review.steps.find((step: any) => step.run === "node .github/ai-review-scale.cjs"),
  ).toBeDefined();
});

test("omits the policy footer from the visible review", () => {
  const body = formatReview(evaluateReview(input()), sha, runUrl, "0");
  expect(body).not.toContain("Confidence Score es informativo");
  expect(body).not.toContain("La revisión humana TI4 sigue siendo obligatoria");
});

test("explains incomplete coverage and retains actionable observations from the reviewer", () => {
  const body = formatReview(evaluateReview(input({ coverage: "incomplete" })), sha, runUrl, "0", {
    actionSummary: "Validar la autorización en el backend antes de guardar el registro.",
    diffSize: "96400",
    filesCount: "25",
  });
  expect(body).toContain("96.400");
  expect(body).toContain("El tamaño total no determina la cobertura");
  expect(body).toContain("### Qué debes cambiar");
  expect(body).toContain("Validar la autorización en el backend");
  expect(body).toContain("No es una calificación de la calidad del código");
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
  const summaryWrites: any[] = [];
  const inline: any[] = [];
  const updatedInline: any[] = [];
  const comments: any[] = [];
  const deletedComments: any[] = [];
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
        listReviewComments: () => {},
        updateReviewComment: async (args: any) => updatedInline.push(args),
        createReview: async (args: any) => reviews.push(args),
        updateReview: async (args: any) => reviews.push(args),
      },
      issues: {
        listComments: () => {},
        createComment: async (args: any) => summaryWrites.push(args),
        updateComment: async (args: any) => summaryWrites.push(args),
        deleteComment: async (args: any) => deletedComments.push(args),
      },
      repos: {
        createCommitStatus: async (args: any) => statuses.push(args),
        getCommit: async () => ({
          data: { sha, commit: { message: "ci(review): revisa el cambio\n\nDetalle" } },
        }),
      },
    },
    paginate: async (method: unknown) => {
      if (method === github.rest.pulls.listReviews) return existing;
      if (method === github.rest.pulls.listReviewComments) return inline;
      if (method === github.rest.issues.listComments) return comments;
      return [chunkFile("file.ts", 1)];
    },
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
  return {
    github,
    context,
    env,
    core,
    outputs,
    statuses,
    reviews,
    summaryWrites,
    existing,
    inline,
    updatedInline,
    comments,
    deletedComments,
  };
}

test("publishes the head SHA rather than the temporary merge SHA", async () => {
  const h = harness();
  await publishReview(h);
  expect(h.statuses).toHaveLength(1);
  expect(h.statuses[0]).toMatchObject({ sha, state: "success", context: "R2D2 Review 5/5" });
  expect(h.summaryWrites[0]).toMatchObject({ issue_number: 1 });
  expect(h.summaryWrites[0].body).toContain(
    `[ci\\(review\\): revisa el cambio](https://github.com/owner/repo/commit/${sha})`,
  );
  expect(h.summaryWrites[0].body).toContain(`SHA revisado: \`${sha}\``);
});

test("creates one PR summary without creating an extra review when there are no inline findings", async () => {
  const h = harness();
  h.existing.length = 0;
  await publishReview(h);
  expect(h.summaryWrites[0]).toMatchObject({ issue_number: 1 });
  expect(h.reviews).toHaveLength(0);
  expect(h.summaryWrites[0].body).toContain("| low | 0 | Review vigente |");
  expect(h.summaryWrites[0].body).not.toContain("NO autoriza merge");
});

test("keeps inline findings separate from the single summary", async () => {
  const h = harness();
  const actionSummary = "Observaciones del cambio sin evaluación estructurada.";
  h.existing[0].body = `## AI Code Review\n\n> ${actionSummary}`;
  await publishReview({ ...h, env: { ...h.env, ACTION_SUMMARY: actionSummary } });
  expect(h.summaryWrites).toHaveLength(1);
  expect(h.summaryWrites[0]).toMatchObject({ issue_number: 1 });
  expect(h.summaryWrites[0].body).toContain("Confidence Score: 5/5");
  expect(h.summaryWrites[0].body).toContain(actionSummary);
  expect(h.statuses[0]).toMatchObject({ sha, state: "success" });
});

test("ignores summaries from another author", async () => {
  const h = harness();
  h.existing[0].user.login = "someone";
  await publishReview(h);
  expect(h.summaryWrites[0]).toMatchObject({ issue_number: 1 });
  expect(h.reviews).toHaveLength(0);
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
    expect(h.summaryWrites[0].body).toContain("Confidence Score: 0/5");
  });
}

test("an old run never publishes success on a newer head", async () => {
  for (const heads of [[oldSha], [sha, oldSha], [sha, sha, oldSha]]) {
    const h = harness(heads);
    await publishReview(h);
    expect(h.statuses.every((status) => status.sha === sha && status.state !== "success")).toBe(
      true,
    );
    expect(h.summaryWrites.every((review) => review.commit_id !== oldSha)).toBe(true);
  }
});

test("drafts do not publish a review or status", async () => {
  const h = harness([sha], true);
  await publishReview(h);
  await prepareReview(h);
  expect(h.summaryWrites).toHaveLength(0);
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
      diff_size: "4",
      files_count: "1",
      mode: "single",
      chunk_instructions: `SHA: ${sha} Coverage: complete`,
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
  expect(body).toContain("| high | 0 | Error de ejecución |");
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
    github_token: "${{ steps.r2d2_token.outputs.token || github.token }}",
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
    "${{ steps.prepare.outputs.mode == 'chunked' && steps.confidence.outcome || (steps.confidence.outcome == 'failure' && 'failure' || steps.ai_review.outcome) }}",
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

test("R2D2 displays the real fraction without repeating the App avatar", () => {
  for (const score of [0, 3, 5]) {
    const body = formatReview(
      evaluateReview(input({ summary: summary(score) })),
      sha,
      runUrl,
      "0.005",
    );
    expect(body).toContain("## R2D2 · AI Code Review");
    expect(body).toContain(`### Confidence Score: ${score}/5`);
    expect(body).not.toContain("<img");
    expect(body).not.toContain("r2d2.jpg");
    expect(body).toContain("| Risk | Hallazgos | Estado |");
    expect(body).not.toContain("**");
    expect(body).not.toContain("Free & open source");
  }
});

test("inline formatting keeps suggestions and code literal while removing prose bold", () => {
  const body =
    "**[WARNING] Warning**\n\n**Validación**: revisa `2 ** 3`.\n\nSuggested fix:\n```suggestion\nconst power = 2 ** 3;\n```";
  expect(formatInline(body)).toBe(
    "<!-- ceretime-r2d2-inline -->\n### R2D2 · Advertencia\n\nValidación: revisa `2 ** 3`.\n\nPropuesta:\n```suggestion\nconst power = 2 ** 3;\n```",
  );
  expect(withoutBold("**Título**\n~~~js\nvalue ** 2\n~~~")).toContain("value ** 2");
  expect(formatInline("Una observación humana.")).toBe("Una observación humana.");
});

test("tidies only the authenticated reviewer's comments and preserves other authors and old inline findings", async () => {
  const h = harness();
  const raw = "**[WARNING] Warning**\n\n**Descripción** del problema.";
  h.inline.push(
    { id: 1, user: { login: "github-actions[bot]" }, original_commit_id: sha, body: raw },
    { id: 2, user: { login: "human" }, original_commit_id: sha, body: raw },
    { id: 3, user: { login: "github-actions[bot]" }, original_commit_id: oldSha, body: raw },
  );
  const advertising = "## AI Code Review\nhttps://github.com/mara-werils/ai-code-reviewer";
  h.comments.push(
    { id: 4, user: { login: "github-actions[bot]" }, body: advertising },
    { id: 5, user: { login: "human" }, body: advertising },
    { id: 6, user: { login: "github-actions[bot]" }, body: "Resultado de CI" },
  );
  await publishReview(h);
  expect(h.updatedInline).toHaveLength(1);
  expect(h.updatedInline[0]).toEqual({
    owner: "owner",
    repo: "repo",
    comment_id: 1,
    body: formatInline(raw),
  });
  expect(h.deletedComments).toEqual([{ owner: "owner", repo: "repo", comment_id: 4 }]);
});

test("uses the configured App identity instead of trusting an arbitrary bot", async () => {
  const h = harness();
  h.existing[0].user.login = "r2d2[bot]";
  await publishReview({ ...h, env: { ...h.env, REVIEW_BOT_LOGIN: "r2d2[bot]" } });
  expect(h.summaryWrites[0]).toMatchObject({ issue_number: 1 });
  const app = workflow.jobs.review.steps.find((step: any) => step.id === "r2d2_token");
  expect(app.uses).toBe("actions/create-github-app-token@fee1f7d63c2ff003460e3d139729b119787bc349");
  expect(app.with["permission-contents"]).toBe("read");
  expect(app.with["permission-pull-requests"]).toBe("write");
  expect(app.with["permission-statuses"]).toBe("write");
  expect(app.with.repositories).toBe("${{ github.event.repository.name }}");
});

test("formats previous inline findings only when they belong to this bot's identified AI review", async () => {
  const h = harness();
  h.existing.push({
    id: 11,
    user: { login: "github-actions[bot]" },
    commit_id: oldSha,
    body: "<!-- ceretime-ai-review -->\n## AI Code Review",
  });
  const body =
    "**[WARNING] Warning**\n\n**Hallazgo anterior**.\n```suggestion\nconst result = 2 ** 3;\n```";
  h.inline.push({
    id: 12,
    user: { login: "github-actions[bot]" },
    original_commit_id: oldSha,
    pull_request_review_id: 11,
    body,
  });
  await publishReview(h);
  expect(h.updatedInline).toEqual([
    { owner: "owner", repo: "repo", comment_id: 12, body: formatInline(body) },
  ]);
  expect(h.inline[0].original_commit_id).toBe(oldSha);
  expect(h.updatedInline[0].body).toContain("const result = 2 ** 3;");
});

test("updates the same summary across commits and retries, ignoring other authors", async () => {
  const h = harness();
  h.comments.push(
    { id: 20, user: { login: "human" }, body: "<!-- ceretime-ai-review-summary -->" },
    {
      id: 21,
      user: { login: "github-actions[bot]" },
      body: "<!-- ceretime-ai-review-summary -->\nPrevious SHA",
    },
    {
      id: 22,
      user: { login: "github-actions[bot]" },
      body: "<!-- ceretime-ai-review-summary -->\nDuplicate",
    },
  );
  await publishReview(h);
  await publishReview(h);
  expect(h.summaryWrites.map((write) => write.comment_id)).toEqual([21, 21]);
  expect(h.summaryWrites.every((write) => !("issue_number" in write))).toBe(true);
  expect(h.deletedComments.every((comment) => comment.comment_id === 22)).toBe(true);
});

test("archives only this bot's identified review bodies, preserving inline associations", async () => {
  const h = harness();
  h.existing[0].body = "<!-- ceretime-ai-review -->\nOld summary";
  h.existing.push({
    id: 11,
    user: { login: "human" },
    commit_id: oldSha,
    body: h.existing[0].body,
  });
  await archiveReviewSummaries({ ...h, botLogin: "github-actions[bot]", reviews: h.existing });
  expect(h.reviews).toEqual([
    {
      owner: "owner",
      repo: "repo",
      pull_number: 1,
      review_id: 10,
      body: "<!-- ceretime-ai-review-inline-only -->",
    },
  ]);
  expect(h.existing[0].commit_id).toBe(sha);
});

test("uses the exact commit title safely and keeps the full SHA in folded details", () => {
  const body = formatReview(evaluateReview(input()), sha, runUrl, "0.001", {
    commitTitle: "docs(ci): añade [enlace]\nBody ignored",
  });
  expect(body).toContain("Reviewed commit: [docs\\(ci\\): añade \\[enlace\\]]");
  expect(body).toContain(`SHA revisado: \`${sha}\``);
  expect(body).not.toContain("Body ignored");
});

// The chunk path calls the same model, but publishes only the aggregated review.
function chunkFile(name: string, lines = 80, width = 70) {
  return {
    filename: name,
    patch: `@@ -0,0 +1,${lines} @@\n${Array.from({ length: lines }, (_, i) => `+${String(i).padStart(5, "0")}${"x".repeat(width)}`).join("\n")}`,
    additions: lines,
    deletions: 0,
  };
}

async function runChunks(plan: any, responses?: any[], fetchOverride?: any) {
  const requests: any[] = [];
  const result = await reviewPlan({
    plan,
    instructions:
      "CERETIME: Presentación -> Aplicación -> Dominio. Autorización en backend. No inventes hallazgos.",
    apiKey: "test",
    sleep: async () => {},
    fetchImpl:
      fetchOverride ??
      (async (_url: string, args: any) => {
        requests.push(JSON.parse(args.body));
        const response = responses?.length
          ? responses.shift()
          : { score: 5, risk: "low", explanation: "Sin problemas relevantes.", findings: [] };
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ choices: [{ message: { content: JSON.stringify(response) } }] }),
        };
      }),
  });
  return { result, requests };
}

for (const [label, files] of [
  ["under 10,000 chars", [chunkFile("small.ts", 20)]],
  ["over 10,000 chars", [chunkFile("a.ts"), chunkFile("b.ts"), chunkFile("c.ts")]],
  ["about 100,000 chars", Array.from({ length: 12 }, (_, i) => chunkFile(`file-${i}.ts`, 110))],
] as const) {
  test(`reviews the entire eligible diff ${label}`, async () => {
    const plan = buildPlan(files, {}, sha);
    expect(plan.issues).toEqual([]);
    const { result, requests } = await runChunks(plan);
    expect(result.coverage).toBe("complete");
    expect(result.processed).toBe(plan.chunks.length);
    expect(result.score).toBe(5);
    expect(parseSummary(result.summary)).toMatchObject({ score: 5, sha, risk: "low", findings: 0 });
    expect(
      evaluateReview(input({ summary: result.summary, coverage: result.coverage })).state,
    ).toBe("success");
    expect(requests).toHaveLength(plan.chunks.length);
    expect(
      requests.every(
        (r) =>
          r.model === "openai/gpt-oss-120b" &&
          r.messages[0].content.includes("Autorización en backend") &&
          JSON.parse(r.messages[1].content).sha === sha,
      ),
    ).toBe(true);
  });
}

test("groups small files and preserves whole hunks when they fit", () => {
  const files = [chunkFile("a.ts", 10), chunkFile("b.ts", 10)];
  const plan = buildPlan(files, {}, sha);
  expect(plan.chunks).toHaveLength(1);
  expect(plan.chunks[0].parts.map((p: any) => p.path)).toEqual(["a.ts", "b.ts"]);
  expect(plan.chunks[0].parts.every((p: any) => p.patch.startsWith("@@"))).toBe(true);
});

test("splits a large file and an oversized hunk without losing a changed line", () => {
  const file = chunkFile("large.ts", 500);
  const plan = buildPlan([file], {}, sha);
  expect(plan.issues).toEqual([]);
  expect(plan.chunks.length).toBeGreaterThan(1);
  const anchors = plan.chunks.flatMap((c: any) => c.parts.flatMap((p: any) => p.anchors));
  expect(new Set(anchors).size).toBe(500);
  expect(anchors).toEqual(Array.from({ length: 500 }, (_, i) => `RIGHT:${i + 1}`));
  for (const chunk of plan.chunks) {
    expect(
      chunk.parts.reduce(
        (n: number, p: any) => n + JSON.stringify({ ...p, anchors: undefined }).length,
        0,
      ),
    ).toBeLessThanOrEqual(LIMITS.chunkChars);
  }
});

test("ignored files never count toward coverage or appear in requests", async () => {
  const plan = buildPlan(
    [
      chunkFile("src/a.ts", 10),
      { filename: "convex/_generated/api.ts" },
      chunkFile("apps/web/bun.lock", 300),
    ],
    { ignore_paths: ["convex/_generated/**", "*.lock"] },
    sha,
  );
  expect(plan.files).toBe(1);
  expect(plan.issues).toEqual([]);
  const { result, requests } = await runChunks(plan);
  expect(result.coverage).toBe("complete");
  expect(JSON.stringify(requests)).not.toContain("bun.lock");
  expect(JSON.stringify(requests)).not.toContain("convex/_generated");
  for (const path of [
    "bun.lock",
    "apps/web/yarn.lock",
    "dist/index.js",
    "apps/web/dist/index.js",
  ]) {
    expect(matchesIgnore(path, config.ignore_paths)).toBe(true);
  }
});

test("a failed necessary chunk remains incomplete after a bounded retry", async () => {
  const plan = buildPlan([chunkFile("a.ts", 160), chunkFile("b.ts", 160)], {}, sha);
  let calls = 0;
  const { result } = await runChunks(plan, undefined, async () => {
    calls++;
    return calls === 1
      ? {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    score: 5,
                    risk: "low",
                    explanation: "Correcto.",
                    findings: [],
                  }),
                },
              },
            ],
          }),
        }
      : { ok: false, status: 503, headers: new Headers() };
  });
  expect(result.processed).toBe(1);
  expect(result.coverage).toBe("incomplete");
  expect(result.score).toBe(0);
  expect(calls).toBe(3);
  expect(evaluateReview(input({ summary: result.summary, coverage: result.coverage })).score).toBe(
    0,
  );
});

test("invalid responses and missing or truncated patches cannot claim complete coverage", async () => {
  const plan = buildPlan([chunkFile("a.ts", 10)], {}, sha);
  const { result } = await runChunks(plan, [{ score: 6 }, { score: 6 }]);
  expect(result.coverage).toBe("incomplete");
  for (const file of [
    { filename: "binary.png", additions: 0, deletions: 0 },
    { ...chunkFile("a.ts", 10), patch: "@@ -0,0 +1,10 @@\n+only one line" },
  ]) {
    const missing = buildPlan([file], {}, sha);
    const run = await runChunks(missing);
    expect(run.result.coverage).toBe("incomplete");
    expect(run.requests).toHaveLength(0);
  }
});

test("recovers a malformed response but respects call and chunk budgets", async () => {
  const plan = buildPlan([chunkFile("a.ts", 10)], {}, sha);
  const recovered = await runChunks(plan, [
    null,
    { score: 5, risk: "low", explanation: "Correcto.", findings: [] },
  ]);
  expect(recovered.result.coverage).toBe("complete");
  expect(recovered.result.calls).toBe(2);
  const tooLarge = buildPlan([chunkFile("a.ts", 400)], { chunking: { maxChunks: 1 } }, sha);
  expect((await runChunks(tooLarge)).result.coverage).toBe("incomplete");
  const exhausted = buildPlan([chunkFile("a.ts", 400)], { chunking: { maxCalls: 1 } }, sha);
  expect((await runChunks(exhausted)).result).toMatchObject({
    coverage: "incomplete",
    calls: 1,
    score: 0,
  });
});

test("deduplicates anchors, retains the five most important findings and aggregates conservatively", () => {
  const plan = buildPlan([chunkFile("a.ts", 10)], {}, sha);
  const findings = Array.from({ length: 8 }, (_, i) => ({
    path: "a.ts",
    line: i + 1,
    side: "RIGHT",
    severity: i === 7 ? "critical" : "warning",
    body: `Problema ${i}. Corrección e impacto.`,
  }));
  const result = aggregate(
    plan,
    [
      {
        score: 1,
        risk: "high",
        explanation: "Corregir los problemas.",
        findings: [
          ...findings,
          { ...findings[0], body: "El mismo problema explicado de otra forma." },
        ],
      },
    ],
    1,
  );
  expect(result.coverage).toBe("complete");
  expect(result.findings).toHaveLength(5);
  expect(result.findings[0].severity).toBe("critical");
  expect(result.findings.filter((f: any) => f.line === 1)).toHaveLength(1);
  expect(parseSummary(result.summary)).toMatchObject({ score: 1, risk: "high", findings: 5, sha });
});

test("rejects invented inline anchors and incoherent 5/5 responses", () => {
  const plan = buildPlan([chunkFile("a.ts", 10)], {}, sha);
  for (const finding of [
    { path: "other.ts", line: 1 },
    { path: "a.ts", line: 1000 },
  ]) {
    expect(() =>
      validateAssessment(
        {
          score: 3,
          risk: "medium",
          explanation: "Problema.",
          findings: [{ ...finding, side: "RIGHT", severity: "warning", body: "Corregir." }],
        },
        plan.chunks[0],
      ),
    ).toThrow();
  }
  expect(() =>
    validateAssessment(
      { score: 5, risk: "high", explanation: "Correcto.", findings: [] },
      plan.chunks[0],
    ),
  ).toThrow();
});

test("an old run stops requesting chunks and cannot complete a newer SHA", async () => {
  const plan = buildPlan([chunkFile("a.ts", 400)], {}, sha);
  let calls = 0;
  const result = await reviewPlan({
    plan,
    instructions: "CERETIME",
    apiKey: "test",
    isCurrent: async () => false,
    fetchImpl: async () => {
      calls++;
      throw new Error("Should not call");
    },
    sleep: async () => {},
  });
  expect(calls).toBe(0);
  expect(result.coverage).toBe("incomplete");
  expect(result.score).toBe(0);
});

test("publishes only the five aggregated inline findings and never a summary per chunk", async () => {
  const h = harness();
  const findings = Array.from({ length: 5 }, (_, i) => ({
    path: "a.ts",
    line: i + 1,
    side: "RIGHT",
    severity: "warning",
    body: "Corregir esta condición porque cambia el comportamiento.",
  }));
  await publishFindings({
    github: h.github,
    args: { ...h.context.repo, pull_number: 1 },
    sha,
    botLogin: "github-actions[bot]",
    report: { sha, findings },
  });
  expect(h.reviews).toHaveLength(1);
  expect(h.reviews[0].comments).toHaveLength(5);
  expect(h.reviews[0].body).toBe("<!-- ceretime-ai-review-inline-only -->");
  expect(h.summaryWrites).toHaveLength(0);
  await expect(
    publishFindings({
      github: h.github,
      args: { ...h.context.repo, pull_number: 1 },
      sha,
      botLogin: "github-actions[bot]",
      report: { sha, findings: [...findings, findings[0]] },
    }),
  ).rejects.toThrow();
});

test("the workflow skips the partial Action for chunked plans and publishes aggregate outputs", () => {
  const steps = workflow.jobs.review.steps;
  expect(steps.find((s: any) => s.id === "ai_review").if).toContain("mode == 'single'");
  expect(steps.find((s: any) => s.id === "confidence").if).toContain("mode == 'chunked'");
  expect(steps.at(-1).env.REVIEW_RISK).toContain("steps.confidence.outputs.risk");
  expect(steps.at(-1).env.REVIEW_COVERAGE).toContain("steps.confidence.outputs.coverage");
  expect(steps[0].with["fetch-depth"]).toBe(0);
});

test("preparation of a 100,000-character PR writes the entire eligible plan without truncation", async () => {
  const h = harness();
  const workspace = mkdtempSync(join(tmpdir(), "ai-plan-test-"));
  mkdirSync(join(workspace, ".git"));
  writeFileSync(
    join(workspace, ".pr-reviewer.yml"),
    readFileSync(join(import.meta.dir, "../.pr-reviewer.yml")),
  );
  const files = Array.from({ length: 12 }, (_, i) => chunkFile(`file-${i}.ts`, 110));
  h.github.request = async () => ({ data: "x".repeat(100000) });
  const paginate = h.github.paginate;
  h.github.paginate = async (method: unknown) =>
    method === h.github.rest.pulls.listFiles ? files : paginate(method);
  try {
    await prepareReview({ ...h, env: { ...h.env, GITHUB_WORKSPACE: workspace } });
    const plan = JSON.parse(readFileSync(join(workspace, ".git/ai-review-plan.json"), "utf8"));
    expect(plan.files).toBe(12);
    expect(plan.issues).toEqual([]);
    expect(h.outputs.mode).toBe("chunked");
    expect(h.outputs.coverage).toBe("complete");
    expect(plan.chunks.flatMap((c: any) => c.parts.flatMap((p: any) => p.anchors))).toHaveLength(
      1320,
    );
    expect(readFileSync(join(workspace, ".git/ai-review-diff.txt"), "utf8")).toBe("");
    expect(h.outputs.chunk_instructions).toContain("Presentación -> Aplicación -> Dominio");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("normalization and publication use a single complete chunk report on the exact head", async () => {
  const h = harness();
  const workspace = mkdtempSync(join(tmpdir(), "ai-chunk-flow-test-"));
  mkdirSync(join(workspace, ".git"));
  const plan = buildPlan([chunkFile("a.ts", 150), chunkFile("b.ts", 150)], {}, sha);
  writeFileSync(join(workspace, ".git/ai-review-plan.json"), JSON.stringify(plan));
  try {
    await normalizeConfidence({
      core: h.core,
      github: h.github,
      context: h.context,
      env: {
        ...h.env,
        REVIEW_MODE: "chunked",
        REVIEW_INSTRUCTIONS: "CERETIME: arquitectura por capas y autorización en backend.",
        GROQ_API_KEY: "test",
        GITHUB_WORKSPACE: workspace,
      },
      sleep: async () => {},
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  score: 5,
                  risk: "low",
                  explanation: "Sin problemas relevantes.",
                  findings: [],
                }),
              },
            },
          ],
        }),
      }),
    });
    expect(h.outputs.coverage).toBe("complete");
    expect(parseSummary(h.outputs.summary)).toMatchObject({ score: 5, sha });
    await publishReview({
      ...h,
      env: {
        ...h.env,
        REVIEW_MODE: "chunked",
        REVIEW_SUMMARY: h.outputs.summary,
        REVIEW_COVERAGE: h.outputs.coverage,
        REVIEW_RISK: h.outputs.risk,
        REVIEW_COMMENTS: h.outputs.comments,
        GITHUB_WORKSPACE: workspace,
      },
    });
    expect(h.summaryWrites).toHaveLength(1);
    expect(h.summaryWrites[0].body).toContain(
      `Bloques procesados: ${plan.chunks.length}/${plan.chunks.length}`,
    );
    expect(h.statuses[0]).toMatchObject({ sha, state: "success", context: "R2D2 Review 5/5" });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("deduplicates the same issue at different valid anchors of one file", () => {
  const plan = { sha, chunks: [{}, {}], files: 1, issues: [] };
  const finding = {
    path: "a.ts",
    line: 1,
    side: "RIGHT",
    severity: "warning",
    body: "Falta validar autorización.",
  };
  const result = aggregate(
    plan,
    [
      { score: 3, risk: "medium", explanation: "Corregir autorización.", findings: [finding] },
      {
        score: 3,
        risk: "medium",
        explanation: "Corregir autorización.",
        findings: [{ ...finding, line: 50 }],
      },
    ],
    2,
  );
  expect(result.findings).toHaveLength(1);
  expect(result.coverage).toBe("complete");
});

test("request-size budgets prevent unexpected context cost without calling the provider", async () => {
  const plan = buildPlan([chunkFile("a.ts", 10)], {}, sha);
  let calls = 0;
  const result = await reviewPlan({
    plan,
    instructions: "x".repeat(18000),
    apiKey: "test",
    fetchImpl: async () => {
      calls++;
      throw new Error("Should not call");
    },
    sleep: async () => {},
  });
  expect(calls).toBe(0);
  expect(result.coverage).toBe("incomplete");
  expect(result.reasons).toContain("Presupuesto de entrada por llamada agotado.");
});

test("more than fifty small eligible files do not create a coverage ceiling", async () => {
  const plan = buildPlan(
    Array.from({ length: 81 }, (_, i) => chunkFile(`file-${i}.ts`, 1)),
    {},
    sha,
  );
  expect(plan.files).toBe(81);
  expect(plan.issues).toEqual([]);
  expect((await runChunks(plan)).result.coverage).toBe("complete");
});

test("keeps a small multi-hunk file together instead of splitting it to fill a previous chunk", () => {
  const file = {
    filename: "multi.ts",
    additions: 40,
    deletions: 0,
    patch: `${chunkFile("a.ts", 20).patch}\n${chunkFile("a.ts", 20).patch.replace("+1,20", "+100,20")}`,
  };
  const plan = buildPlan([chunkFile("previous.ts", 90), file], {}, sha);
  const parts = plan.chunks.flatMap((c: any) => c.parts).filter((p: any) => p.path === "multi.ts");
  expect(plan.issues).toEqual([]);
  expect(parts).toHaveLength(1);
  expect(parts[0].anchors).toHaveLength(40);
});

test("rejects a provider response marked as truncated even if its JSON parses", async () => {
  const plan = buildPlan([chunkFile("a.ts", 10)], {}, sha);
  const { result } = await runChunks(plan, undefined, async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          finish_reason: "length",
          message: {
            content: JSON.stringify({
              score: 5,
              risk: "low",
              explanation: "Correcto.",
              findings: [],
            }),
          },
        },
      ],
    }),
  }));
  expect(result.coverage).toBe("incomplete");
  expect(result.calls).toBe(2);
});

test("recovers a missing patch with local Git when GitHub cannot return the global diff", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "ai-git-patch-test-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim();
  try {
    git("init", "--quiet");
    writeFileSync(join(workspace, "file.ts"), "");
    git("add", "file.ts");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--quiet",
      "-m",
      "base",
    );
    const base = git("rev-parse", "HEAD");
    writeFileSync(join(workspace, "file.ts"), "one\ntwo\nthree\n");
    git("add", "file.ts");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--quiet",
      "-m",
      "change",
    );
    const head = git("rev-parse", "HEAD");
    writeFileSync(
      join(workspace, ".pr-reviewer.yml"),
      readFileSync(join(import.meta.dir, "../.pr-reviewer.yml")),
    );
    const h = harness([head]);
    h.github.rest.pulls.get = async () =>
      ({
        data: {
          head: { sha: head },
          base: { sha: base, ref: "main" },
          state: "open",
          draft: false,
        },
      }) as any;
    h.github.request = async () => {
      throw new Error("Global diff unavailable");
    };
    h.github.paginate = async () => [{ filename: "file.ts", additions: 3, deletions: 0 }];
    await prepareReview({ ...h, env: { ...h.env, REVIEW_SHA: head, GITHUB_WORKSPACE: workspace } });
    const plan = JSON.parse(readFileSync(join(workspace, ".git/ai-review-plan.json"), "utf8"));
    expect(plan.issues).toEqual([]);
    expect(h.outputs.mode).toBe("chunked");
    expect(h.outputs.coverage).toBe("complete");
    expect(plan.chunks[0].parts[0].anchors).toEqual(["RIGHT:1", "RIGHT:2", "RIGHT:3"]);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
