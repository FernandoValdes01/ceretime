const fs = require("node:fs");

const STATUS_CONTEXT = "AI Review 5/5";
const MODEL = "openai/gpt-oss-120b";
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

function formatReview(result, sha, runUrl, cost) {
  const validCost = /^\d+(?:\.\d+)?$/.test(cost ?? "") ? cost : "no disponible";
  return [
    "<!-- ceretime-ai-review -->",
    "## AI Code Review",
    "",
    `Confidence Score: ${result.score}/5`,
    "",
    `Risk: ${result.review?.risk ?? "high"}`,
    "",
    `Hallazgos: ${result.review?.findings ?? 0}`,
    "",
    `Reviewed commit: ${sha}`,
    "",
    `Modelo: ${MODEL}`,
    "",
    `Estado: ${result.reason}`,
    "",
    result.description,
    "",
    result.review?.summary ?? "No hay una evaluación válida del cambio.",
    "",
    `Estimación de la Action en USD: ${validCost}. No es una factura de Groq.`,
    "",
    `[Logs de la ejecución](${runUrl})`,
    "",
    "Confidence Score es informativo y NO autoriza merge. La revisión humana TI4 sigue siendo obligatoria.",
  ].join("\n");
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
  const body = formatReview(result, env.REVIEW_SHA, env.RUN_URL, env.REVIEW_COST);
  const reviews = await github.paginate(github.rest.pulls.listReviews, { ...args, per_page: 100 });
  const original = reviews.findLast(
    (review) =>
      review.user?.login === "github-actions[bot]" &&
      review.commit_id === env.REVIEW_SHA &&
      review.body?.startsWith("## AI Code Review") &&
      env.REVIEW_SUMMARY &&
      review.body.includes(env.REVIEW_SUMMARY),
  );
  const { data: beforePublication } = await github.rest.pulls.get(args);
  if (
    beforePublication.head.sha !== env.REVIEW_SHA ||
    beforePublication.draft ||
    beforePublication.state !== "open"
  )
    return;
  if (original && env.REVIEW_OUTCOME === "success") {
    await github.rest.pulls.updateReview({ ...args, review_id: original.id, body });
  } else {
    await github.rest.pulls.createReview({
      ...args,
      commit_id: env.REVIEW_SHA,
      event: "COMMENT",
      body,
    });
  }
  const { data: latest } = await github.rest.pulls.get(args);
  if (latest.head.sha !== env.REVIEW_SHA || latest.draft || latest.state !== "open") return;
  await github.rest.repos.createCommitStatus(status);
  core.info(result.description);
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
};
