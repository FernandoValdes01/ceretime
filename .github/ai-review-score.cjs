const fs = require("node:fs");
const { MODEL, formatReview, formatInline } = require("./ai-review-presentation.cjs");

const STATUS_CONTEXT = "AI Review 5/5";
const MAX_DIFF_SIZE = 10000;
const MAX_FILES = 50;

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
      "AI Review 0/5: el diff excede la cobertura del reviewer.",
      review,
    );
  }
  if (review.score === 5 && (review.findings !== 0 || review.risk !== "low")) {
    return failure("invalid", "AI Review 0/5: score incompatible con riesgo o hallazgos.", review);
  }
  return {
    state: review.score === 5 ? "success" : "failure",
    reason: "reviewed",
    score: review.score,
    review,
    description:
      review.score === 5
        ? "AI Review 5/5 para el commit actual."
        : `AI Review ${review.score}/5: requiere revisión humana.`,
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
  const { data: diff } = await github.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
    ...args,
    headers: { accept: "application/vnd.github.v3.diff" },
  });
  const files = await github.paginate(github.rest.pulls.listFiles, { ...args, per_page: 100 });
  fs.writeFileSync(
    `${env.GITHUB_WORKSPACE}/.git/ai-review-diff.txt`,
    typeof diff === "string" ? diff.slice(0, MAX_DIFF_SIZE) : "",
  );
  const coverage =
    typeof diff === "string" && diff.length <= MAX_DIFF_SIZE && files.length <= MAX_FILES
      ? "complete"
      : "incomplete";
  const configPath = `${env.GITHUB_WORKSPACE}/.pr-reviewer.yml`;
  const config = fs
    .readFileSync(configPath, "utf8")
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
  core.setOutput("current", "true");
}

async function publishReview({ github, context, core, env = process.env }) {
  const args = { ...context.repo, pull_number: context.payload.pull_request.number };
  const { data: pr } = await github.rest.pulls.get(args);
  if (pr.draft || pr.state !== "open" || pr.base.ref !== "main") return;
  const result = evaluateReview({
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
  const body = formatReview(result, env.REVIEW_SHA, env.RUN_URL, env.REVIEW_COST, {
    risk: env.REVIEW_RISK,
    commentsCount: env.REVIEW_COMMENTS,
    commitTitle: commit.commit.message,
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
  MAX_DIFF_SIZE,
  MAX_FILES,
  parseSummary,
  evaluateReview,
  formatReview,
  prepareReview,
  publishReview,
  archiveReviewSummaries,
};
