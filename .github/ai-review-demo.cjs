const { fixtureVerifier } = require("./ai-review-test-verifier.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { buildPlan, reviewPlan, publishFindings } = require("./ai-review-chunks.cjs");
const { evaluateReview } = require("./ai-review-score.cjs");
const { formatReview } = require("./ai-review-presentation.cjs");
const { BOT, respondToInline } = require("./ai-review-conversation.cjs");

const jsonResponse = (data) => ({
  ok: true,
  json: async () => ({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(data) } }],
  }),
});

async function runDemo() {
  const sha = "a".repeat(40);
  // Synthetic QA diff: never committed to product code or sent to the provider.
  const path = ".github/fixtures/example.ts";
  const patch =
    "@@ -0,0 +1,2 @@\n+export const normalize = (value) => value.trim();\n+export const fallback = (value) => value ?? 'default';";
  const plan = buildPlan(
    [{ filename: path, status: "added", additions: 2, deletions: 0, patch }],
    {},
    sha,
  );
  const findings = [1, 2].map((line) => ({
    path,
    line,
    side: "RIGHT",
    severity: "minor",
    issue_key: `edge-case-${line}`,
    cause: `La línea añadida ${line} cambia el tratamiento de valores límite del contrato.`,
    impact: "El consumidor obtiene un resultado incorrecto para esos valores.",
    fix: "Conservar la semántica del contrato y cubrir el caso con una prueba de regresión.",
    body: `Problema:\nFalta una prueba de regresión para ${line === 1 ? "espacios al inicio y al final" : "la diferencia entre texto vacío y valor ausente"}.\n\nImpacto:\nUna modificación futura podría cambiar este contrato sin detectar la regresión.\n\nCorrección propuesta:\nAgregar un caso de prueba que compruebe ${line === 1 ? "la eliminación de espacios externos" : "que el texto vacío se conserva y el valor ausente usa la alternativa"}.`,
  }));
  const report = await reviewPlan({
    verify: fixtureVerifier,
    plan,
    instructions: "Caso controlado, no review real.",
    apiKey: "simulation",
    fetchImpl: async () =>
      jsonResponse({
        findings,
      }),
    sleep: async () => {},
  });
  assert.equal(report.coverage, "complete");
  assert.equal(report.score, 4);
  assert.equal(report.risk, "low");
  assert.equal(report.findings.length, 2);
  const inline = [],
    replies = [];
  const pr = {
    number: 74,
    title: "Demostración sintética",
    body: "Prueba sin efectos externos.",
    state: "open",
    draft: false,
    base: { ref: "main", sha: "b".repeat(40) },
    head: { sha, repo: { full_name: "test/simulation" } },
  };
  const github = {
    paginate: async () => inline,
    rest: {
      pulls: {
        get: async () => ({ data: pr }),
        listReviewComments: () => {},
        createReview: async (request) => {
          assert.equal(request.commit_id, sha);
          for (const comment of request.comments)
            inline.push({
              ...comment,
              id: inline.length + 1,
              user: { login: BOT, type: "Bot" },
              original_commit_id: sha,
              diff_hunk: patch,
            });
        },
        createReplyForReviewComment: async (request) => {
          replies.push(request);
          inline.push({
            id: 20,
            in_reply_to_id: request.comment_id,
            body: request.body,
            user: { login: BOT, type: "Bot" },
          });
        },
      },
      repos: {
        getContent: async () => ({
          data: {
            type: "file",
            encoding: "base64",
            size: 80,
            content: Buffer.from(patch).toString("base64"),
          },
        }),
      },
    },
  };
  await publishFindings({
    github,
    args: { owner: "test", repo: "simulation", pull_number: 74 },
    sha,
    botLogin: BOT,
    report,
  });
  assert.equal(inline.length, 2);
  for (const comment of inline) {
    assert.equal(comment.path, path);
    assert.ok([1, 2].includes(comment.line));
    assert.match(
      comment.body,
      /Cambio que causa el problema:[\s\S]*Impacto:[\s\S]*Corrección propuesta:/,
    );
  }
  const evaluated = evaluateReview({
    outcome: "success",
    summary: report.summary,
    risk: report.risk,
    commentsCount: "2",
    expectedSha: sha,
    currentSha: sha,
    coverage: report.coverage,
  });
  assert.equal(evaluated.score, 4);
  const summary = formatReview(
    evaluated,
    sha,
    "https://github.com/test/simulation/actions/runs/1",
    "",
    { commitTitle: "Caso sintético de QA", report },
  );
  assert.match(summary, /Confidence Score: 4\/5/);
  assert.match(summary, /\| low \| 2 \| Review vigente \|/);
  const human = {
    id: 10,
    in_reply_to_id: inline[0].id,
    body: "Esta prueba ya existe en la suite de Application; aquí tienes el contexto del caso que comprueba los espacios.",
    author_association: "MEMBER",
    user: { login: "developer", type: "User" },
  };
  inline.push(human);
  const context = {
    repo: { owner: "test", repo: "simulation" },
    payload: { action: "created", pull_request: pr, comment: human },
  };
  const answer = await respondToInline({
    github,
    context,
    env: { REVIEW_BOT_LOGIN: BOT, OPENROUTER_API_KEY: "simulation" },
    fetchImpl: async () =>
      jsonResponse({
        decision: "not_applicable",
        explanation:
          "Tienes razón. Según el contexto aportado, la prueba ya cubre este contrato, por lo que retiro esta observación.",
        depends_on_external_context: true,
      }),
  });
  assert.equal(answer.decision, "not_applicable");
  assert.equal(replies[0].comment_id, inline[0].id);
  const evidence = [
    "## R2D2 · Demostración controlada de 4/5",
    "",
    "OpenRouter y GitHub simulados. No es una review real, no publica comentarios ni modifica el status o el score de la PR. El diff, el commit y sus enlaces son sintéticos.",
    "",
    summary,
    ...inline
      .slice(0, 2)
      .flatMap((c) => ["", `### Hallazgo independiente · ${c.path}:${c.line}`, "", c.body]),
    "",
    "### Conversación en el hilo del hallazgo 1",
    "",
    human.body,
    "",
    answer.body,
    "",
  ].join("\n");
  return { report, summary, inline, replies, evidence };
}

if (require.main === module)
  runDemo()
    .then(({ evidence }) => {
      if (process.env.GITHUB_STEP_SUMMARY)
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, evidence);
      else process.stdout.write(evidence);
    })
    .catch(() => {
      process.stderr.write("Falló la demostración controlada.\n");
      process.exitCode = 1;
    });
module.exports = { runDemo, jsonResponse };
