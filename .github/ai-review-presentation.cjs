const MODEL = "openai/gpt-oss-120b";

function withoutBold(text) {
  let fence = null;
  return String(text ?? "")
    .split("\n")
    .map((line) => {
      const delimiter = line.match(/^\s*(`{3,}|~{3,})/);
      if (delimiter) {
        if (!fence) fence = delimiter[1];
        else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = null;
        return line;
      }
      if (fence) return line;
      return line
        .split(/(`+[^`]*`+)/g)
        .map((part, index) => (index % 2 ? part : part.replace(/(?<!\\)\*\*/g, "")))
        .join("");
    })
    .join("\n");
}

function formatInline(body) {
  const match = body.match(/^\*\*\[(CRITICAL|WARNING|SUGGESTION|INFO)\] [^\n]+\*\*\n\n/);
  if (!match) return body;
  const severity = {
    CRITICAL: "Crítico",
    WARNING: "Advertencia",
    SUGGESTION: "Sugerencia",
    INFO: "Información",
  }[match[1]];
  const content = withoutBold(body.slice(match[0].length)).replace(
    /^Suggested fix:$/gm,
    "Propuesta:",
  );
  return `<!-- ceretime-r2d2-inline -->\n### R2D2 · ${severity}\n\n${content}`;
}

function formatReview(result, sha, runUrl, cost, metadata = {}) {
  const repo = new URL(runUrl).pathname.split("/").slice(1, 3).join("/");
  const validCost = /^\d+(?:\.\d+)?$/.test(cost ?? "") ? cost : "no disponible";
  const risk =
    result.review?.risk ??
    (/^(low|medium|high)$/.test(metadata.risk ?? "") ? metadata.risk : "high");
  const findings =
    result.review?.findings ??
    (/^[0-5]$/.test(metadata.commentsCount ?? "") ? Number(metadata.commentsCount) : 0);
  const state = {
    reviewed: "Review vigente",
    missing: "Review ausente",
    stale: "Review obsoleta",
    failed: "Error de ejecución",
    invalid: "Resultado inválido",
    incomplete: "Cobertura incompleta",
  }[result.reason];
  const explanation = withoutBold(
    result.review?.summary ?? "No hay una evaluación válida del cambio.",
  );
  const title = String(metadata.commitTitle || sha.slice(0, 7))
    .split(/\r?\n/)[0]
    .replace(/[\\`*_{}[\]()<>!|]/g, "\\$&");
  return [
    "<!-- ceretime-ai-review-summary -->",
    "## R2D2 · AI Code Review",
    "",
    `### Confidence Score: ${result.score}/5`,
    "",
    "| Risk | Hallazgos | Estado |",
    "| --- | --- | --- |",
    `| ${risk} | ${findings} | ${state} |`,
    "",
    `Reviewed commit: [${title}](https://github.com/${repo}/commit/${sha})`,
    "",
    "### Resumen",
    "",
    result.reason === "reviewed" ? explanation : `${result.description}\n\n${explanation}`,
    "",
    "<details>",
    "<summary>Modelo y ejecución</summary>",
    "",
    `SHA revisado: \`${sha}\``,
    "",
    `Modelo: \`${MODEL}\` · Proveedor: Groq`,
    "",
    `Estimación de la Action en USD: ${validCost}. No es una factura de Groq; excluye la evaluación adicional.`,
    "",
    `[Logs de la ejecución](${runUrl})`,
    "",
    `[Prueba controlada de la escala de 0/5 a 5/5](${runUrl}#summary)`,
    "",
    "</details>",
  ].join("\n");
}

module.exports = { MODEL, formatReview, formatInline, withoutBold };
