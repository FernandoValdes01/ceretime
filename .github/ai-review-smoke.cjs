const assert = require("node:assert/strict");
const { buildPlan, reviewPlan } = require("./ai-review-chunks.cjs");
const { respondToInline, BOT } = require("./ai-review-conversation.cjs");
const { MODEL } = require("./ai-review-provider.cjs");

// Synthetic GitHub data keeps the real provider check from publishing to a PR.
async function verifyProvider({ env = process.env, fetchImpl = fetch } = {}) {
  assert.ok(env.OPENROUTER_API_KEY, "Falta OPENROUTER_API_KEY en Actions.");
  const providerFetch = async (url, options) => {
    const response = await fetchImpl(url, options);
    console.info(`Prueba del proveedor: HTTP ${response.status}.`);
    return response;
  };
  const sha = "a".repeat(40);
  const source = "export const sum = (a: number, b: number) => a + b;";
  const patch = `@@ -0,0 +1 @@\n+${source}`;
  const plan = buildPlan(
    [{ filename: "example.ts", status: "added", additions: 1, deletions: 0, patch }],
    {},
    sha,
  );
  const review = await reviewPlan({
    plan,
    instructions: "Evalúa esta suma pura, sin dependencias ni requisitos externos.",
    apiKey: env.OPENROUTER_API_KEY,
    fetchImpl: providerFetch,
  });
  assert.equal(review.coverage, "complete", `La revisión de prueba quedó incompleta. ${review.reasons.join(" ")}`);
  assert.ok(review.usage.measuredCalls > 0, "Falta una respuesta real con uso medido.");
  const pr = {
    number: 1,
    title: "Prueba del proveedor",
    body: "Suma pura",
    state: "open",
    draft: false,
    base: { ref: "main" },
    head: { sha, repo: { full_name: "synthetic/test" } },
  };
  const root = {
    id: 1,
    body: "La función resta en lugar de sumar.",
    path: "example.ts",
    line: 1,
    side: "RIGHT",
    diff_hunk: patch,
    original_commit_id: sha,
    user: { login: BOT, type: "Bot" },
  };
  const reply = {
    id: 2,
    in_reply_to_id: 1,
    body: "La función usa a + b. Comprueba el hallazgo contra el código.",
    user: { login: "developer", type: "User" },
    author_association: "MEMBER",
  };
  const posted = [];
  const github = {
    paginate: async () => [root, reply],
    rest: {
      pulls: {
        get: async () => ({ data: pr }),
        listReviewComments: () => {},
        createReplyForReviewComment: async (payload) => posted.push(payload),
      },
      repos: {
        getContent: async () => ({
          data: {
            type: "file",
            encoding: "base64",
            size: Buffer.byteLength(source),
            content: Buffer.from(source).toString("base64"),
          },
        }),
      },
    },
  };
  const conversation = await respondToInline({
    github,
    context: {
      repo: { owner: "synthetic", repo: "test" },
      payload: { action: "created", pull_request: pr, comment: reply },
    },
    env: { REVIEW_BOT_LOGIN: BOT, OPENROUTER_API_KEY: env.OPENROUTER_API_KEY },
    fetchImpl: providerFetch,
  });
  assert.ok(conversation.usage?.measuredCalls > 0, "Falta una respuesta real de conversación.");
  assert.equal(posted.length, 1, "La conversación no produjo una respuesta válida.");
  assert.match(conversation.decision, /^(maintain|correct|not_applicable)$/);
  return {
    model: MODEL,
    review: { coverage: review.coverage, score: review.score, calls: review.calls },
    conversation: { decision: conversation.decision, calls: conversation.calls },
  };
}

module.exports = { verifyProvider };
