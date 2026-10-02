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
  const amount = (value) =>
    /^\d+$/.test(value ?? "") ? Number(value).toLocaleString("es-ES") : "no disponible";
  const rawObservations = String(metadata.actionSummary ?? "").trim();
  const observations = withoutBold(
    rawObservations.startsWith("Confidence Score:")
      ? rawObservations.split("; Resumen: ").slice(1).join("; Resumen: ")
      : rawObservations,
  );
  const nextAction = {
    incomplete:
      "Consultar la causa de cobertura incompleta: llamada fallida, respuesta inválida, presupuesto agotado o patch no disponible. Corregir esa causa o ajustar el presupuesto explícito dentro de los límites y reintentar. Las observaciones parciales no certifican el resto del cambio.",
    failed:
      "Consultar los logs enlazados para identificar el error de Groq o de la Action. Corregir la configuración o esperar la cuota del proveedor y reintentar el workflow sobre este mismo SHA.",
    missing: "Ejecutar AI Code Review para el commit actual y comprobar que devuelve un resultado.",
    stale: "Ejecutar de nuevo AI Code Review sobre el head actual de la PR.",
    invalid:
      "Comprobar los outputs del reviewer en los logs y corregir el contrato del resumen: score entero de 0 a 5, risk, SHA y cantidad de hallazgos coherentes.",
    reviewed:
      findings > 0
        ? "Revisar los hallazgos inline: cada uno debe explicar el problema introducido, su impacto y la corrección propuesta. Corregir los confirmados y volver a ejecutar la review con el nuevo commit."
        : "No hay correcciones concretas identificadas por el reviewer. Consultar la justificación de confianza y el resumen antes de decidir cambios; no inventar problemas para subir la nota.",
  }[result.reason];
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
    ...(result.reason === "incomplete"
      ? [
          "### Por qué la confianza es 0/5",
          "",
          "No es una calificación de la calidad del código. La revisión es parcial y no permite evaluar toda la PR.",
          "",
          `Diff de la PR: ${amount(metadata.diffSize)} caracteres; archivos: ${amount(metadata.filesCount)}. El tamaño total no determina la cobertura. ${metadata.report?.reasons?.join(" ") || "No se completó una revisión válida de todos los bloques."}`,
          "",
          "Cero hallazgos en la parte revisada no significa que el resto esté libre de problemas.",
          "",
        ]
      : []),
    "### Qué debes cambiar",
    "",
    nextAction,
    "",
    ...(observations && observations !== explanation
      ? ["### Observaciones del reviewer", "", observations, ""]
      : []),
    ...(metadata.report
      ? [
          "### Cobertura por bloques",
          "",
          `Bloques procesados: ${metadata.report.processed}/${metadata.report.total}. Llamadas a Groq: ${metadata.report.calls}. Cobertura: ${metadata.report.coverage}.`,
          "",
          ...metadata.report.findings.map(
            (f) => `- ${f.path}:${f.line} (${f.side}) · ${withoutBold(f.body)}`,
          ),
          "",
        ]
      : []),
    "<details>",
    "<summary>Modelo y ejecución</summary>",
    "",
    `SHA revisado: \`${sha}\``,
    "",
    `Modelo: \`${MODEL}\` · Proveedor: Groq`,
    "",
    `Estimación de la Action en USD: ${validCost}. No es una factura de Groq; las llamadas por bloques se contabilizan aparte, sin estimar un precio no verificado.`,
    "",
    `[Logs de la ejecución](${runUrl})`,
    "",
    `[Prueba controlada de la escala de 0/5 a 5/5](${runUrl}#summary)`,
    "",
    "</details>",
  ].join("\n");
}

module.exports = { MODEL, formatReview, formatInline, withoutBold };
