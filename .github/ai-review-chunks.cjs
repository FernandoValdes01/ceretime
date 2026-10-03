const { withoutBold } = require("./ai-review-presentation.cjs");

const { classifyFile, matchesIgnore } = require("./ai-review-selection.cjs");
const { hash } = require("./ai-review-context.cjs");

const { ENDPOINT, completionRequest, addUsage, emptyUsage } = require("./ai-review-provider.cjs");

const LIMITS = Object.freeze({
  chunkChars: 12000,
  inputChars: 18000,
  maxChunks: 32,
  maxCalls: 32,
  outputTokens: 2400,
  intervalMs: 65000,
  maxRateLimitWaitMs: 600000,
});
const severityRank = { critical: 3, important: 2, warning: 1, minor: 0 };

// Keep every patch line and its original coordinates, including deletions.
function patchRecords(patch) {
  const records = [];
  let left = 0,
    right = 0,
    oldRemaining = 0,
    newRemaining = 0;
  for (const text of patch.replace(/\n$/, "").split("\n")) {
    const hunk = text.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      if (oldRemaining || newRemaining) throw new Error("Patch truncado.");
      left = Number(hunk[1]);
      right = Number(hunk[3]);
      oldRemaining = Number(hunk[2] ?? 1);
      newRemaining = Number(hunk[4] ?? 1);
      records.push({ text, header: true });
    } else if (text.startsWith("+")) {
      records.push({ text, side: "RIGHT", line: right++ });
      newRemaining--;
    } else if (text.startsWith("-")) {
      records.push({ text, side: "LEFT", line: left++ });
      oldRemaining--;
    } else if (text.startsWith(" ")) {
      records.push({ text });
      left++;
      right++;
      oldRemaining--;
      newRemaining--;
    } else if (text.startsWith("\\ No newline at end of file")) {
      records.push({ text });
    } else throw new Error("Patch no interpretable.");
    if (oldRemaining < 0 || newRemaining < 0) throw new Error("Coordenadas inválidas del patch.");
  }
  if (oldRemaining || newRemaining || !records.some((r) => r.header))
    throw new Error("Patch truncado.");
  return records;
}

function buildPlan(files, config = {}, sha) {
  const limits = { ...LIMITS, ...config.chunking };
  for (const [key, max] of Object.entries(LIMITS)) {
    if (!Number.isInteger(limits[key]) || limits[key] <= 0 || limits[key] > max)
      throw new Error(`Límite inválido: ${key}.`);
  }
  const plan = { sha, limits, chunks: [], issues: [], files: 0, chars: 0, skipped: [] };
  // Reuse spare capacity instead of abandoning a partially filled chunk.
  const bins = [];
  const assignedThreads = new Set();
  for (const original of files) {
    let file = original;
    const selection = classifyFile(file, config);
    if (!selection.eligible) {
      plan.skipped.push({ path: file.filename, reason: selection.reason });
      continue;
    }
    plan.files++;
    if (!file.patch && file.additions === 0 && file.deletions === 0 && file.status === "renamed") {
      file = { ...file, patch: "@@ -0,0 +0,0 @@" };
    }
    if (!file.patch) {
      plan.issues.push(`Patch no disponible: ${file.filename}`);
      continue;
    }
    let records;
    try {
      records = patchRecords(file.patch);
    } catch {
      plan.issues.push(`Patch incompleto o no interpretable: ${file.filename}`);
      continue;
    }
    const added = records.filter((r) => r.side === "RIGHT").length;
    const removed = records.filter((r) => r.side === "LEFT").length;
    if (
      (file.additions != null && added !== file.additions) ||
      (file.deletions != null && removed !== file.deletions)
    ) {
      plan.issues.push(`Patch no cubre todas las líneas: ${file.filename}`);
      continue;
    }
    plan.chars += file.patch.length;
    // Pack whole hunks first. Only oversized hunks are divided at line boundaries.
    const extra = {
      kind: selection.kind,
      focus: selection.focus,
      context: file.context ?? [],
      contextKey: file.contextKey,
    };
    const metadataSize =
      JSON.stringify({
        ...extra,
        path: file.filename,
        previousPath: file.previous_filename,
        status: file.status,
        patch: "",
      }).length +
      Math.max(2, ...(file.followups ?? []).map((t) => JSON.stringify(t).length)) +
      100;
    const recordSize = (r) =>
      JSON.stringify(r.side ? `[${r.side}:${r.line}] ${r.text}` : r.text).length + 2;
    const hunks = [];
    for (const record of records) {
      if (record.header) hunks.push([]);
      hunks.at(-1).push(record);
    }
    const units = [];
    for (const hunk of hunks) {
      const length = hunk.reduce((n, r) => n + recordSize(r), 0);
      if (length + metadataSize <= limits.chunkChars) {
        units.push(hunk);
        continue;
      }
      let unit = [],
        unitSize = 0;
      for (const record of hunk) {
        if (recordSize(record) + metadataSize > limits.chunkChars) {
          plan.issues.push(`Línea mayor que el presupuesto por bloque: ${file.filename}`);
          break;
        }
        if (unitSize + recordSize(record) + metadataSize > limits.chunkChars && unit.length) {
          units.push(unit);
          unit = [hunk[0], ...hunk.filter((r) => !r.side && !r.header).slice(0, 2)];
          unitSize = unit.reduce((n, r) => n + recordSize(r), 0);
        }
        unit.push(record);
        unitSize += recordSize(record);
      }
      if (unit.length) units.push(unit);
    }
    for (const unit of units) {
      const patch = unit
        .map((r) => (r.side ? `[${r.side}:${r.line}] ${r.text}` : r.text))
        .join("\n");
      const part = {
        ...extra,
        followups: (file.followups ?? []).filter(
          (t) =>
            !assignedThreads.has(t.id) &&
            (t.currentLine == null ||
              unit.some((r) => r.side === "RIGHT" && Math.abs(r.line - t.currentLine) <= 12)),
        ),
        path: file.filename,
        previousPath: file.previous_filename,
        status: file.status,
        patch,
        anchors: unit.filter((r) => r.side).map((r) => `${r.side}:${r.line}`),
      };
      for (const thread of part.followups) assignedThreads.add(thread.id);
      const partSize = JSON.stringify({ ...part, anchors: undefined }).length;
      if (partSize > limits.chunkChars) {
        plan.issues.push(`Bloque mayor que el presupuesto: ${file.filename}`);
        continue;
      }
      const available = bins
        .filter((bin) => bin.size + partSize + 1 <= limits.chunkChars)
        .sort((a, b) => b.size - a.size)[0];
      if (available) {
        available.parts.push(part);
        available.size += partSize + 1;
      } else bins.push({ parts: [part], size: partSize + 2 });
    }
  }
  plan.chunks = bins.map(({ parts }) => ({ parts }));
  if (plan.chunks.length > limits.maxChunks)
    plan.issues.push("Presupuesto máximo de bloques agotado.");

  return plan;
}

function validateAssessment(data, chunk) {
  if (!data || !Array.isArray(data.findings) || data.findings.length > 5)
    throw new Error("Respuesta de bloque inválida.");
  if (Object.hasOwn(data, "score") || Object.hasOwn(data, "risk"))
    throw new Error("El modelo no decide la nota ni el riesgo.");
  const limitations = data.limitations ?? [];
  if (
    !Array.isArray(limitations) ||
    limitations.length > chunk.parts.length ||
    limitations.some((l) => typeof l !== "string" || !l.trim() || l.length > 800)
  )
    throw new Error("Limitaciones inválidas.");
  const findings = data.findings.map((finding) => {
    const part = chunk.parts.find(
      (p) => p.path === finding.path && p.anchors.includes(`${finding.side}:${finding.line}`),
    );
    if (
      !part ||
      !Number.isInteger(finding.line) ||
      finding.line <= 0 ||
      !Object.hasOwn(severityRank, finding.severity)
    )
      throw new Error("Hallazgo sin línea válida.");
    for (const key of ["issue_key", "cause", "impact", "fix"]) {
      if (
        typeof finding[key] !== "string" ||
        !finding[key].trim() ||
        finding[key].length > (key === "issue_key" ? 100 : 800)
      )
        throw new Error("Hallazgo sin causalidad, impacto o corrección.");
    }
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(finding.issue_key))
      throw new Error("Identidad de hallazgo inválida.");
    if (finding.threadId && !part.followups?.some((t) => t.id === String(finding.threadId)))
      throw new Error("Hilo desconocido.");
    return {
      ...finding,
      threadId: finding.threadId ? String(finding.threadId) : undefined,
      body: `Cambio que causa el problema: ${finding.cause}\n\nImpacto: ${finding.impact}\n\nCorrección propuesta: ${finding.fix}`,
    };
  });
  const expected = new Set(chunk.parts.flatMap((p) => (p.followups ?? []).map((t) => t.id)));
  const resolutions = data.resolutions ?? [];
  if (!Array.isArray(resolutions) || resolutions.length !== expected.size)
    throw new Error("Falta comprobar un hallazgo anterior.");
  const seen = new Set();
  for (const resolution of resolutions) {
    const id = String(resolution.id);
    if (
      !expected.has(id) ||
      seen.has(id) ||
      !["resolved", "not_applicable", "maintain", "needs_context"].includes(resolution.status) ||
      typeof resolution.explanation !== "string" ||
      !resolution.explanation.trim() ||
      resolution.explanation.length > 1200
    )
      throw new Error("Resolución de hilo inválida.");
    const thread = chunk.parts.flatMap((p) => p.followups ?? []).find((t) => t.id === id);
    if (thread.evidence_incomplete && resolution.status !== "needs_context")
      throw new Error("No se puede resolver un hilo con evidencia incompleta.");
    if (resolution.status === "maintain" && !findings.some((f) => f.threadId === id))
      throw new Error("Hallazgo mantenido sin evidencia vigente.");
    if (
      ["resolved", "not_applicable"].includes(resolution.status) &&
      findings.some((f) => f.threadId === id)
    )
      throw new Error("Resolución contradictoria.");
    seen.add(id);
  }
  const rank = Math.max(-1, ...findings.map((f) => severityRank[f.severity]));
  return {
    score: rank < 0 ? 5 : 4 - rank,
    risk: rank >= 2 ? "high" : rank === 1 ? "medium" : "low",
    explanation: findings.length
      ? "Hay problemas concretos introducidos por el cambio."
      : "Sin problemas relevantes en este bloque.",
    findings,
    resolutions,
    limitations,
  };
}

function aggregate(plan, results, calls, errors = []) {
  const unique = new Map();
  for (const finding of results.flatMap((r) => r.findings)) {
    const duplicate = [...unique.entries()].find(
      ([, old]) =>
        old.path === finding.path &&
        ((old.issue_key && old.issue_key === finding.issue_key) ||
          (old.body && old.body === finding.body)),
    );
    const key = duplicate?.[0] ?? `${finding.path}:${finding.side}:${finding.line}`;
    if (!unique.has(key) || severityRank[finding.severity] > severityRank[unique.get(key).severity])
      unique.set(key, finding);
  }
  const allFindings = [...unique.values()].sort(
    (a, b) =>
      severityRank[b.severity] - severityRank[a.severity] ||
      a.path.localeCompare(b.path) ||
      a.line - b.line,
  );
  const resolutions = [
    ...new Map(results.flatMap((r) => r.resolutions ?? []).map((r) => [String(r.id), r])).values(),
  ];
  const reasons = [...plan.issues, ...errors, ...results.flatMap((r) => r.limitations ?? [])];
  for (const resolution of resolutions) {
    const versions = results
      .flatMap((r) => r.resolutions ?? [])
      .filter((r) => String(r.id) === String(resolution.id));
    const maintained = allFindings.some((f) => f.threadId === String(resolution.id));
    if (
      new Set(versions.map((r) => r.status)).size > 1 ||
      (["resolved", "not_applicable"].includes(resolution.status) && maintained)
    )
      reasons.push("Resoluciones contradictorias para un hallazgo anterior.");
  }
  if (resolutions.some((r) => r.status === "needs_context"))
    reasons.push("Falta evidencia para comprobar un hallazgo anterior.");
  const coverage =
    !reasons.length && results.length === plan.chunks.length ? "complete" : "incomplete";
  const rank = Math.max(-1, ...allFindings.map((f) => severityRank[f.severity]));
  const risk = rank >= 2 ? "high" : rank === 1 ? "medium" : "low";
  const score = coverage === "complete" ? (rank < 0 ? 5 : 4 - rank) : 0;
  const explanation = (
    !plan.files && !plan.chunks.length && !reasons.length
      ? "Sin cambios que requieran análisis con IA."
      : `Procesados ${results.length}/${plan.chunks.length} bloques de ${plan.files} archivos. ${reasons.length ? reasons.join(" ") : allFindings.length ? "Los problemas concretos se detallan en los hilos." : "Sin problemas relevantes en los bloques revisados."}`
  )
    .replace(/[;\r\n]+/g, " ")
    .slice(0, 6000);
  const findings = allFindings.slice(0, 5);
  return {
    sha: plan.sha,
    base: plan.base,
    discussionKey: plan.discussionKey,
    coverage,
    score,
    risk,
    findings,
    resolutions,
    skipped: plan.skipped ?? [],
    totalFindings: allFindings.length,
    summary: `Confidence Score: ${score}/5; Risk: ${risk}; Reviewed commit: ${plan.sha}; Hallazgos: ${findings.length}; Resumen: ${explanation}`,
    processed: results.length,
    total: plan.chunks.length,
    calls,
    reasons,
  };
}

function durationMs(value) {
  if (!value) return 0;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value) * 1000;
  if (!/^(?:\d+(?:\.\d+)?(?:ms|h|m|s))+$/.test(value)) return 0;
  return [...value.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)].reduce(
    (total, [, amount, unit]) =>
      total + Number(amount) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[unit],
    0,
  );
}

async function quotaInformation(response) {
  try {
    const json = await response.json();
    const message =
      typeof json?.error?.message === "string" ? json.error.message.slice(0, 4000) : "";
    // Extract only known units and numeric fields; never return raw provider text.
    const kind = message.match(/\b(TPM|TPD|RPM|RPD)\b/)?.[1] ?? "unknown";
    const number = (name) => {
      const match = message.match(new RegExp(`${name}[: ]+([0-9]+(?:\\.[0-9]+)?)`, "i"));
      return match ? Number(match[1]) : null;
    };
    return {
      kind,
      limit: number("Limit"),
      used: number("Used"),
      requested: number("Requested"),
      retryMs: durationMs(message.match(/try again in ([0-9.hms]+)/i)?.[1]),
    };
  } catch {
    return { kind: "unknown", retryMs: 0 };
  }
}

function quotaDescription(quota) {
  const kind = {
    TPM: "tokens por minuto",
    TPD: "tokens por día",
    RPM: "solicitudes por minuto",
    RPD: "solicitudes por día",
    unknown: "cuota sin tipo identificado",
  }[quota.kind];
  const metrics = [
    ["límite", quota.limit],
    ["usado", quota.used],
    ["solicitado", quota.requested],
  ]
    .filter(([, value]) => Number.isFinite(value))
    .map(([name, value]) => `${name}: ${value}`)
    .join(", ");
  return `Groq HTTP 429: ${kind}${metrics ? ` (${metrics})` : ""}.`;
}

function rateLimitDelay(headers, attempt, interval, quota) {
  const retry = headers?.get("retry-after");
  const retryMs =
    durationMs(retry) ||
    (Number.isFinite(Date.parse(retry)) ? Math.max(0, Date.parse(retry) - Date.now()) : 0) ||
    quota.retryMs;
  // Retry-After describes this rejection. Other reset headers describe independent
  // buckets and must not turn a minute-limit retry into an hours-long wait.
  const reset =
    quota.kind === "RPD" || quota.kind === "RPM"
      ? durationMs(headers?.get("x-ratelimit-reset-requests"))
      : quota.kind === "TPD"
        ? 0
        : durationMs(headers?.get("x-ratelimit-reset-tokens"));
  return Math.ceil(Math.max(interval * 2 ** attempt, retryMs || reset)) + 1000;
}

async function reviewPlan({
  plan,
  instructions,
  apiKey,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  isCurrent = async () => true,
  onProgress = () => {},
  memory,
}) {
  if (!apiKey && plan.chunks.length) throw new Error("Falta el secret del proveedor.");
  const results = [],
    errors = [];
  let calls = 0,
    rateLimitWait = 0,
    nextDelay = 0,
    reused = 0;
  const usage = emptyUsage();
  const finish = () => ({ ...aggregate(plan, results, calls, errors), reused, usage });
  if (plan.issues.length) return finish();
  for (const [index, originalChunk] of plan.chunks.entries()) {
    const cachedResults = [],
      pending = [];
    for (const part of originalChunk.parts) {
      try {
        const cached = memory?.get(part);
        if (!cached) {
          pending.push(part);
          continue;
        }
        cachedResults.push(validateAssessment(cached, { parts: [part] }));
        reused++;
      } catch {
        pending.push(part);
      }
    }
    if (!(await isCurrent())) {
      errors.push("El head cambió durante la revisión.");
      return finish();
    }
    const merge = (items) => ({
      findings: items.flatMap((r) => r.findings),
      resolutions: [
        ...new Map(
          items.flatMap((r) => r.resolutions ?? []).map((r) => [String(r.id), r]),
        ).values(),
      ],
      limitations: items.flatMap((r) => r.limitations ?? []),
    });
    if (!pending.length) {
      results.push(merge(cachedResults));
      onProgress(
        `Bloque ${index + 1}/${plan.chunks.length} recuperado de memoria de contenido y contexto.`,
      );
      continue;
    }
    const chunk = { parts: pending };
    let assessment,
      lastFailure = "Una llamada necesaria falló o devolvió un resultado inválido.";
    let ordinaryFailures = 0;
    for (let attempt = 0; attempt < 3 && calls < plan.limits.maxCalls; attempt++) {
      let stage = "request";
      if (!(await isCurrent())) {
        errors.push("El head cambió durante la revisión.");
        return finish();
      }
      if (calls) await sleep(Math.max(plan.limits.intervalMs, nextDelay));
      nextDelay = 0;
      if (!(await isCurrent())) {
        errors.push("El head cambió durante la revisión.");
        return finish();
      }
      calls++;
      try {
        const body = JSON.stringify(
          completionRequest(
            [
              {
                role: "system",
                content: `${instructions}\nmain es la base válida. Solo reporta defectos que este diff introduzca, empeore o de los que dependa directamente, explicando esa relación causal. cause, impact y fix deben ser breves, hasta 240 caracteres cada uno. El contexto sin cambios sirve exclusivamente para verificar el cambio. Comprueba cada hilo previo usando el hallazgo, la explicación humana y el cambio relacionado. Retira los refutados o resueltos; mantener exige evidencia anclada al diff vigente. No repitas un hallazgo previo con otra identidad: usa threadId. Si evidence_incomplete es true, ese hilo exige status needs_context, incluso si parece resuelto. Devuelve solo JSON: {findings:[{path,line,side:RIGHT|LEFT,severity:critical|important|warning|minor,issue_key:identificador-estable-del-defecto,cause:cambio concreto y problema,impact:flujo afectado,fix:corrección,threadId:id del hilo previo si existe}],limitations:[motivos concretos si no puedes evaluar el cambio],resolutions:[{id,status:resolved|not_applicable|maintain|needs_context,explanation:evidencia técnica breve}]}. Solo coordenadas anotadas [RIGHT:N] o [LEFT:N], máximo cinco hallazgos funcionales; cero es válido. Sin comentarios de estilo ni preferencias. No devuelvas score: se calcula localmente. Si el contexto es insuficiente para evaluar un cambio, registra limitations: no inventes una cobertura completa. Un bloque followupOnly solo admite resoluciones, nunca defectos de main.${ordinaryFailures ? ` La respuesta anterior fue rechazada: ${lastFailure} Corrige ese contrato en este intento.` : ""}`,
              },
              {
                role: "user",
                content: JSON.stringify({
                  sha: plan.sha,
                  base: plan.base,
                  intent: plan.intent,
                  parts: chunk.parts.map(
                    ({ anchors: _anchors, contextKey: _contextKey, ...part }) => part,
                  ),
                }),
              },
            ],
            plan.limits.outputTokens,
          ),
        );
        if (body.length > plan.limits.inputChars) {
          errors.push("Presupuesto de entrada por llamada agotado.");
          calls--;
          return finish();
        }
        const response = await fetchImpl(ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(45000),
          body,
        });
        if (!response.ok) {
          if (response.status === 429) {
            const quota = await quotaInformation(response);
            const detail = quotaDescription(quota);
            lastFailure = detail;
            onProgress(detail);
            if (quota.kind === "TPM" && quota.requested > quota.limit && quota.limit != null) {
              lastFailure = `${detail} Un bloque supera el límite por solicitud: requiere dividir el contenido; esperar no lo resuelve.`;
              break;
            }
            if (attempt >= 2 || calls >= plan.limits.maxCalls) continue;
            const delay = rateLimitDelay(response.headers, attempt, plan.limits.intervalMs, quota);
            if (delay > 180000 || rateLimitWait + delay > plan.limits.maxRateLimitWaitMs) {
              lastFailure = `${detail} Espera requerida: ${Math.ceil(delay / 1000)} segundos; supera el presupuesto permitido. Reintentar cuando se libere esta cuota de la organización.`;
              break;
            }
            if (attempt < 2 && calls < plan.limits.maxCalls) {
              nextDelay = delay;
              rateLimitWait += delay;
              onProgress(
                `Recuperación de cuota: esperar ${Math.ceil(delay / 1000)} segundos antes de reintentar el bloque ${index + 1}/${plan.chunks.length}.`,
              );
            }
            continue;
          }
          lastFailure = `Groq devolvió HTTP ${response.status} en una llamada necesaria.`;
          throw new Error("Proveedor no disponible.");
        }
        const json = await response.json();
        addUsage(usage, json);
        stage = "parse";
        if (json.choices?.[0]?.finish_reason === "length") throw new Error("Respuesta truncada.");
        const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "null");
        stage = "validation";
        assessment = validateAssessment(parsed, chunk);
        try {
          for (const part of pending) {
            if (!assessment.limitations.length)
              memory?.set(part, {
                findings: assessment.findings.filter(
                  (f) => f.path === part.path && part.anchors.includes(`${f.side}:${f.line}`),
                ),
                resolutions: assessment.resolutions.filter((r) =>
                  part.followups?.some((t) => t.id === String(r.id)),
                ),
              });
          }
        } catch {
          onProgress("No se pudo guardar la memoria temporal; la evaluación válida se conserva.");
        }
        // A low remaining TPM budget can require a longer pause even after success.
        const remaining = response.headers?.get("x-ratelimit-remaining-tokens");
        if (index < plan.chunks.length - 1 && remaining != null && Number(remaining) < 6000) {
          const reset = durationMs(response.headers.get("x-ratelimit-reset-tokens")) + 1000;
          if (reset > plan.limits.intervalMs && reset <= 180000) {
            if (rateLimitWait + reset > plan.limits.maxRateLimitWaitMs) {
              results.push(merge([...cachedResults, assessment]));
              errors.push("Presupuesto de espera para la cuota de Groq agotado.");
              return finish();
            }
            nextDelay = reset;
            rateLimitWait += reset;
          }
        }
        break;
      } catch (error) {
        /* Keep invalid-result retries bounded separately from recoverable quota errors. */
        if (stage === "validation")
          lastFailure = error instanceof TypeError ? "Estructura JSON inválida." : error.message;
        else if (stage === "parse")
          lastFailure =
            error.message === "Respuesta truncada." ? error.message : "Respuesta JSON inválida.";
        else if (error.name === "TimeoutError" || error.name === "AbortError")
          lastFailure = "La solicitud al proveedor superó el tiempo permitido.";
        onProgress(`Bloque ${index + 1}/${plan.chunks.length}: ${lastFailure}`);
        ordinaryFailures++;
        if (ordinaryFailures >= 2) break;
      }
    }
    if (!assessment) {
      errors.push(
        calls >= plan.limits.maxCalls ? "Presupuesto máximo de llamadas agotado." : lastFailure,
      );
      break;
    }
    results.push(merge([...cachedResults, assessment]));
    onProgress(`Bloque ${index + 1}/${plan.chunks.length} completo; llamadas: ${calls}.`);
  }
  return finish();
}

async function publishFindings({ github, args, sha, botLogin, report }) {
  if (report.sha !== sha || report.findings.length > 5)
    throw new Error("Hallazgos de otro SHA o fuera del límite.");
  const existing = await github.paginate(github.rest.pulls.listReviewComments, {
    ...args,
    per_page: 100,
  });
  const owned = existing.filter((c) => c.user?.login === botLogin && !c.in_reply_to_id);
  const comments = [];
  for (const finding of report.findings) {
    const id = hash(`${finding.path}:${finding.issue_key}`).slice(0, 24);
    const marker = `<!-- ceretime-r2d2-finding:${id} -->`;
    const severity = {
      critical: "Crítico",
      important: "Importante",
      warning: "Advertencia",
      minor: "Observación funcional menor",
    }[finding.severity];
    const body = `${marker}\n### R2D2 · ${severity}\n\n${withoutBold(finding.body)}\n\nVerificado en ${sha}: ${finding.path}:${finding.line} (${finding.side}).`;
    const old = owned.find(
      (c) => (finding.threadId && String(c.id) === finding.threadId) || c.body?.startsWith(marker),
    );
    if (old) {
      // Preserve the root and its human replies. GitHub keeps its original anchor.
      if (old.body !== body)
        await github.rest.pulls.updateReviewComment({
          owner: args.owner,
          repo: args.repo,
          comment_id: old.id,
          body,
        });
    } else comments.push({ path: finding.path, line: finding.line, side: finding.side, body });
  }
  if (comments.length)
    await github.rest.pulls.createReview({
      ...args,
      commit_id: sha,
      event: "COMMENT",
      body: "<!-- ceretime-ai-review-inline-only -->",
      comments,
    });
  for (const resolution of report.resolutions ?? []) {
    const root = owned.find((c) => String(c.id) === String(resolution.id));
    if (!root) throw new Error("No se encontró el hilo revisado.");
    const marker = `<!-- ceretime-r2d2-resolution:${resolution.id}:${hash(JSON.stringify(resolution)).slice(0, 16)} -->`;
    const latest = existing
      .filter(
        (c) =>
          c.user?.login === botLogin &&
          c.in_reply_to_id === root.id &&
          c.body?.startsWith(`<!-- ceretime-r2d2-resolution:${resolution.id}:`),
      )
      .sort((a, b) => b.id - a.id)[0];
    if (latest?.body?.startsWith(marker)) continue;
    const label = {
      resolved: "Resuelto en código",
      not_applicable: "Hallazgo retirado",
      maintain: "Hallazgo pendiente",
      needs_context: "Falta evidencia",
    }[resolution.status];
    await github.rest.pulls.createReplyForReviewComment({
      ...args,
      comment_id: root.id,
      body: `${marker}\n### R2D2 · ${label}\n\n${withoutBold(resolution.explanation)}\n\nComprobación formal: ${sha}.`,
    });
  }
}

module.exports = {
  LIMITS,
  matchesIgnore,
  patchRecords,
  buildPlan,
  validateAssessment,
  aggregate,
  reviewPlan,
  publishFindings,
};
