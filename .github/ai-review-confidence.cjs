const { currentReview } = require("./ai-review-target.cjs");
const fs = require("node:fs");
const { memoryIdentity, createMemory } = require("./ai-review-memory.cjs");
const { reviewPlan } = require("./ai-review-chunks.cjs");
const { parseSummary } = require("./ai-review-score.cjs");

async function normalizeConfidence({
  core,
  env = process.env,
  fetchImpl = fetch,
  github,
  context,
  verify,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const plan = JSON.parse(
    fs.readFileSync(`${env.GITHUB_WORKSPACE}/.git/ai-review-plan.json`, "utf8"),
  );
  if (plan.sha !== env.REVIEW_SHA) throw new Error("Plan de otro SHA.");
  const report = await reviewPlan({
    plan,
    verify,
    memory: createMemory({
      directory: `${env.GITHUB_WORKSPACE}/.git/ai-review-memory`,
      identity: memoryIdentity(plan, env.REVIEW_INSTRUCTIONS),
      apiKey: env.OPENROUTER_API_KEY,
    }),
    instructions: env.REVIEW_INSTRUCTIONS,
    apiKey: env.OPENROUTER_API_KEY,
    fetchImpl,
    sleep,
    onProgress: (message) => core.info?.(`R2D2: ${message}`),
    isCurrent: async () => {
      const { data: pr } = await github.rest.pulls.get({
        ...context.repo,
        pull_number: context.payload.pull_request.number,
      });
      return currentReview(pr, plan, context.repo);
    },
  });
  if (!parseSummary(report.summary)) throw new Error("Resumen agregado inválido.");
  fs.writeFileSync(`${env.GITHUB_WORKSPACE}/.git/ai-review-result.json`, JSON.stringify(report), {
    mode: 0o600,
  });
  core.setOutput("summary", report.summary);
  core.setOutput("coverage", report.coverage);
  core.setOutput("risk", report.risk);
  core.setOutput("comments", String(report.findings.length));
  return;
}

module.exports = { normalizeConfidence };
