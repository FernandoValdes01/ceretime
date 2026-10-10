const { MODEL, PROVIDER } = require("./ai-review-provider.cjs");

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
  const rawObservations = String(metadata.actionSummary ?? "").trim();
  const observations = withoutBold(
    /^(?:Confidence Score:|Review status: incomplete;)/.test(rawObservations)
      ? rawObservations.split("; Resumen: ").slice(1).join("; Resumen: ")
      : rawObservations,
  );
  const confirmed = metadata.report?.findings ?? [];
  const displayedRisk = result.reason === "incomplete" && findings === 0 ? "No determinado" : risk;
  const nextAction = {
    incomplete:
      findings > 0
        ? "Corregir los hallazgos verificados indicados abajo. La evidencia pendiente limita el alcance del informe y no invalida esas correcciones."
        : "No se identificaron correcciones verificadas en la parte revisada. Consultar la evidencia pendiente y los logs. Corregir la causa antes de repetir AI Code Review desde Actions con el número de PR; reintentar sin cambios puede consumir tokens y dejar el mismo resultado.",
    failed:
      "Consultar los logs enlazados para identificar el error de OpenRouter o de la Action. Corregir la configuración o esperar la cuota del proveedor y reintentar el workflow sobre este mismo SHA.",
    missing: "Ejecutar AI Code Review para el commit actual y comprobar que devuelve un resultado.",
    stale: "Ejecutar de nuevo AI Code Review sobre el head actual de la PR.",
    invalid:
      "Comprobar los outputs del reviewer en los logs y corregir el contrato del resumen: score entero de 0 a 5, risk, SHA y cantidad de hallazgos coherentes.",
    reviewed:
      findings > 0
        ? "Revisar los hallazgos de la PR y los comentarios inline: cada uno debe explicar el problema introducido, su impacto y la corrección propuesta. Corregir los confirmados y volver a ejecutar la review con el nuevo commit."
        : "No hay correcciones concretas identificadas por el reviewer. Consultar la justificación de confianza y el resumen antes de decidir cambios; no inventar problemas para subir la nota.",
  }[result.reason];
  return [
    "<!-- ceretime-ai-review-summary -->",
    "## R2D2 · AI Code Review",
    "",
    result.reason === "reviewed"
      ? `### Confidence Score: ${result.score}/5`
      : "### Revisión incompleta",
    "",
    "| Risk | Hallazgos | Estado |",
    "| --- | --- | --- |",
    `| ${displayedRisk} | ${findings} | ${state} |`,
    "",
    `Reviewed commit: [${title}](https://github.com/${repo}/commit/${sha})`,
    "",
    ...(metadata.report?.baseRef
      ? [
          `Base revisada: ${JSON.stringify(metadata.report.baseRef)}; SHA: ${metadata.report.base}.`,
          "",
        ]
      : []),
    "### Resumen",
    "",
    ...(metadata.report?.changeSummaries?.length
      ? [
          withoutBold(metadata.report.changeSummaries.slice(0, 3).join("\n\n")),
          ...(result.reason === "reviewed" ? [] : [result.description]),
        ]
      : [result.reason === "reviewed" ? explanation : result.description]),
    "",
    "### Qué debes cambiar",
    "",
    ...(confirmed.length
      ? confirmed.flatMap((finding) => [
          `#### ${finding.path}${finding.line ? `:${finding.line}` : ""}`,
          "",
          withoutBold(finding.body),
          "",
        ])
      : []),
    nextAction,
    "",
    ...(metadata.report?.verificationPending?.length
      ? [
          "### Puntos pendientes de comprobar",
          "",
          "Estos candidatos necesitan evidencia adicional; todavía no son defectos confirmados.",
          "",
          ...metadata.report.verificationPending
            .slice(0, 5)
            .flatMap((finding) => [
              `- ${finding.path}:${finding.line}: ${withoutBold(finding.cause)}`,
            ]),
          "",
        ]
      : []),
    ...(result.reason === "incomplete"
      ? [
          "### Evidencia pendiente",
          "",
          "La revisión es parcial. No se asigna una calificación de calidad mientras falte evidencia.",
          "",
          ...[
            ...new Set(metadata.report?.missingEvidence?.map((request) => request.path) ?? []),
          ].map((path) => `- ${path}`),
          ...(metadata.report?.missingEvidence?.length
            ? []
            : ["Consulta los incidentes en los detalles de la ejecución."]),
          "",
          findings > 0
            ? "Los hallazgos corresponden a la parte revisada; el resto del cambio sigue pendiente."
            : "Cero hallazgos en la parte revisada no significa que el resto esté libre de problemas.",
          "",
        ]
      : []),
    ...(observations && observations !== explanation
      ? ["### Observaciones del reviewer", "", observations, ""]
      : []),
    ...(metadata.report
      ? [
          "<details>",
          "<summary>Detalles de cobertura y consumo</summary>",
          "",
          "### Cobertura, defectos e incidentes",
          "",
          `Bloques procesados: ${metadata.report.processed}/${metadata.report.total}. Llamadas a OpenRouter: ${metadata.report.calls}. Cobertura: ${metadata.report.coverage}.`,
          ...(metadata.report.analyses?.length
            ? [
                "",
                "### Análisis inicial por archivos",
                "",
                ...metadata.report.analyses
                  .filter((item) => item.summary)
                  .flatMap((item) => [item.paths.join(", "), "", withoutBold(item.summary), ""]),
              ]
            : []),
          ...(metadata.report.analyzedFiles
            ? [
                `Archivos con análisis inicial: ${metadata.report.analyzedFiles.length}. La recuperación y verificación pendientes se detallan por separado.`,
              ]
            : []),
          "",
          `Defectos verificados: ${metadata.report.totalFindings ?? findings}. Solicitudes de evidencia pendientes: ${metadata.report.missingEvidence?.length ?? 0}. Incidentes del revisor: ${metadata.report.infrastructure?.length ?? 0}.`,
          ...(metadata.report.files?.length
            ? [
                "",
                ...metadata.report.files.map(
                  (file) =>
                    `- ${file.path}: ${file.coverage === "complete" ? "completo" : "pendiente"}`,
                ),
                "",
              ]
            : []),
          ...[...new Set(metadata.report.reasons ?? [])]
            .filter((reason) => !reason.startsWith("Falta evidencia:"))
            .map((reason) => `Limitación: ${reason}`),
          ...(metadata.report.missingEvidence ?? []).map(
            (r) =>
              `Evidencia pendiente: ${r.path}, ${r.symbol ?? r.fragment ?? "archivo completo"}: ${r.reason}`,
          ),
          ...(metadata.report.infrastructure ?? []).map((r) => `Incidente: ${r}`),
          `Unidades reutilizadas por contenido y contexto: ${metadata.report.reused ?? 0}. Archivos omitidos de IA: ${metadata.report.skipped?.length ?? 0}.`,
          ...(metadata.report.usage?.measuredCalls
            ? [
                `Tokens medidos en esta ejecución: ${metadata.report.usage.prompt} de entrada, ${metadata.report.usage.completion} de salida; ${metadata.report.usage.cachedPrompt} de entrada en caché del proveedor.`,
              ]
            : []),
          ...(metadata.report.tokenBudget
            ? [
                `Presupuesto de tokens: ${metadata.report.tokenBudget.charged}/${metadata.report.tokenBudget.limit}. Incluye reservas conservadas cuando el proveedor no informa consumo.`,
              ]
            : []),
          ...(metadata.report.usageByStage
            ? [
                `Tokens medidos de análisis: ${metadata.report.usageByStage.analysis.prompt + metadata.report.usageByStage.analysis.completion}. Tokens medidos de verificación: ${metadata.report.usageByStage.verification.prompt + metadata.report.usageByStage.verification.completion}.`,
              ]
            : []),
          "",
          "</details>",
          "",
        ]
      : []),
    "<details>",
    "<summary>Modelo y ejecución</summary>",
    "",
    `SHA revisado: \`${sha}\``,
    "",
    `Modelo: \`${MODEL}\` · Proveedor: ${PROVIDER}`,
    "",
    `Estimación en USD: ${validCost}. Los tokens medidos corresponden a esta ejecución; no se estima un precio no verificado.`,
    "",
    `[Logs de la ejecución](${runUrl})`,
    "",
    `[Prueba controlada de la escala y de resultados incompletos](${runUrl}#summary)`,
    "",
    "</details>",
  ].join("\n");
}

module.exports = { MODEL, formatReview, formatInline, withoutBold };
