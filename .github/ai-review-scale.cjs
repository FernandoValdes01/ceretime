const assert = require("node:assert/strict");
const fs = require("node:fs");
const { evaluateReview } = require("./ai-review-score.cjs");

function verifyScale() {
  const sha = "a".repeat(40);
  const rows = [];
  for (let score = 0; score <= 5; score++) {
    const result = evaluateReview({
      outcome: "success",
      summary: `Confidence Score: ${score}/5; Risk: low; Reviewed commit: ${sha}; Hallazgos: 0; Resumen: Caso controlado de prueba.`,
      risk: "low",
      commentsCount: "0",
      expectedSha: sha,
      currentSha: sha,
      coverage: "complete",
    });
    assert.equal(result.score, score);
    assert.equal(result.state, score === 5 ? "success" : "failure");
    rows.push(`| ${score}/5 | ${result.score}/5 | ${result.state} |`);
  }
  return [
    "## R2D2 · Prueba de la escala",
    "",
    "Casos controlados de 0/5 a 5/5. No son evaluaciones de Groq ni publican statuses o comentarios en la PR. La review real conserva su resultado.",
    "",
    "| Entrada de prueba | Score obtenido | Estado comprobado |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

if (require.main === module) {
  const report = verifyScale();
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  } else {
    process.stdout.write(report);
  }
}

module.exports = { verifyScale };
