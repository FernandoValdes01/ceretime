import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareReview, publishReview } from "./ai-review-score.cjs";
import { normalizeConfidence } from "./ai-review-confidence.cjs";
import {
  buildPlan,
  validateAssessment,
  aggregate,
  publishFindings,
  reviewPlan,
} from "./ai-review-chunks.cjs";
import {
  enrichFiles,
  reviewThreads,
  mapLine,
  contentKey,
  BOT,
  threadEvidence,
} from "./ai-review-context.cjs";
import { memoryIdentity, createMemory } from "./ai-review-memory.cjs";

const configuration = readFileSync(join(import.meta.dir, "../.pr-reviewer.yml"), "utf8");
const answer = (findings: any[] = [], resolutions: any[] = []) => ({
  ok: true,
  headers: new Headers(),
  json: async () => ({
    usage: { prompt_tokens: 100, completion_tokens: 20 },
    choices: [
      { finish_reason: "stop", message: { content: JSON.stringify({ findings, resolutions }) } },
    ],
  }),
});
function fixture(initial: Record<string, string> = { "file.ts": "export const run = () => 1;\n" }) {
  const directory = mkdtempSync(join(tmpdir(), "r2d2-flow-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  const put = (path: string, text: string) => {
    mkdirSync(join(directory, path, ".."), { recursive: true });
    writeFileSync(join(directory, path), text);
  };
  git("init", "--quiet");
  git("config", "user.email", "qa@example.invalid");
  git("config", "user.name", "QA");
  put(".pr-reviewer.yml", configuration);
  for (const [path, text] of Object.entries(initial)) put(path, text);
  const commit = () => {
    git("add", ".");
    git("commit", "--quiet", "-m", "QA fixture");
    return git("rev-parse", "HEAD");
  };
  const base = commit();
  put("file.ts", "export const run = () => 2;\n");
  let sha = commit();
  const pr: any = {
    number: 1,
    state: "open",
    draft: false,
    title: "QA",
    body: "Verificar el cambio funcional.",
    base: { sha: base, ref: "main" },
    head: { sha, repo: { full_name: "test/repo" } },
  };
  const comments: any[] = [],
    summaries: any[] = [],
    statuses: any[] = [],
    reviews: any[] = [],
    requests: any[] = [];
  const listFiles = () =>
    git("diff", "--name-only", `${base}...${pr.head.sha}`)
      .split("\n")
      .filter(Boolean)
      .map((filename) => {
        const diff = git(
          "diff",
          "--no-ext-diff",
          "--unified=3",
          `${base}...${pr.head.sha}`,
          "--",
          filename,
        );
        const patch = diff.includes("@@ ") ? diff.slice(diff.indexOf("@@ ")) : undefined;
        const [add, del] = git(
          "diff",
          "--numstat",
          `${base}...${pr.head.sha}`,
          "--",
          filename,
        ).split("\t");
        return {
          filename,
          status: "modified",
          patch,
          additions: Number(add) || 0,
          deletions: Number(del) || 0,
        };
      });
  const github: any = {
    rest: {
      pulls: {
        get: async () => ({ data: pr }),
        listFiles: () => {},
        listReviewComments: () => {},
        listReviews: () => {},
        createReview: async (request: any) => {
          reviews.push(request);
          for (const comment of request.comments ?? [])
            comments.push({
              ...comment,
              id: comments.length + 1,
              user: { login: BOT, type: "Bot" },
              original_commit_id: pr.head.sha,
              original_line: comment.line,
            });
        },
        updateReviewComment: async (request: any) => {
          comments.find((c) => c.id === request.comment_id).body = request.body;
        },
        createReplyForReviewComment: async (request: any) => {
          comments.push({
            id: comments.length + 1,
            in_reply_to_id: request.comment_id,
            body: request.body,
            user: { login: BOT, type: "Bot" },
          });
        },
        updateReview: async () => {},
      },
      issues: {
        listComments: () => {},
        createComment: async (request: any) =>
          summaries.push({ ...request, id: summaries.length + 1, user: { login: BOT } }),
        updateComment: async (request: any) => {
          summaries.find((c) => c.id === request.comment_id).body = request.body;
        },
        deleteComment: async () => {},
      },
      repos: {
        getCommit: async () => ({ data: { sha: pr.head.sha, commit: { message: "QA" } } }),
        createCommitStatus: async (request: any) => statuses.push(request),
      },
    },
    paginate: async (method: any) =>
      method === github.rest.pulls.listFiles
        ? listFiles()
        : method === github.rest.pulls.listReviewComments
          ? comments
          : method === github.rest.issues.listComments
            ? summaries
            : [],
  };
  const outputs: Record<string, string> = {};
  const core = {
    info: () => {},
    setOutput: (name: string, value: any) => {
      outputs[name] = String(value);
    },
  };
  const env: any = {
    GITHUB_WORKSPACE: directory,
    REVIEW_SHA: sha,
    REVIEW_BOT_LOGIN: BOT,
    OPENROUTER_API_KEY: "simulation",
    RUN_URL: "https://github.com/test/repo/actions/runs/1",
  };
  const context = {
    repo: { owner: "test", repo: "repo" },
    payload: { pull_request: { number: 1 } },
  };
  const advance = () => {
    sha = commit();
    pr.head.sha = sha;
    env.REVIEW_SHA = sha;
    return sha;
  };
  const prepare = async () => {
    await prepareReview({ github, context, core, env });
    return JSON.parse(readFileSync(join(directory, ".git/ai-review-plan.json"), "utf8"));
  };
  const run = async (model = () => ({ findings: [], resolutions: [] })) => {
    env.REVIEW_INSTRUCTIONS = outputs.instructions;
    await normalizeConfidence({
      github,
      context,
      core,
      env,
      sleep: async () => {},
      fetchImpl: async (_url: string, request: any) => {
        const body = JSON.parse(request.body);
        const data = JSON.parse(body.messages[1].content);
        requests.push(data);
        const result = model(data);
        return answer(result.findings, result.resolutions);
      },
    });
    Object.assign(env, {
      REVIEW_OUTCOME: "success",
      REVIEW_SUMMARY: outputs.summary,
      REVIEW_RISK: outputs.risk,
      REVIEW_COMMENTS: outputs.comments,
      REVIEW_COVERAGE: outputs.coverage,
    });
    return JSON.parse(readFileSync(join(directory, ".git/ai-review-result.json"), "utf8"));
  };
  return {
    directory,
    git,
    put,
    commit,
    base,
    pr,
    comments,
    summaries,
    statuses,
    reviews,
    requests,
    env,
    context,
    core,
    outputs,
    github,
    advance,
    prepare,
    run,
    clean: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("real Git preparation uses main...HEAD and excludes unrelated preexisting code", async () => {
  const f = fixture({
    "file.ts": "export const run = () => 1;\n",
    "legacy.ts": "export const broken = null;\n",
  });
  try {
    const plan = await f.prepare();
    expect(plan.base).toBe(f.base);
    expect(plan.mergeBase).toBe(f.base);
    expect(plan.files).toBe(1);
    expect(JSON.stringify(plan.chunks)).not.toContain("legacy.ts");
    expect(f.statuses[0].state).toBe("failure");
    expect(readFileSync(join(f.directory, ".pr-reviewer.yml"), "utf8")).toBe(configuration);
    const report = await f.run();
    expect(report.coverage).toBe("complete");
    await publishReview(f);
    expect(f.statuses.at(-1).sha).toBe(f.pr.head.sha);
    expect(f.statuses.at(-1).state).toBe("success");
    expect(f.summaries).toHaveLength(1);
    expect(f.reviews).toHaveLength(0);
  } finally {
    f.clean();
  }
});

test("new SHA reuses intact units despite changed chunk packing", async () => {
  const f = fixture();
  try {
    await f.prepare();
    await f.run();
    const firstCalls = f.requests.length;
    f.put("independent.ts", "export const added = 1;\n");
    f.advance();
    await f.prepare();
    const report = await f.run();
    expect(report.reused).toBeGreaterThan(0);
    expect(f.requests.length - firstCalls).toBe(1);
    const sent = f.requests.at(-1).parts;
    expect(sent.some((p: any) => p.path === "independent.ts")).toBe(true);
    expect(sent.some((p: any) => p.path === "file.ts")).toBe(false);
  } finally {
    f.clean();
  }
});

test("same-file helper alias dependencies and environment changes invalidate cached conclusions", async () => {
  const f = fixture({
    "file.ts": "export const run = () => 1;\n",
    "apps/mobile/src/consumer.ts":
      'import { helper } from "@/helper";\nexport const use = () => helper();\n',
    "apps/mobile/src/helper.ts": "export const helper = () => 1;\n",
    "package.json": '{"dependencies":{"lib":"1"}}\n',
  });
  try {
    f.put(
      "apps/mobile/src/consumer.ts",
      'import { helper } from "@/helper";\nexport const use = () => helper() + 1;\n',
    );
    f.advance();
    let plan = await f.prepare();
    const original = plan.chunks
      .flatMap((c: any) => c.parts)
      .find((p: any) => p.path.includes("consumer"));
    await f.run();
    f.put("apps/mobile/src/helper.ts", "export const helper = () => null;\n");
    f.advance();
    plan = await f.prepare();
    const next = plan.chunks
      .flatMap((c: any) => c.parts)
      .find((p: any) => p.path.includes("consumer"));
    expect(contentKey(next)).not.toBe(contentKey(original));
    const firstOwn = plan.chunks
      .flatMap((c: any) => c.parts)
      .find((p: any) => p.path === "file.ts");
    f.put("file.ts", "export const run = () => 2;\nexport const helper = () => false;\n");
    f.advance();
    plan = await f.prepare();
    expect(
      contentKey(plan.chunks.flatMap((c: any) => c.parts).find((p: any) => p.path === "file.ts")),
    ).not.toBe(contentKey(firstOwn));
    const identity = memoryIdentity(plan, "policy");
    f.put("package.json", '{"dependencies":{"lib":"2"}}\n');
    f.advance();
    const envPlan = await f.prepare();
    expect(memoryIdentity(envPlan, "policy")).toBe(identity);
    expect(
      contentKey(
        envPlan.chunks.flatMap((c: any) => c.parts).find((p: any) => p.path === "file.ts"),
      ),
    ).not.toBe(
      contentKey(plan.chunks.flatMap((c: any) => c.parts).find((p: any) => p.path === "file.ts")),
    );
  } finally {
    f.clean();
  }
});

test("human explanation then corrective commit checks only the related finding and preserves its thread", async () => {
  const f = fixture();
  try {
    const originalSha = f.pr.head.sha;
    f.comments.push(
      {
        id: 1,
        path: "file.ts",
        line: 1,
        original_line: 1,
        side: "RIGHT",
        original_commit_id: originalSha,
        diff_hunk: "@@ -1 +1 @@\n-export const run = () => 1;\n+export const run = () => 2;",
        body: "<!-- ceretime-r2d2-chunk -->\nContrato incorrecto.",
        user: { login: BOT, type: "Bot" },
      },
      {
        id: 2,
        in_reply_to_id: 1,
        body: "El contrato requiere el valor 3; lo corregiré.",
        author_association: "MEMBER",
        user: { login: "developer", type: "User" },
      },
    );
    f.put("file.ts", "export const run = () => 3;\n");
    f.advance();
    const plan = await f.prepare();
    expect(plan.chunks.flatMap((c: any) => c.parts.flatMap((p: any) => p.followups))).toHaveLength(
      1,
    );
    const report = await f.run((data: any) => ({
      findings: [],
      resolutions: data.parts.flatMap((p: any) =>
        p.followups.map((t: any) => ({
          id: t.id,
          status: "resolved",
          explanation: "El cambio relacionado devuelve ahora 3 según el contrato.",
        })),
      ),
    }));
    const thread = f.requests[0].parts[0].followups[0];
    expect(thread.finding).toContain("Contrato incorrecto");
    expect(thread.messages[0].body).toContain("requiere el valor 3");
    expect(thread.related_change).toContain("=> 3");
    expect(report.score).toBe(5);
    await publishReview(f);
    expect(f.reviews).toHaveLength(0);
    expect(
      f.comments.some((c) => c.in_reply_to_id === 1 && c.body.includes("Resuelto en código")),
    ).toBe(true);
    expect(f.comments.find((c) => c.id === 2).body).toContain("lo corregiré");
    expect(reviewThreads(f.comments)[0].previous_resolution).toContain("Resuelto en código");
  } finally {
    f.clean();
  }
});

test("a fully reverted hunk receives a targeted followup without reviewing main", async () => {
  const f = fixture();
  try {
    f.comments.push({
      id: 1,
      path: "file.ts",
      line: 1,
      original_line: 1,
      side: "RIGHT",
      original_commit_id: f.pr.head.sha,
      body: "<!-- ceretime-r2d2-chunk -->\nCambio incorrecto.",
      user: { login: BOT, type: "Bot" },
    });
    f.put("file.ts", "export const run = () => 1;\n");
    f.advance();
    const plan = await f.prepare();
    expect(plan.files).toBe(0);
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0].parts[0]).toMatchObject({ followupOnly: true, anchors: [] });
    const report = await f.run((data: any) => ({
      findings: [],
      resolutions: [
        {
          id: data.parts[0].followups[0].id,
          status: "resolved",
          explanation: "El cambio original fue revertido.",
        },
      ],
    }));
    expect(report.coverage).toBe("complete");
    expect(report.score).toBe(5);
  } finally {
    f.clean();
  }
});

test("multiple long review threads preserve patch coverage and allow a targeted finding to remain", async () => {
  const f = fixture();
  try {
    for (let id = 1; id <= 3; id++)
      f.comments.push({
        id,
        path: "file.ts",
        line: 1,
        original_line: 1,
        side: "RIGHT",
        original_commit_id: f.pr.head.sha,
        diff_hunk:
          "@@ -1 +1 @@\n-export const run = () => 1;\n+export const run = () => 2;\n" +
          "context ".repeat(400),
        body: "<!-- ceretime-r2d2-chunk -->\n" + "finding ".repeat(260),
        user: { login: BOT, type: "Bot" },
      });
    const plan = await f.prepare();
    expect(plan.issues).toEqual([]);
    const parts = plan.chunks.flatMap((c: any) => c.parts);
    expect(
      parts
        .flatMap((p: any) => p.followups)
        .map((t: any) => t.id)
        .sort(),
    ).toEqual(["1", "2", "3"]);
    expect(parts.some((p: any) => p.anchors.includes("RIGHT:1") && !p.followupOnly)).toBe(true);
    const report = await f.run((data: any) => ({
      findings: data.parts.some((p: any) => p.followups.some((t: any) => t.id === "2"))
        ? [
            {
              path: "file.ts",
              line: 1,
              side: "RIGHT",
              severity: "important",
              issue_key: "contract-value",
              threadId: "2",
              cause: "El cambio devuelve 2 en lugar del valor esperado.",
              impact: "El consumidor recibe otro valor.",
              fix: "Restaurar el contrato.",
            },
          ]
        : [],
      resolutions: data.parts.flatMap((p: any) =>
        p.followups.map((t: any) => ({
          id: t.id,
          status: t.id === "2" ? "maintain" : "not_applicable",
          explanation: "Comprobado con el contrato actual.",
        })),
      ),
    }));
    expect(report.coverage).toBe("complete");
    expect(report.findings[0].threadId).toBe("2");
    expect(f.requests.every((r: any) => r.parts.length > 0)).toBe(true);
  } finally {
    f.clean();
  }
});

test("followups use spare capacity without mixing overlapping findings from the same file", async () => {
  const f = fixture({
    "file.ts": "export const run = () => 1;\n",
    "other.ts": "export const other = 1;\n",
  });
  try {
    f.put("other.ts", `export const other = "${"x".repeat(6000)}";\n`);
    f.put(
      ".pr-reviewer.yml",
      configuration
        .replace("maxChunks: 32", "maxChunks: 2")
        .replace("chunkChars: 24000", "chunkChars: 12000"),
    );
    f.advance();
    for (let id = 1; id <= 2; id++)
      f.comments.push({
        id,
        path: "file.ts",
        line: 1,
        original_line: 1,
        side: "RIGHT",
        original_commit_id: f.pr.head.sha,
        diff_hunk:
          "@@ -1 +1 @@\n-export const run = () => 1;\n+export const run = () => 2;\n" +
          (id === 1 ? "context ".repeat(400) : ""),
        body: "<!-- ceretime-r2d2-chunk -->\n" + (id === 1 ? "finding ".repeat(260) : "Contract"),
        user: { login: BOT, type: "Bot" },
      });
    const plan = await f.prepare();
    expect(plan.issues).toEqual([]);
    expect(plan.chunks).toHaveLength(2);
    const followup = plan.chunks.find((c: any) => c.parts.some((p: any) => p.followupOnly));
    expect(followup.parts.some((p: any) => p.path === "other.ts")).toBe(true);
    expect(followup.parts.filter((p: any) => p.path === "file.ts")).toHaveLength(1);
    const report = await f.run((data: any) => ({
      findings: [],
      resolutions: data.parts.flatMap((p: any) =>
        p.followups.map((t: any) => ({
          id: t.id,
          status: "not_applicable",
          explanation: "Comprobado con el contrato actual.",
        })),
      ),
    }));
    expect(report.coverage).toBe("complete");
    expect(report.calls).toBe(2);
    expect(report.resolutions.map((r: any) => r.id).sort()).toEqual(["1", "2"]);
    expect(
      f.requests.every((r: any) => JSON.stringify(r.parts).length <= plan.limits.chunkChars),
    ).toBe(true);
  } finally {
    f.clean();
  }
});

test("formal evidence follows renames without claiming the code disappeared", () => {
  const f = fixture();
  try {
    const old = f.pr.head.sha;
    f.git("mv", "file.ts", "renamed.ts");
    f.advance();
    const file = {
      filename: "renamed.ts",
      previous_filename: "file.ts",
      status: "renamed",
      additions: 0,
      deletions: 0,
    };
    const { followups } = enrichFiles([file], {
      directory: f.directory,
      base: f.base,
      sha: f.pr.head.sha,
      threads: [{ id: "1", path: "file.ts", line: 1, side: "RIGHT", sha: old, messages: [] }],
    });
    expect(followups[0]).toMatchObject({
      currentPath: "renamed.ts",
      currentState: "present",
      currentLine: 1,
      evidence_incomplete: false,
    });
    expect(followups[0].current_excerpt).toContain("=> 2");
  } finally {
    f.clean();
  }
});

test("missing old evidence cannot resolve a thread and formal followups attach once", () => {
  const thread = { id: "1", currentLine: null, evidence_incomplete: true };
  const file = {
    filename: "file.ts",
    additions: 2,
    deletions: 0,
    patch: "@@ -0,0 +1 @@\n+first();\n@@ -10,0 +12 @@\n+second();",
    followups: [thread],
  };
  const plan = buildPlan([file], {}, "a".repeat(40));
  expect(plan.chunks.flatMap((c: any) => c.parts.flatMap((p: any) => p.followups))).toHaveLength(1);
  const chunk = plan.chunks.find((c: any) => c.parts.some((p: any) => p.followups.length));
  expect(() =>
    validateAssessment(
      { findings: [], resolutions: [{ id: "1", status: "resolved", explanation: "No proof." }] },
      chunk,
    ),
  ).toThrow("evidencia incompleta");
  const report = aggregate(
    plan,
    [
      validateAssessment(
        {
          findings: [],
          resolutions: [
            { id: "1", status: "needs_context", explanation: "Falta la versión original." },
          ],
        },
        chunk,
      ),
    ],
    1,
  );
  expect(report.coverage).toBe("incomplete");
});

test("historical changes above 3200 characters retain complete evidence within the budget", () => {
  const f = fixture({
    "file.ts": Array.from({ length: 120 }, (_, i) => `export const value${i} = ${i};`).join("\n"),
  });
  try {
    const file: any = { filename: "file.ts", status: "modified" };
    const { followups } = enrichFiles([file], {
      directory: f.directory,
      base: f.base,
      sha: f.pr.head.sha,
      threads: [{ id: "1", path: "file.ts", line: 30, side: "RIGHT", sha: f.base, messages: [] }],
    });
    const delta = f.git("diff", "--unified=3", f.base, f.pr.head.sha, "--", "file.ts");
    expect(delta.length).toBeGreaterThan(3200);
    expect(followups[0].related_change.trim()).toBe(delta);
    expect(followups[0].evidence_incomplete).toBe(false);
    expect(followups[0].currentLine).toBeNull();
  } finally {
    f.clean();
  }
});

test("historical changes beyond the evidence budget remain explicitly incomplete", () => {
  const f = fixture({
    "file.ts": Array.from({ length: 600 }, (_, i) => `export const value${i} = ${i};`).join("\n"),
  });
  try {
    const { followups } = enrichFiles([], {
      directory: f.directory,
      base: f.base,
      sha: f.pr.head.sha,
      threads: [{ id: "1", path: "file.ts", line: 30, side: "RIGHT", sha: f.base, messages: [] }],
    });
    expect(followups[0].related_change).toHaveLength(12000);
    expect(followups[0].evidence_incomplete).toBe(true);
  } finally {
    f.clean();
  }
});

test("review context preserves numeric return contracts and workflow consumers", () => {
  const f = fixture({
    "file.ts":
      'const { MODEL } = require("./provider.cjs");\nfunction formatReview(result) { return result.review.findings > 0; }\nmodule.exports = { formatReview };\n',
    "provider.cjs": 'module.exports = { MODEL: "simulation" };\n',
    "score.cjs":
      'const { formatReview } = require("./file");\nfunction parseSummary(summary) {\n  const match = summary.match(/([0-5])/);\n  if (!match) return null;\n  const first = match[1];\n  const second = match[2];\n  const third = match[3];\n  const fourth = match[4];\n  const fifth = match[5];\n  return {\n    findings: Number(match[1]),\n  };\n}\nmodule.exports = { parseSummary, formatReview };\n',
    "a-transitive.test.ts":
      'const { parseSummary } = require("./score.cjs");\nexport const testContract = () => parseSummary("2");\n',
    ".github/workflows/review.yml":
      'jobs:\n  review:\n    steps:\n      - uses: actions/github-script@v7\n        with:\n          script: |\n            const { formatReview } = require("./file.ts");\n            formatReview(result);\n',
  });
  try {
    const file: any = { filename: "file.ts", status: "modified" };
    enrichFiles([file], { directory: f.directory, base: f.base, sha: f.pr.head.sha });
    expect(file.context.find((c: any) => c.path === "score.cjs")?.head).toContain(
      "findings: Number(match[1])",
    );
    expect(
      file.context.find((c: any) => c.path === ".github/workflows/review.yml")?.head,
    ).toContain('require("./file.ts")');
  } finally {
    f.clean();
  }
});

test("removed modules retain the consumers that depend on their original contract", () => {
  const f = fixture({
    "file.ts": "export const run = () => 1;\n",
    "contract.ts": "export const contract = () => 1;\n",
    "consumer.ts":
      'import { contract } from "./contract";\nexport const consume = () => contract();\n',
  });
  try {
    rmSync(join(f.directory, "contract.ts"));
    f.advance();
    const file: any = { filename: "contract.ts", status: "removed" };
    enrichFiles([file], { directory: f.directory, base: f.base, sha: f.pr.head.sha });
    expect(file.context.find((c: any) => c.path === "consumer.ts")?.head).toContain("contract()");
    expect(file.context.find((c: any) => c.path === "contract.ts")).toMatchObject({
      head: "",
      base: "export const contract = () => 1;\n",
    });
  } finally {
    f.clean();
  }
});

test("configuration mentioning Convex does not load unrelated backend context", () => {
  const f = fixture({
    "file.ts": "export const run = () => 1;\n",
    ".cspell.json": '{"ignorePaths":["convex/_generated/**"],"words":[]}\n',
    "convex/backend.ts": "export const backend = () => 1;\n",
  });
  try {
    const file: any = { filename: ".cspell.json", status: "modified" };
    enrichFiles([file], { directory: f.directory, base: f.base, sha: f.pr.head.sha });
    expect(file.context.map((c: any) => c.path)).toEqual([".cspell.json"]);
    const previousKey = file.contextKey;
    f.put("convex/backend.ts", "export const backend = () => 2;\n");
    f.advance();
    enrichFiles([file], { directory: f.directory, base: f.base, sha: f.pr.head.sha });
    expect(file.contextKey).toBe(previousKey);
  } finally {
    f.clean();
  }
});

test("an invalid followup retry receives its validation reason and keeps incomplete evidence explicit", async () => {
  const plan = buildPlan(
    [
      {
        filename: "file.ts",
        additions: 1,
        deletions: 0,
        patch: "@@ -0,0 +1 @@\n+run();",
        followups: [{ id: "1", currentLine: null, evidence_incomplete: true }],
      },
    ],
    {},
    "a".repeat(40),
  );
  const requests: any[] = [],
    progress: string[] = [];
  const report = await reviewPlan({
    plan,
    instructions: "Revisar el cambio.",
    apiKey: "simulation",
    sleep: async () => {},
    onProgress: (value: string) => progress.push(value),
    fetchImpl: async (_url: string, request: any) => {
      requests.push(JSON.parse(request.body));
      return answer(
        [],
        [
          {
            id: "1",
            status: requests.length === 1 ? "resolved" : "needs_context",
            explanation: "Falta la versión original para comprobar la corrección.",
          },
        ],
      );
    },
  });
  expect(report.calls).toBe(2);
  expect(report.processed).toBe(1);
  expect(report.coverage).toBe("incomplete");
  expect(report.resolutions[0].status).toBe("needs_context");
  expect(progress.join("\n")).toContain("No se puede resolver un hilo con evidencia incompleta.");
  expect(requests[1].messages[0].content).toContain("La respuesta anterior fue rechazada");
});

test("line mapping handles insertions deletions and LEFT evidence", async () => {
  expect(mapLine("@@ -0,0 +1 @@\n+new();", 1)).toBe(2);
  expect(mapLine("@@ -2 +1,0 @@\n-deleted();", 2)).toBeNull();
  expect(mapLine("@@ -2 +2 @@\n-old();\n+new();", 3)).toBe(3);
  const calls: any[] = [];
  const head = "h".repeat(40),
    base = "b".repeat(40),
    old = "a".repeat(40);
  const github = {
    request: async (_route: string, args: any) => {
      calls.push(args);
      return {
        data: args.basehead.startsWith("main")
          ? { merge_base_commit: { sha: base } }
          : {
              merge_base_commit: { sha: base },
              files: [{ filename: "file.ts", patch: "@@ -0,0 +1 @@\n+inserted();" }],
            },
      };
    },
    rest: {
      repos: {
        getContent: async (args: any) => ({
          data: {
            type: "file",
            encoding: "base64",
            size: 30,
            content: Buffer.from(
              args.ref === base ? "original();" : "inserted();\noriginal();",
            ).toString("base64"),
          },
        }),
      },
    },
  };
  const evidence = await threadEvidence({
    github,
    repo: { owner: "test", repo: "repo" },
    root: { path: "file.ts", original_line: 1, side: "LEFT", original_commit_id: old },
    head,
  });
  expect(evidence.currentLine).toBe(2);
  expect(evidence.original_excerpt).toContain("1: original()");
  expect(evidence.current_excerpt).toContain("2: original()");
  expect(calls[0].basehead).toBe(`main...${old}`);
});

test("publication never certifies newer heads changed main or edited human context", async () => {
  for (const change of ["head", "base", "discussion"]) {
    const f = fixture();
    try {
      await f.prepare();
      await f.run();
      if (change === "head") {
        f.put("new.ts", "export const x = 1;");
        f.advance();
        f.env.REVIEW_SHA = JSON.parse(
          readFileSync(join(f.directory, ".git/ai-review-result.json"), "utf8"),
        ).sha;
      }
      if (change === "base") f.pr.base.sha = "b".repeat(40);
      if (change === "discussion")
        f.comments.push({
          id: 1,
          path: "file.ts",
          line: 1,
          body: "<!-- ceretime-r2d2-chunk -->\nNew context.",
          user: { login: BOT, type: "Bot" },
        });
      await publishReview(f);
      expect(f.statuses.at(-1).state).toBe("failure");
      expect(f.summaries).toHaveLength(0);
      expect(f.reviews).toHaveLength(0);
    } finally {
      f.clean();
    }
  }
});

test("formal decisions record a recurring finding and retries keep the latest reply unique", async () => {
  const f = fixture();
  try {
    f.comments.push({
      id: 1,
      path: "file.ts",
      line: 1,
      side: "RIGHT",
      body: "<!-- ceretime-r2d2-chunk -->\nContrato incorrecto.",
      user: { login: BOT, type: "Bot" },
    });
    const publish = async (sha: string, status: string, explanation: string) =>
      publishFindings({
        github: f.github,
        args: { owner: "test", repo: "repo", pull_number: 1 },
        botLogin: BOT,
        sha,
        report: { sha, findings: [], resolutions: [{ id: "1", status, explanation }] },
      });
    await publish("a".repeat(40), "maintain", "El contrato sigue incorrecto.");
    await publish("b".repeat(40), "resolved", "El contrato está corregido.");
    await publish("c".repeat(40), "maintain", "El contrato sigue incorrecto.");
    expect(f.comments).toHaveLength(4);
    expect(reviewThreads(f.comments)[0].previous_resolution).toContain("Hallazgo pendiente");
    await publish("c".repeat(40), "maintain", "El contrato sigue incorrecto.");
    await publish("d".repeat(40), "maintain", "El contrato sigue incorrecto.");
    expect(f.comments).toHaveLength(4);
  } finally {
    f.clean();
  }
});

test("conversation marks truncated related changes as incomplete evidence", async () => {
  const old = "a".repeat(40);
  const evidence = await threadEvidence({
    github: {
      request: async () => ({
        data: {
          merge_base_commit: { sha: old },
          files: [{ filename: "file.ts", patch: `@@ -2 +2 @@\n-old();\n+${"x".repeat(16000)}` }],
        },
      }),
      rest: {
        repos: {
          getContent: async () => ({
            data: {
              type: "file",
              encoding: "base64",
              size: 20,
              content: Buffer.from("finding();\nother();").toString("base64"),
            },
          }),
        },
      },
    },
    repo: { owner: "test", repo: "repo" },
    root: { path: "file.ts", original_line: 1, side: "RIGHT", original_commit_id: old },
    head: "b".repeat(40),
  });
  expect(evidence.currentLine).toBe(1);
  expect(evidence.related_change).toHaveLength(12000);
  expect(evidence.evidence_incomplete).toBe(true);
});

test("cached findings remap coordinates and content/context changes miss safely", () => {
  const f = fixture();
  try {
    const original = buildPlan(
      [{ filename: "file.ts", additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+unsafe();" }],
      {},
      "a".repeat(40),
    );
    const part = original.chunks[0].parts[0];
    const memory = createMemory({
      directory: join(f.directory, ".git/cache"),
      identity: memoryIdentity(original, "policy"),
      apiKey: "simulation",
    });
    memory.set(part, {
      findings: [
        {
          path: "file.ts",
          line: 1,
          side: "RIGHT",
          severity: "important",
          issue_key: "unsafe-call",
          cause: "La llamada añadida omite validar.",
          impact: "Permite acceso sin control.",
          fix: "Comprobar identidad.",
        },
      ],
      resolutions: [],
    });
    const shifted = {
      ...part,
      patch: part.patch.replace("+1", "+20").replace("RIGHT:1", "RIGHT:20"),
      anchors: ["RIGHT:20"],
    };
    expect(memory.get(shifted).findings[0].line).toBe(20);
    expect(memory.get({ ...part, contextKey: "changed" })).toBeNull();
    expect(memory.get({ ...part, patch: part.patch.replace("unsafe", "safe") })).toBeNull();
  } finally {
    f.clean();
  }
});
