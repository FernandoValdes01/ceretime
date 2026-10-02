const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const {
  buildPlan,
  publishFindings,
  patchRecords,
  matchesIgnore,
} = require("./ai-review-chunks.cjs");
const { MODEL, formatReview, formatInline } = require("./ai-review-presentation.cjs");

const STATUS_CONTEXT = "R2D2 Review 5/5";
const SINGLE_CALL_DIFF_SIZE = 10000; // Single-call Action target, never a PR coverage limit.
const SINGLE_CALL_FILES = 50;

function parseSummary(summary) {
  if (typeof summary !== "string") return null;
  const match = summary.match(
    /^Confidence Score: ([0-5])\/5; Risk: (low|medium|high); Reviewed commit: ([a-f0-9]{40}); Hallazgos: ([0-5]); Resumen: ([^\r\n;]+)$/,
  );
  if (!match || /Confidence Score:|Reviewed commit:/.test(match[5])) return null;
  return {
    score: Number(match[1]),
    risk: match[2],
    sha: match[3],
    findings: Number(match[4]),
    summary: match[5].trim(),
  };
}

function evaluateReview({
  outcome,
  summary,
  risk,
  commentsCount,
  expectedSha,
  currentSha,
  coverage,
}) {
  const failure = (reason, description, review = null) => ({
    state: "failure",
    reason,
    description,
    score: 0,
    review,
  });
  if (currentSha !== expectedSha) {
    return failure("stale", "La revisión de IA no corresponde al commit actual.");
  }
  if (outcome !== "success") {
    return failure("failed", "La revisión automática no pudo completarse.");
  }
  if (!summary) return failure("missing", "Falta la revisión de IA para este commit.");
  const review = parseSummary(summary);
  if (
    !review ||
    !review.summary ||
    review.risk !== risk ||
    String(review.findings) !== commentsCount
  ) {
    return failure("invalid", "La revisión automática no produjo un resultado válido.");
  }
  if (review.sha !== expectedSha) {
    return failure("stale", "La revisión de IA no corresponde al commit actual.");
  }
  if (coverage !== "complete") {
    return failure(
      "incomplete",
      "R2D2 Review 0/5: no se completaron todos los bloques requeridos.",
      review,
    );
  }
  if (review.score === 5 && (review.findings !== 0 || review.risk !== "low")) {
    return failure(
      "invalid",
      "R2D2 Review 0/5: score incompatible con riesgo o hallazgos.",
      review,
    );
  }
  return {
    state: review.score === 5 ? "success" : "failure",
    reason: "reviewed",
    score: review.score,
    review,
    description:
      review.score === 5
        ? "R2D2 Review 5/5 para el commit actual."
        : `R2D2 Review ${review.score}/5: requiere revisión humana.`,
  };
}

async function prepareReview({ github, context, core, env = process.env }) {
  const args = { ...context.repo, pull_number: context.payload.pull_request.number };
  const { data: pr } = await github.rest.pulls.get(args);
  if (pr.head.sha !== env.REVIEW_SHA || pr.draft || pr.state !== "open" || pr.base.ref !== "main") {
    core.setOutput("current", "false");
    return;
  }
  await github.rest.repos.createCommitStatus({
    ...context.repo,
    sha: env.REVIEW_SHA,
    context: STATUS_CONTEXT,
    state: "failure",
    description: "Falta la revisión de IA para este commit.",
    target_url: env.RUN_URL,
  });
  let diff;
  try {
    ({ data: diff } = await github.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      ...args,
      headers: { accept: "application/vnd.github.v3.diff" },
    }));
  } catch {
    /* The global diff is optional; eligible file patches are the coverage source. */
  }
  const files = await github.paginate(github.rest.pulls.listFiles, { ...args, per_page: 100 });
  const configPath = `${env.GITHUB_WORKSPACE}/.pr-reviewer.yml`;
  const originalConfig = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(
    execFileSync(
      "bun",
      ["-e", "console.log(JSON.stringify(Bun.YAML.parse(await Bun.stdin.text())))"],
      { input: originalConfig, encoding: "utf8" },
    ),
  );
  // GitHub can omit or truncate patches. Reconstruct those from the exact base/head locally.
  for (const file of files) {
    if (matchesIgnore(file.filename, parsed.ignore_paths ?? [])) continue;
    let needsPatch = !file.patch;
    if (file.patch) {
      try {
        const records = patchRecords(file.patch);
        needsPatch =
          records.filter((r) => r.side === "RIGHT").length !== file.additions ||
          records.filter((r) => r.side === "LEFT").length !== file.deletions;
      } catch {
        needsPatch = true;
      }
    }
    if (needsPatch && (file.additions || file.deletions)) {
      try {
        const raw = execFileSync(
          "git",
          [
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--unified=3",
            `${pr.base.sha}...${env.REVIEW_SHA}`,
            "--",
            file.filename,
          ],
          { cwd: env.GITHUB_WORKSPACE, encoding: "utf8", maxBuffer: 5 * 1024 * 1024 },
        );
        const start = raw.indexOf("@@ ");
        if (start >= 0) file.patch = raw.slice(start).replace(/\n$/, "");
      } catch {
        /* Unavailable patches remain explicit coverage issues. */
      }
    }
  }
  const plan = buildPlan(files, parsed, env.REVIEW_SHA);
  if (pr.changed_files != null && pr.changed_files !== files.length)
    plan.issues.push("GitHub no devolvió todos los archivos modificados.");
  const mode =
    typeof diff === "string" &&
    diff.length <= Math.min(SINGLE_CALL_DIFF_SIZE, parsed.max_diff_size ?? SINGLE_CALL_DIFF_SIZE) &&
    plan.chunks.length === 1 &&
    plan.files <= Math.min(SINGLE_CALL_FILES, parsed.max_files ?? SINGLE_CALL_FILES) &&
    !files.some((f) => matchesIgnore(f.filename, parsed.ignore_paths ?? [])) &&
    !plan.issues.length
      ? "single"
      : "chunked";
  // Complete here means an eligible plan, not a completed review; the final coverage comes from execution.
  const coverage = plan.issues.length ? "incomplete" : "complete";
  fs.writeFileSync(`${env.GITHUB_WORKSPACE}/.git/ai-review-plan.json`, JSON.stringify(plan), {
    mode: 0o600,
  });
  fs.writeFileSync(
    `${env.GITHUB_WORKSPACE}/.git/ai-review-diff.txt`,
    mode === "single" ? diff : "",
    { mode: 0o600 },
  );
  const config = originalConfig
    .replaceAll("__REVIEWED_SHA__", env.REVIEW_SHA)
    .replaceAll("__COVERAGE__", coverage);
  // The final config field is a folded YAML scalar; also pass it through the Action input.
  const instructions = config
    .split("custom_instructions: >-\n")[1]
    ?.split("\n")
    .map((line) => line.trim())
    .join(" ")
    .trim();
  if (!instructions) throw new Error("Faltan las instrucciones del reviewer.");
  fs.writeFileSync(configPath, config);
  core.setOutput("instructions", instructions);
  core.setOutput("coverage", coverage);
  core.setOutput("mode", mode);
  const chunkInstructions = instructions.slice(
    Math.max(0, instructions.indexOf("Revisa exclusivamente")),
    instructions.indexOf("Mantén el JSON interno") >= 0
      ? instructions.indexOf("Mantén el JSON interno")
      : undefined,
  );
  core.setOutput("chunk_instructions", chunkInstructions || instructions);
  core.setOutput("diff_size", typeof diff === "string" ? String(diff.length) : String(plan.chars));
  core.setOutput("files_count", String(files.length));
  core.setOutput("current", "true");
}

async function publishReview({ github, context, core, env = process.env }) {
  const args = { ...context.repo, pull_number: context.payload.pull_request.number };
  const { data: pr } = await github.rest.pulls.get(args);
  if (pr.draft || pr.state !== "open" || pr.base.ref !== "main") return;
  let result = evaluateReview({
    outcome: env.REVIEW_OUTCOME,
    summary: env.REVIEW_SUMMARY,
    risk: env.REVIEW_RISK,
    commentsCount: env.REVIEW_COMMENTS,
    expectedSha: env.REVIEW_SHA,
    currentSha: pr.head.sha,
    coverage: env.REVIEW_COVERAGE,
  });
  // An old run can write only to its event SHA, even if the head changes after the API read.
  const status = {
    ...context.repo,
    sha: env.REVIEW_SHA,
    context: STATUS_CONTEXT,
    state: result.state,
    description: result.description,
    target_url: env.RUN_URL,
  };
  if (pr.head.sha !== env.REVIEW_SHA) {
    await github.rest.repos.createCommitStatus(status);
    return;
  }
  const { data: commit } = await github.rest.repos.getCommit({
    ...context.repo,
    ref: env.REVIEW_SHA,
  });
  if (commit.sha !== env.REVIEW_SHA)
    throw new Error("El commit consultado no coincide con el SHA revisado.");
  let report;
  if (env.REVIEW_MODE === "chunked" && env.REVIEW_OUTCOME === "success") {
    report = JSON.parse(
      fs.readFileSync(`${env.GITHUB_WORKSPACE}/.git/ai-review-result.json`, "utf8"),
    );
    const { data: beforeInline } = await github.rest.pulls.get(args);
    if (
      beforeInline.head.sha !== env.REVIEW_SHA ||
      beforeInline.draft ||
      beforeInline.state !== "open"
    )
      return;
    try {
      await publishFindings({
        github,
        args,
        sha: env.REVIEW_SHA,
        botLogin: env.REVIEW_BOT_LOGIN || "github-actions[bot]",
        report,
      });
    } catch {
      result = evaluateReview({
        outcome: "failure",
        expectedSha: env.REVIEW_SHA,
        currentSha: env.REVIEW_SHA,
      });
      status.state = result.state;
      status.description = result.description;
    }
  }
  const body = formatReview(result, env.REVIEW_SHA, env.RUN_URL, env.REVIEW_COST, {
    risk: env.REVIEW_RISK,
    commentsCount: env.REVIEW_COMMENTS,
    commitTitle: commit.commit.message,
    actionSummary: env.ACTION_SUMMARY,
    diffSize: env.REVIEW_DIFF_SIZE,
    filesCount: env.REVIEW_FILES_COUNT,
    report,
  });
  const botLogin = env.REVIEW_BOT_LOGIN || "github-actions[bot]";
  const issueArgs = { ...context.repo, issue_number: args.pull_number };
  const summaries = await github.paginate(github.rest.issues.listComments, {
    ...issueArgs,
    per_page: 100,
  });
  const owned = summaries.filter(
    (comment) =>
      comment.user?.login === botLogin &&
      comment.body?.startsWith("<!-- ceretime-ai-review-summary -->"),
  );
  const { data: beforePublication } = await github.rest.pulls.get(args);
  if (
    beforePublication.head.sha !== env.REVIEW_SHA ||
    beforePublication.draft ||
    beforePublication.state !== "open"
  )
    return;
  if (owned.length) {
    await github.rest.issues.updateComment({ ...context.repo, comment_id: owned[0].id, body });
  } else {
    await github.rest.issues.createComment({ ...issueArgs, body });
  }
  // Retain only the first summary, even if a previous attempt left duplicates.
  for (const duplicate of owned.slice(1)) {
    await github.rest.issues.deleteComment({ ...context.repo, comment_id: duplicate.id });
  }
  const reviews = await github.paginate(github.rest.pulls.listReviews, { ...args, per_page: 100 });
  await tidyComments({ github, args, sha: env.REVIEW_SHA, botLogin, reviews });
  await archiveReviewSummaries({ github, context, botLogin, reviews });
  const { data: latest } = await github.rest.pulls.get(args);
  if (latest.head.sha !== env.REVIEW_SHA || latest.draft || latest.state !== "open") return;
  await github.rest.repos.createCommitStatus(status);
  core.info(result.description);
}

async function tidyComments({ github, args, sha, botLogin, reviews }) {
  const ownReviews = new Set(
    reviews
      .filter(
        (review) =>
          review.user?.login === botLogin &&
          (review.body?.startsWith("<!-- ceretime-ai-review -->") ||
            (review.body?.startsWith("## AI Code Review") &&
              review.body.includes("https://github.com/mara-werils/ai-code-reviewer"))),
      )
      .map((review) => review.id),
  );
  const comments = await github.paginate(github.rest.pulls.listReviewComments, {
    ...args,
    per_page: 100,
  });
  for (const comment of comments) {
    if (
      comment.user?.login !== botLogin ||
      (comment.original_commit_id !== sha && !ownReviews.has(comment.pull_request_review_id))
    )
      continue;
    const body = formatInline(comment.body);
    if (body !== comment.body) {
      await github.rest.pulls.updateReviewComment({
        owner: args.owner,
        repo: args.repo,
        comment_id: comment.id,
        body,
      });
    }
  }
  const issueArgs = {
    owner: args.owner,
    repo: args.repo,
    issue_number: args.pull_number,
    per_page: 100,
  };
  const summaries = await github.paginate(github.rest.issues.listComments, issueArgs);
  for (const comment of summaries) {
    // Remove only this reviewer's redundant advertising summaries; preserve other bots and humans.
    if (
      comment.user?.login === botLogin &&
      comment.body?.startsWith("## AI Code Review") &&
      comment.body.includes("https://github.com/mara-werils/ai-code-reviewer")
    ) {
      await github.rest.issues.deleteComment({
        owner: args.owner,
        repo: args.repo,
        comment_id: comment.id,
      });
    }
  }
}

async function archiveReviewSummaries({ github, context, botLogin, reviews }) {
  const args = { ...context.repo, pull_number: context.payload.pull_request.number };
  reviews ??= await github.paginate(github.rest.pulls.listReviews, { ...args, per_page: 100 });
  for (const review of reviews) {
    if (review.user?.login !== botLogin) continue;
    if (
      review.body?.startsWith("<!-- ceretime-ai-review -->") ||
      (review.body?.startsWith("## AI Code Review") &&
        review.body.includes("https://github.com/mara-werils/ai-code-reviewer"))
    ) {
      // Keep the review, its commit association and inline findings, without a second visible summary.
      await github.rest.pulls.updateReview({
        ...args,
        review_id: review.id,
        body: "<!-- ceretime-ai-review-inline-only -->",
      });
    }
  }
}

module.exports = {
  STATUS_CONTEXT,
  MODEL,
  SINGLE_CALL_DIFF_SIZE,
  SINGLE_CALL_FILES,
  parseSummary,
  evaluateReview,
  formatReview,
  prepareReview,
  publishReview,
  archiveReviewSummaries,
};
