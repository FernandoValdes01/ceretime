const { publicEvidenceBundle, splitRecoveredChunk } = require("./ai-review-payload.cjs");
const {
  requestKey,
  evidenceRequests: validateEvidenceRequests,
} = require("./ai-review-evidence.cjs");
const { verifyAssessment, publishable, sealFinding } = require("./ai-review-verification.cjs");
const { withoutBold } = require("./ai-review-presentation.cjs");

const { classifyFile, matchesIgnore } = require("./ai-review-selection.cjs");
const {
  hash,
  reviewedBase,
  declarationSymbols,
  changedContractSymbols,
  relevantDeclarations,
  clipContext,
  contentKey,
} = require("./ai-review-context.cjs");

const {
  ENDPOINT,
  completionRequest,
  addUsage,
  emptyUsage,
  tokenBudget,
} = require("./ai-review-provider.cjs");

const REVIEW_PROTOCOL = `Analiza todas las parts recibidas y su interacción. Cada part contiene el diff con [RIGHT:N]/[LEFT:N] y evidenceRefs; evidence contiene código de base/head identificado por ruta y selector. Usa solo las referencias asociadas a cada cambio. baseSameAsHead:true significa que base y head contienen el mismo texto, enviado una vez en head. Los demás bloques se revisan por separado: su ausencia no demuestra falta de cobertura.
Lee diff, declaraciones, helpers y consumidores antes de concluir. baseComplete/headComplete indican archivo completo; declarationComplete indica declaración completa. present con Complete:false es un extracto, not_yet_created/deleted son ausencias demostradas, unavailable es fallo de lectura. El código completo de un archivo nuevo puede estar en su diff.
Solicita código necesario desde Git en evidenceRequests:[{path,symbol o fragment,side:head|base,reason,forPath?:ruta del cambio}]. symbol es un identificador declarado; fragment es una cita literal o nombre exacto de test/paso. scope:file permite pedir un archivo completo. Incluye forPath si hay varios cambios. Nunca describas código recuperable solo en limitations. Hay tres rondas, ocho solicitudes y 16000 caracteres por ronda, con continuaciones automáticas. evidenceRecovery informa disponibilidad y cursor. No repitas una solicitud ya satisfecha. Resuelve pendientes innecesarios solo mediante evidenceResolutions:[{path,symbol o fragment,side,status:not_needed,reason}] para solicitudes recibidas, justificando el flujo comprobado. limitations solo describe incertidumbre concreta que sigue sin resolverse.
La base inmediata de esta PR es la referencia para evaluar el cambio. Una limitación exige un contrato necesario para evaluar estas partes. Cada hallazgo exige cambio causal, impacto observable y corrección necesaria, con base/head y contrato vigente. El contexto sin cambios sirve para verificar, no para reportar defectos preexistentes. Comprueba productores y consumidores; una hipótesis no es un defecto. No ejecutes código. Respeta condiciones de workflows y contratos de versiones fijadas. No inventes errores por ausencia de tests.
Devuelve JSON: {summary:descripción breve del cambio y flujo evaluado,findings:[{path,line,side:RIGHT|LEFT,severity:critical|important|warning|minor,issue_key, cause,impact,fix,threadId?:id previo}],evidenceRequests:[],evidenceResolutions:[],limitations:[],resolutions:[{id,status:resolved|not_applicable|maintain|needs_context,explanation}]}.
Máximo cinco hallazgos, cero válido; cause/impact/fix hasta 240 caracteres, summary hasta 600. Usa coordenadas exactas del diff. En un renombre sin anchors admite scope:pull_request sin line ni side. No devuelvas score/risk. Da una resolución por cada scope.followupThreads: maintain exige findings con threadId y evidencia actual; resolved/not_applicable exige cita actual. evidence_incomplete exige needs_context. Un bloque followupOnly solo verifica sus hilos, sin hallazgos nuevos. Si falta evidencia, no declares completitud ni aprobación.`;

const LIMITS = Object.freeze({
  chunkChars: 48000,
  inputChars: 64000,
  maxChunks: 48,
  // Every planned block gets one primary call; keep a bounded reserve for
  // evidence recovery, retries, and independent finding verification.
  maxCalls: 80,
  totalTokens: 600000,
  outputTokens: 6000,
  intervalMs: 1000,
  maxRateLimitWaitMs: 600000,
});
const severityRank = { critical: 3, important: 2, warning: 1, minor: 0 };
const MAX_LIMITATIONS_PER_BLOCK = 16;
const orderedAnchors = (anchors) =>
  [...new Set(anchors)].sort((a, b) => {
    const [aSide, aLine] = a.split(":");
    const [bSide, bLine] = b.split(":");
    return aSide.localeCompare(bSide) || Number(aLine) - Number(bLine);
  });
const partOrderKey = (part) =>
  `${part.path}\0${orderedAnchors(part.anchors ?? []).join(",")}\0${(part.followups ?? [])
    .map((thread) => thread.id)
    .sort()
    .join(",")}`;
const canShareParts = (a, b) => {
  if (a.path !== b.path) return true;
  if (a.followupOnly || b.followupOnly) return false;
  const first = new Set((a.followups ?? []).map((thread) => String(thread.id)));
  const second = new Set((b.followups ?? []).map((thread) => String(thread.id)));
  if (first.size && second.size && [...first].some((id) => !second.has(id))) return false;
  return first.size + second.size <= 1 || [...first].every((id) => second.has(id));
};

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
  plan.reviewPolicy = {
    reviewStyle: config.review_style ?? "minimal",
    reviewLanguage: config.review_language ?? "es",
    maxComments: config.max_comments ?? 5,
    ignorePaths: [...(config.ignore_paths ?? [])].sort((a, b) => a.localeCompare(b)),
    selection: config.selection ?? {},
  };
  // Reuse spare capacity instead of abandoning a partially filled chunk.
  const bins = [];
  const assignedThreads = new Set();
  const orderedFiles = [...files].sort(
    (a, b) =>
      a.filename.localeCompare(b.filename) ||
      String(a.previous_filename ?? "").localeCompare(String(b.previous_filename ?? "")) ||
      String(a.status ?? "").localeCompare(String(b.status ?? "")),
  );
  for (const original of orderedFiles) {
    let file = original;
    const selection = classifyFile(file, config);
    if (!selection.eligible) {
      plan.skipped.push({ path: file.filename, reason: selection.reason });
      continue;
    }
    plan.files++;
    const routeOnly = file.additions === 0 && file.deletions === 0 && file.status === "renamed";
    if (!file.patch && !routeOnly) {
      plan.issues.push(`Patch no disponible: ${file.filename}`);
      continue;
    }
    let records;
    try {
      records = routeOnly ? [] : patchRecords(file.patch);
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
    plan.chars += (file.patch ?? "").length;
    // Pack whole hunks first. Only oversized hunks are divided at line boundaries.
    const extra = {
      change: {
        oldPath: file.previous_filename ?? (file.status === "added" ? null : file.filename),
        newPath: file.status === "removed" ? null : file.filename,
        contentChanged: !routeOnly,
      },
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
    // Reserve the block-specific excerpt, but account for the largest indivisible
    // patch record so context budgeting cannot reject a line that otherwise fits.
    const largestRecord = Math.max(0, ...records.map(recordSize));
    const blockContextBudget = Math.max(
      0,
      Math.min(24000, limits.chunkChars - metadataSize - largestRecord),
    );
    // The selected context is measured after symbol resolution below. Reserving
    // a whole-file allowance here splits hunks even when their actual excerpts fit.
    const plannedMetadataSize = metadataSize;
    const contextForAnchors = (anchors, maxOwnContextBudget = blockContextBudget) => {
      const rightPatch = anchors
        .filter((anchor) => anchor.startsWith("RIGHT:"))
        .map((anchor) => `@@ -1,0 +${anchor.slice("RIGHT:".length)},1 @@`)
        .join("\n");
      const leftPatch = anchors
        .filter((anchor) => anchor.startsWith("LEFT:"))
        .map((anchor) => `@@ -${anchor.slice("LEFT:".length)},1 +0,0 @@`)
        .join("\n");
      const changedContracts = changedContractSymbols(
        file.before,
        file.after,
        leftPatch,
        rightPatch,
      );
      const dependencySymbols = [
        ...new Set([
          ...declarationSymbols(file.after, rightPatch, "head", "references"),
          ...declarationSymbols(file.before, leftPatch, "base", "references"),
        ]),
      ];
      const contractSet = new Set(changedContracts);
      const consumerSymbols = [
        ...new Set(
          [
            ...declarationSymbols(file.after, rightPatch, "head", "declared"),
            ...declarationSymbols(file.before, leftPatch, "base", "declared"),
          ].filter((symbol) => contractSet.has(symbol)),
        ),
      ];
      const withoutPatchLines = (text, side) => {
        if (file.status === "added" || !text) return text;
        const changedLines = new Set(
          anchors
            .filter((anchor) => anchor.startsWith(`${side}:`))
            .map((anchor) => Number(anchor.slice(side.length + 1))),
        );
        if (!changedLines.size) return text;
        const lines = text.split("\n");
        const numbered = lines.some((line) => /^\d+: /.test(line));
        return lines
          .map((line, index) =>
            !numbered && (text === file.after || text === file.before)
              ? `${index + 1}: ${line}`
              : line,
          )
          .filter((line) => {
            const numbered = line.match(/^(\d+): /);
            return !numbered || !changedLines.has(Number(numbered[1]));
          })
          .join("\n");
      };
      const selectedContext = (file.context ?? []).map((item) => {
        const baseContent = typeof item.base === "string" ? item.base : "";
        const headContent = typeof item.head === "string" ? item.head : "";
        if (!anchors.length)
          return {
            ...item,
            base: baseContent,
            head: headContent,
            evidenceSelector:
              item.evidenceSelector ??
              (item.evidenceSymbols?.length > 0
                ? { symbols: [...new Set(item.evidenceSymbols)].sort((a, b) => a.localeCompare(b)) }
                : { symbol: routeOnly ? "<rename>" : "<file>" }),
          };
        if (
          item.path === file.filename &&
          !file.filename.startsWith(".github/workflows/") &&
          !file.filename.endsWith(".css") &&
          ((file.after?.length ?? 0) > headContent.length ||
            headContent.length > maxOwnContextBudget ||
            (file.before?.length ?? 0) > baseContent.length ||
            baseContent.length > maxOwnContextBudget)
        ) {
          const selectedHead =
            rightPatch &&
            (file.after?.length > headContent.length || headContent.length > maxOwnContextBudget)
              ? relevantDeclarations(
                  file.after,
                  rightPatch,
                  "head",
                  maxOwnContextBudget,
                  [],
                  "definitions",
                  { includeConsumers: changedContracts.length > 0 },
                )
              : headContent;
          const selectedBase =
            (file.before?.length > baseContent.length ||
              baseContent.length > maxOwnContextBudget) &&
            leftPatch
              ? relevantDeclarations(
                  file.before,
                  leftPatch,
                  "base",
                  Math.min(maxOwnContextBudget, 6000),
                  [],
                  "definitions",
                  { includeConsumers: changedContracts.length > 0 },
                )
              : baseContent;
          const head = withoutPatchLines(selectedHead, "RIGHT");
          const base = withoutPatchLines(selectedBase, "LEFT");
          const symbols = [
            ...new Set([
              ...declarationSymbols(file.after, rightPatch, "head", "declared"),
              ...declarationSymbols(file.before, leftPatch, "base", "declared"),
            ]),
          ].sort((a, b) => a.localeCompare(b));
          return {
            ...item,
            base,
            head,
            baseComplete: base === file.before,
            headComplete: head === file.after,
            selection: "declarations_containing_this_block_and_referenced_declarations",
            evidenceSelector:
              item.evidenceSelector ??
              (symbols.length ? { symbols } : { coordinates: orderedAnchors(anchors) }),
          };
        }
        if (
          item.path === file.filename ||
          file.filename.endsWith(".css") ||
          !/\.[cm]?[jt]sx?$/.test(item.path) ||
          file.filename.startsWith(".github/workflows/")
        )
          return {
            ...item,
            base: baseContent,
            head: headContent,
            evidenceSelector:
              item.evidenceSelector ??
              (item.evidenceSymbols?.length
                ? { symbols: [...new Set(item.evidenceSymbols)].sort((a, b) => a.localeCompare(b)) }
                : { coordinates: orderedAnchors(anchors) }),
          };
        const sources = file.contextSources;
        const current = sources?.head?.get(item.path);
        const original = sources?.base?.get(item.basePath ?? item.path);
        if (!current && !original)
          return {
            ...item,
            base: baseContent,
            head: headContent,
            evidenceSelector: { coordinates: orderedAnchors(anchors) },
          };
        const symbols =
          item.relationship === "consumer"
            ? consumerSymbols
            : item.relationship === "both"
              ? [...new Set([...dependencySymbols, ...consumerSymbols])]
              : dependencySymbols;
        if (!symbols.length)
          return {
            ...item,
            base: "",
            head: "",
            baseComplete: original == null,
            headComplete: current == null,
            selection: "no_matching_contract",
            evidenceSelector: { coordinates: orderedAnchors(anchors) },
          };
        const symbolMode =
          item.relationship === "consumer"
            ? "consumers"
            : item.relationship === "both"
              ? "all"
              : "definitions";
        const head =
          current && current.length > headContent.length
            ? relevantDeclarations(
                current,
                undefined,
                "head",
                Math.min(maxOwnContextBudget, 6000),
                symbols,
                symbolMode,
              )
            : headContent;
        const base =
          original && original.length > baseContent.length
            ? relevantDeclarations(
                original,
                undefined,
                "base",
                Math.min(maxOwnContextBudget, 3000),
                symbols,
                symbolMode,
              )
            : baseContent;
        const sameVersion = current === original && current != null;
        if (sameVersion)
          return {
            ...item,
            head,
            base: head,
            headComplete: head === current,
            baseComplete: head === original,
            evidenceSelector: { symbols: [...new Set(symbols)].sort((a, b) => a.localeCompare(b)) },
          };
        if (head === headContent && base === baseContent)
          return {
            ...item,
            base,
            head,
            evidenceSelector: { symbols: [...new Set(symbols)].sort((a, b) => a.localeCompare(b)) },
          };
        return {
          ...item,
          base,
          head,
          baseComplete: original == null || base === original,
          headComplete: current == null || head === current,
          selection: "contracts_matching_changed_symbols",
          evidenceSelector: { symbols: [...new Set(symbols)].sort((a, b) => a.localeCompare(b)) },
        };
      });
      const ownSize = JSON.stringify(
        selectedContext.filter((item) => item.path === file.filename),
      ).length;
      return JSON.parse(clipContext(selectedContext, Math.min(24000, Math.max(12000, ownSize))));
    };
    const hunks = [];
    for (const record of records) {
      if (record.header) hunks.push([]);
      hunks.at(-1).push(record);
    }
    const units = routeOnly ? [[]] : [];
    for (const hunk of hunks) {
      const length = hunk.reduce((n, r) => n + recordSize(r), 0);
      if (length + plannedMetadataSize <= limits.chunkChars) {
        units.push(hunk);
        continue;
      }
      let unit = [],
        unitSize = 0;
      for (const [recordIndex, record] of hunk.entries()) {
        if (
          unitSize + recordSize(record) + plannedMetadataSize > limits.chunkChars &&
          unit.some((item) => item.side) &&
          hunk.slice(recordIndex + 1).some((item) => item.side)
        ) {
          units.push(unit);
          unit = [hunk[0]];
          unitSize = recordSize(hunk[0]);
        }
        unit.push(record);
        unitSize += recordSize(record);
      }
      if (unit.length > 1) units.push(unit);
    }
    const createPart = (unit, ownContextBudget = blockContextBudget) => {
      const patch = unit
        .map((r) => (r.side ? `[${r.side}:${r.line}] ${r.text}` : r.text))
        .join("\n");
      const anchors = unit
        .filter((record) => record.side)
        .map((record) => `${record.side}:${record.line}`);
      return {
        ...extra,
        context: contextForAnchors(anchors, ownContextBudget),
        followups: (file.followups ?? [])
          .filter(
            (t) =>
              !assignedThreads.has(t.id) &&
              (t.currentLine == null ||
                unit.some((r) => r.side === "RIGHT" && Math.abs(r.line - t.currentLine) <= 12)),
          )
          .slice(0, 1),
        path: file.filename,
        previousPath: file.previous_filename,
        status: file.status,
        patch,
        anchors: unit.filter((r) => r.side).map((r) => `${r.side}:${r.line}`),
      };
    };
    const serializedSize = (part) => JSON.stringify(publicEvidenceBundle([part])).length;
    const fitContextBudget = (unit) => {
      const original = createPart(unit);
      const originalSize = serializedSize(original);
      if (originalSize <= limits.chunkChars)
        return { part: original, size: originalSize, contextBudget: blockContextBudget };
      let lower = 0,
        upper = blockContextBudget - 1,
        best = null;
      for (let attempt = 0; attempt < 16 && lower <= upper; attempt++) {
        const contextBudget = Math.floor((lower + upper) / 2);
        const part = createPart(unit, contextBudget);
        const size = serializedSize(part);
        if (size <= limits.chunkChars) {
          best = { part, size, contextBudget };
          lower = contextBudget + 1;
        } else upper = contextBudget - 1;
      }
      return best ?? { part: original, size: originalSize, contextBudget: blockContextBudget };
    };
    const splitToFit = (unit) => {
      const visit = (candidate) => {
        const size = serializedSize(createPart(candidate));
        if (size <= limits.chunkChars)
          return [{ unit: candidate, contextBudget: blockContextBudget }];
        const body = candidate.filter((record) => !record.header);
        const changedIndexes = body.flatMap((record, index) => (record.side ? [index] : []));
        if (changedIndexes.length <= 1) {
          const fitted = fitContextBudget(candidate);
          if (fitted.size <= limits.chunkChars)
            return [{ unit: candidate, contextBudget: fitted.contextBudget }];
          plan.issues.push(`Línea mayor que el presupuesto por bloque: ${file.filename}`);
          return [];
        }
        const splitIndex = changedIndexes[Math.floor(changedIndexes.length / 2)];
        const headers = candidate.filter((record) => record.header);
        const left = [...headers, ...body.slice(0, splitIndex)];
        const right = [...headers, ...body.slice(splitIndex)];
        return [...visit(left), ...visit(right)];
      };
      return visit(unit);
    };
    for (const unit of units) {
      for (const split of splitToFit(unit)) {
        const part = createPart(split.unit, split.contextBudget);
        const partSize = serializedSize(part);
        if (partSize > limits.chunkChars) {
          plan.issues.push(`Bloque mayor que el presupuesto: ${file.filename}`);
          continue;
        }
        for (const thread of part.followups) assignedThreads.add(thread.id);
        // Hunks in one file share their contract context whenever the combined
        // payload fits. Keep at most one formal followup in each part.
        const binSize = (parts) => JSON.stringify(publicEvidenceBundle(parts)).length;
        const mergeCandidates = bins.flatMap((bin) =>
          bin.parts
            .map((previous, partIndex) => ({ bin, previous, partIndex }))
            .filter(
              ({ previous }) =>
                previous.path === part.path &&
                previous.followups.length + part.followups.length <= 1 &&
                canShareParts(previous, part),
            ),
        );
        let combined = false;
        for (const { bin, previous } of mergeCandidates) {
          if (!previous) continue;
          const anchors = [...previous.anchors, ...part.anchors];
          const merged = {
            ...previous,
            patch: `${previous.patch}\n${part.patch}`,
            anchors,
            context: contextForAnchors(anchors),
            followups: [...previous.followups, ...part.followups],
          };
          const nextSize = binSize(bin.parts.map((item) => (item === previous ? merged : item)));
          if (nextSize > limits.chunkChars) continue;
          Object.assign(previous, merged);
          bin.size = nextSize;
          combined = true;
          break;
        }
        if (combined) continue;
        const available = bins
          .map((bin, index) => ({ bin, index, size: binSize([...bin.parts, part]) }))
          .filter(
            ({ bin, size }) =>
              size <= limits.chunkChars && bin.parts.every((item) => canShareParts(item, part)),
          )
          .sort(
            (a, b) =>
              a.size - b.size ||
              a.bin.parts
                .map(partOrderKey)
                .sort()
                .join("\0")
                .localeCompare(b.bin.parts.map(partOrderKey).sort().join("\0")) ||
              a.index - b.index,
          )[0]?.bin;
        if (available) {
          available.parts.push(part);
          available.parts.sort((a, b) => partOrderKey(a).localeCompare(partOrderKey(b)));
          available.size = binSize(available.parts);
        } else bins.push({ parts: [part], size: partSize });
      }
    }
  }
  plan.chunks = bins.map(({ parts }) => ({
    parts: parts.sort((a, b) => partOrderKey(a).localeCompare(partOrderKey(b))),
  }));
  if (plan.chunks.length > limits.maxChunks)
    plan.issues.push("Presupuesto máximo de bloques agotado.");

  return plan;
}

function validateAssessment(data, chunk, { isolateInvalidFindings = false } = {}) {
  if (!data || !Array.isArray(data.findings) || data.findings.length > 5)
    throw new Error("Respuesta de bloque inválida.");
  if (Object.hasOwn(data, "score") || Object.hasOwn(data, "risk"))
    throw new Error("El modelo no decide la nota ni el riesgo.");
  const limitations = data.limitations ?? [];
  if (
    !Array.isArray(limitations) ||
    limitations.length > MAX_LIMITATIONS_PER_BLOCK ||
    limitations.some((l) => typeof l !== "string" || !l.trim() || l.length > 800)
  )
    throw new Error("Limitaciones inválidas.");
  const evidenceRequests = validateEvidenceRequests(data.evidenceRequests);
  const evidenceResolutions = validateEvidenceRequests(data.evidenceResolutions);
  if (
    evidenceRequests.some(
      (request) =>
        request.forPath != null &&
        !chunk.parts.some(
          (part) =>
            part.path === request.forPath ||
            part.change?.oldPath === request.forPath ||
            part.previousPath === request.forPath,
        ),
    )
  )
    throw new Error("Ruta de cambio asociada a evidencia desconocida.");
  if (
    evidenceRequests.some(
      (request) =>
        request.cursor != null &&
        !chunk.parts.some((part) =>
          part.evidenceRecovery?.some(
            (old) => requestKey(old) === requestKey(request) && old.cursor === request.cursor,
          ),
        ),
    )
  )
    throw new Error("Cursor de evidencia desconocido.");
  if (
    evidenceResolutions.some(
      (request) =>
        request.status !== "not_needed" ||
        !chunk.parts.some((part) =>
          part.evidenceRecovery?.some((old) => requestKey(old) === requestKey(request)),
        ),
    )
  )
    throw new Error("Resolución de evidencia desconocida o inválida.");
  const rejectedFindings = [];
  const findings = data.findings.flatMap((finding, index) => {
    try {
      const part = chunk.parts.find(
        (p) =>
          p.path === finding.path &&
          (finding.scope === "pull_request"
            ? !p.anchors.length && p.status === "renamed"
            : p.anchors.includes(`${finding.side}:${finding.line}`)),
      );
      if (
        !part ||
        (finding.scope !== "pull_request" &&
          (!Number.isInteger(finding.line) || finding.line <= 0)) ||
        (finding.scope === "pull_request" && (finding.line != null || finding.side != null)) ||
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
      if (
        /^(?:(?:ningún|ninguno|ninguna)(?: impacto)? funcional|ningún impacto|sin impacto funcional|none\b|no functional impact)/i.test(
          finding.impact.trim(),
        ) ||
        /^(?:no requiere (?:cambio|corrección)|no (?:change|fix) (?:is )?(?:required|needed))/i.test(
          finding.fix.trim(),
        )
      )
        throw new Error(
          "Un hallazgo exige impacto funcional y una corrección necesaria; las observaciones sin defecto deben omitirse.",
        );
      const issueKey = finding.issue_key
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      if (!issueKey) throw new Error("Identidad de hallazgo inválida.");
      if (finding.threadId && !part.followups?.some((t) => t.id === String(finding.threadId)))
        throw new Error("Hilo desconocido.");
      if (part.followupOnly && !finding.threadId)
        throw new Error("Un seguimiento no admite hallazgos nuevos.");
      return [
        {
          ...finding,
          issue_key: issueKey,
          threadId: finding.threadId ? String(finding.threadId) : undefined,
          body: `Cambio que causa el problema: ${finding.cause}\n\nImpacto: ${finding.impact}\n\nCorrección propuesta: ${finding.fix}`,
        },
      ];
    } catch (error) {
      if (!isolateInvalidFindings || error.message.startsWith("Un hallazgo exige")) throw error;
      rejectedFindings.push({
        index,
        path: finding?.path,
        reason: error instanceof TypeError ? "Estructura inválida." : error.message,
      });
      return [];
    }
  });
  const expected = new Set(chunk.parts.flatMap((p) => (p.followups ?? []).map((t) => t.id)));
  const rawResolutions = data.resolutions ?? [];
  const resolutions = Array.isArray(rawResolutions)
    ? rawResolutions.map((resolution) =>
        rejectedFindings.length &&
        resolution.status === "maintain" &&
        !findings.some((finding) => finding.threadId === String(resolution.id))
          ? {
              ...resolution,
              status: "needs_context",
              explanation: "El candidato del hilo no tiene un formato válido.",
            }
          : resolution,
      )
    : rawResolutions;
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
      throw new Error(
        `Mantener el hilo ${id} exige un objeto en findings con threadId ${id} y coordenadas vigentes, cause, impact, fix, issue_key y severity. Una resolución maintain por sí sola no aporta ese hallazgo.`,
      );
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
    limitations: [
      ...limitations,
      ...rejectedFindings.map(
        (finding) => `Candidato inválido ${finding.index + 1}: ${finding.reason}`,
      ),
    ],
    evidenceRequests,
    evidenceResolutions,
    rejectedFindings,
    changeSummary: typeof data.summary === "string" ? withoutBold(data.summary).slice(0, 600) : "",
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
    const key =
      duplicate?.[0] ??
      `${finding.path}:${finding.scope === "pull_request" ? finding.issue_key : `${finding.side}:${finding.line}`}`;
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
  const reasons = [
    ...plan.issues,
    ...errors,
    ...results.flatMap((r) => r.limitations ?? []),
    ...results.flatMap((r) =>
      (r.evidenceRequests ?? []).map(
        (request) =>
          `Falta evidencia: ${request.path}, ${request.symbol ?? request.fragment ?? "archivo completo"}: ${request.reason}`,
      ),
    ),
  ];
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
  const score = coverage === "complete" ? (rank < 0 ? 5 : 4 - rank) : null;
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
    baseRef: plan.baseRef,
    mergeBase: plan.mergeBase,
    discussionKey: plan.discussionKey,
    coverage,
    score,
    risk,
    findings,
    resolutions,
    skipped: plan.skipped ?? [],
    totalFindings: allFindings.length,
    summary:
      coverage === "complete"
        ? `Confidence Score: ${score}/5; Risk: ${risk}; Reviewed commit: ${plan.sha}; Hallazgos: ${findings.length}; Resumen: ${explanation}`
        : `Review status: incomplete; Risk: ${risk}; Reviewed commit: ${plan.sha}; Hallazgos: ${findings.length}; Resumen: ${explanation}`,
    processed: results.length,
    total: plan.chunks.length,
    calls,
    reasons,
    changeSummaries: [...new Set(results.map((r) => r.changeSummary).filter(Boolean))],
    files: [
      ...new Set(plan.chunks.flatMap((chunk) => (chunk.parts ?? []).map((part) => part.path))),
    ].map((path) => {
      const units = plan.chunks.flatMap((chunk, index) =>
        (chunk.parts ?? []).filter((part) => part.path === path).map(() => results[index]),
      );
      return {
        path,
        coverage: units.every(
          (result) =>
            result &&
            !(
              result.limitations?.length ||
              result.evidenceRequests?.length ||
              result.resolutions?.some((resolution) => resolution.status === "needs_context")
            ),
        )
          ? "complete"
          : "incomplete",
      };
    }),
    missingEvidence: results.flatMap((r) => r.evidenceRequests ?? []),
    limitations: results.flatMap((r) => r.limitations ?? []),
    infrastructure: errors,
    planningIssues: plan.issues,
    qualityScore: coverage === "complete" ? score : null,
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
  return `OpenRouter HTTP 429: ${kind}${metrics ? ` (${metrics})` : ""}.`;
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
  verify = verifyAssessment,
  recoverContext,
  resolveEvidence,
}) {
  if (!apiKey && plan.chunks.length) throw new Error("Falta el secret del proveedor.");
  const results = [],
    errors = [],
    cacheGroups = new Map();
  const hasStableEvidenceDependencies = (part) =>
    (part.evidenceDependencies ?? []).every((item) => ["present", "absent"].includes(item.status));
  const mergeEvidenceDependencies = (part, dependencies = []) => {
    part.evidenceDependencies = [
      ...new Map(
        [...(part.evidenceDependencies ?? []), ...dependencies].map((item) => [
          JSON.stringify([item.path, item.side, item.ref, item.status, item.hash, item.forPath]),
          item,
        ]),
      ).values(),
    ];
  };
  let calls = 0,
    rateLimitWait = 0,
    nextDelay = 0,
    reused = 0;
  const usage = emptyUsage();
  const budget = tokenBudget(plan.limits.totalTokens ?? LIMITS.totalTokens);
  const fetchProvider = fetchImpl;
  fetchImpl = async (url, request) => {
    const settle = budget.reserve(request.body);
    calls++;
    const response = await fetchProvider(url, request);
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      json: async () => {
        const json = await response.json();
        settle(json);
        addUsage(usage, json);
        return json;
      },
    };
  };
  const finish = () => ({
    ...aggregate(plan, results, calls, errors),
    reused,
    usage,
    tokenBudget: { limit: plan.limits.totalTokens ?? LIMITS.totalTokens, charged: budget.spent },
  });
  if (!(await isCurrent())) {
    errors.push("Cambió el head, la base o la elegibilidad durante la revisión.");
    return finish();
  }
  if (plan.issues.length) return finish();
  for (let index = 0; index < plan.chunks.length; index++) {
    const originalChunk = plan.chunks[index];
    const cachedResults = [],
      pending = [];
    for (const part of originalChunk.parts) {
      try {
        const cached = memory?.get(part);
        if (!cached) {
          pending.push(part);
          continue;
        }
        mergeEvidenceDependencies(part, cached.evidenceDependencies);
        if (cached.findings.some((f) => !f.verification))
          throw new Error("Memoria sin verificación.");
        cached.findings = cached.findings.map((f) =>
          sealFinding(f, f.verification.evidence, plan.sha),
        );
        const cachedAssessment = validateAssessment(cached, { parts: [part] });
        cachedResults.push(cachedAssessment);
        const group = cacheGroups.get(part.cacheGroupId);
        if (group) {
          mergeEvidenceDependencies(group.originPart, part.evidenceDependencies);
          group.assessments.push(cachedAssessment);
        }
        reused++;
      } catch {
        pending.push(part);
      }
    }
    if (!(await isCurrent())) {
      errors.push("Cambió el head, la base o la elegibilidad durante la revisión.");
      return finish();
    }
    const merge = (items) => ({
      findings: items.flatMap((r) => r.findings),
      resolutions: [
        ...new Map(
          items.flatMap((r) => r.resolutions ?? []).map((r) => [String(r.id), r]),
        ).values(),
      ],
      changeSummary: [...new Set(items.map((r) => r.changeSummary).filter(Boolean))]
        .join(" ")
        .slice(0, 600),
      limitations: items.flatMap((r) => r.limitations ?? []),
      evidenceRequests: items.flatMap((r) => r.evidenceRequests ?? []),
    });
    const persistRecoveredCacheGroups = () => {
      const persist = (id) => {
        const group = cacheGroups.get(id);
        if (!group || group.assessments.length !== group.expected) return;
        const combined = merge(group.assessments);
        cacheGroups.delete(id);
        try {
          if (hasStableEvidenceDependencies(group.originPart) && memory)
            memory.set(group.originPart, combined);
        } catch {
          onProgress("No se pudo guardar la memoria temporal; la evaluación válida se conserva.");
        }
        if (!group.parentId) return;
        const parent = cacheGroups.get(group.parentId);
        if (!parent) return;
        mergeEvidenceDependencies(parent.originPart, group.originPart.evidenceDependencies);
        parent.assessments.push(combined);
        persist(group.parentId);
      };
      for (const id of cacheGroups.keys()) {
        persist(id);
      }
    };
    const recordCacheAssessment = (id, assessment, part) => {
      const group = cacheGroups.get(id);
      if (!group) return;
      mergeEvidenceDependencies(group.originPart, part.evidenceDependencies);
      group.assessments.push(assessment);
      persistRecoveredCacheGroups();
    };
    if (!pending.length) {
      persistRecoveredCacheGroups();
      results.push(merge(cachedResults));
      onProgress(
        `Bloque ${index + 1}/${plan.chunks.length} recuperado de memoria de contenido y contexto.`,
      );
      continue;
    }
    let chunk = { parts: pending };
    let recoveryRounds = 0;
    let restart = false;
    const refs = { base: plan.base, mergeBase: plan.mergeBase, headRef: plan.sha };
    const outstanding = new Map(
      pending.flatMap((part) =>
        (part.evidenceRecovery ?? [])
          .filter((request) => request.availability !== "present")
          .map((request) => [requestKey(request), request]),
      ),
    );
    const restartWithPartitions = (sourceChunk, fits, reason) => {
      const queuedRequests = new Map(outstanding);
      const recoveryRequestsByPart = [];
      const partitionSource = {
        ...sourceChunk,
        parts: sourceChunk.parts.map((sourcePart, partIndex) => {
          recoveryRequestsByPart[partIndex] = (sourcePart.evidenceRecovery ?? []).filter(
            (request) => request.availability !== "present",
          );
          for (const request of recoveryRequestsByPart[partIndex])
            queuedRequests.set(requestKey(request), request);
          const { evidenceRecovery: _evidenceRecovery, ...part } = sourcePart;
          return { ...part, evidenceRecovery: recoveryRequestsByPart[partIndex] };
        }),
      };
      const origins = partitionSource.parts.map((sourcePart, partIndex) => {
        const originalPart = pending[partIndex];
        if (!originalPart) return null;
        const parentId = originalPart.cacheGroupId;
        const id = hash(
          JSON.stringify([
            plan.sha,
            index,
            partIndex,
            contentKey(originalPart),
            parentId,
            recoveryRounds,
          ]),
        );
        sourcePart.cacheGroupId = id;
        return { id, originalPart, parentId };
      });
      const partitions = splitRecoveredChunk(partitionSource, plan.limits.chunkChars, {
        refs,
        fits,
      });
      if (
        !partitions ||
        plan.chunks.length - 1 + partitions.length > plan.limits.maxChunks ||
        calls + partitions.length > plan.limits.maxCalls
      )
        return false;
      for (const origin of origins)
        if (origin)
          cacheGroups.set(origin.id, {
            originPart: origin.originalPart,
            parentId: origin.parentId,
            expected: 0,
            assessments: [],
          });
      for (const part of partitions.flatMap((partition) => partition.parts)) {
        const group = cacheGroups.get(part.cacheGroupId);
        if (group) group.expected++;
      }
      const partitionParts = partitions.flatMap((partition) => partition.parts);
      for (const request of queuedRequests.values()) {
        const associated = request.forPath
          ? partitionParts.find(
              (part) => part.path === request.forPath || part.change?.oldPath === request.forPath,
            )
          : partitionParts.find(
              (part) => part.path === request.path || part.change?.oldPath === request.path,
            );
        const target = associated ?? partitionParts[0];
        if (target)
          target.evidenceRecovery = [
            ...new Map(
              [...(target.evidenceRecovery ?? []), request].map((item) => [requestKey(item), item]),
            ).values(),
          ];
      }
      partitions[0].parts.unshift(...originalChunk.parts.filter((part) => !pending.includes(part)));
      reused -= cachedResults.length;
      plan.chunks.splice(index, 1, ...partitions);
      restart = true;
      onProgress(`Bloque ${index + 1}: ${reason}; dividido en ${partitions.length} bloques.`);
      return true;
    };
    const attemptedEvidenceRequests = new Set();
    const recover = async (requests) => {
      if (
        !requests?.length ||
        !recoverContext ||
        recoveryRounds >= 3 ||
        calls >= plan.limits.maxCalls ||
        !(await isCurrent())
      )
        return false;
      for (const request of requests) outstanding.set(requestKey(request), request);
      const pendingRequests = [...outstanding.values()];
      const freshRequests = pendingRequests.filter(
        (request) => !attemptedEvidenceRequests.has(requestKey(request)),
      );
      recoveryRounds++;
      const batch = (freshRequests.length ? freshRequests : pendingRequests).slice(0, 8);
      for (const request of batch) attemptedEvidenceRequests.add(requestKey(request));
      const recovery = await recoverContext({ chunk, requests: batch });
      for (const [partIndex, recoveredPart] of recovery.chunk.parts.entries()) {
        const part = pending[partIndex];
        if (!part) continue;
        part.evidenceDependencies = [
          ...new Map(
            [
              ...(part.evidenceDependencies ?? []),
              ...(recoveredPart.evidenceDependencies ?? []),
            ].map((dependency) => [
              JSON.stringify([
                dependency.path,
                dependency.side,
                dependency.ref,
                dependency.status,
                dependency.hash,
                dependency.forPath,
              ]),
              dependency,
            ]),
          ).values(),
        ];
      }
      for (const request of recovery.unresolved ?? [])
        outstanding.set(requestKey(request), request);
      const unresolvedKeys = new Set((recovery.unresolved ?? []).map(requestKey));
      for (const request of batch)
        if (!unresolvedKeys.has(requestKey(request))) outstanding.delete(requestKey(request));
      if (
        JSON.stringify(publicEvidenceBundle(recovery.chunk.parts, refs)).length >
        plan.limits.chunkChars
      ) {
        if (
          !restartWithPartitions(
            recovery.chunk,
            (parts) =>
              JSON.stringify(publicEvidenceBundle(parts, refs)).length <= plan.limits.chunkChars,
            "recuperación de evidencia",
          )
        )
          onProgress(
            `Bloque ${index + 1}: recuperación de ${JSON.stringify(publicEvidenceBundle(recovery.chunk.parts, refs)).length} caracteres no cabe en ${plan.limits.chunkChars}; no queda una partición segura dentro del presupuesto.`,
          );
        return false;
      }
      chunk = recovery.chunk;
      onProgress(`Bloque ${index + 1}: evidencia recuperada; ronda ${recoveryRounds}/3.`);
      return true;
    };
    let assessment,
      candidate,
      lastFailure = "Una llamada necesaria falló o devolvió un resultado inválido.";
    let ordinaryFailures = 0;
    for (let attempt = 0; attempt < 3 && calls < plan.limits.maxCalls; attempt++) {
      let stage = "request";
      if (!(await isCurrent())) {
        errors.push("Cambió el head, la base o la elegibilidad durante la revisión.");
        return finish();
      }
      if (calls) await sleep(Math.max(plan.limits.intervalMs, nextDelay));
      nextDelay = 0;
      if (!(await isCurrent())) {
        errors.push("Cambió el head, la base o la elegibilidad durante la revisión.");
        return finish();
      }
      try {
        const body = JSON.stringify(
          completionRequest(
            [
              {
                role: "system",
                content: `${instructions}\n${REVIEW_PROTOCOL}${ordinaryFailures ? `\nLa respuesta anterior fue rechazada: ${lastFailure}. Repara solo el protocolo; conserva el análisis válido y su incertidumbre.` : ""}`,
              },
              {
                role: "user",
                content: JSON.stringify({
                  sha: plan.sha,
                  base: plan.base,
                  baseRef: plan.baseRef,
                  intent: plan.intent,
                  scope: {
                    block: index + 1,
                    totalBlocks: plan.chunks.length,
                    paths: [...new Set((chunk.parts ?? []).map((part) => part.path))],
                    followupThreads: chunk.parts.flatMap((part) =>
                      (part.followups ?? []).map((thread) => ({
                        id: thread.id,
                        path: part.path,
                        currentLine: thread.currentLine,
                      })),
                    ),
                  },
                  ...publicEvidenceBundle(chunk.parts, {
                    base: plan.base,
                    mergeBase: plan.mergeBase,
                    headRef: plan.sha,
                  }),
                }),
              },
            ],
            plan.limits.outputTokens,
          ),
        );
        if (body.length > plan.limits.inputChars) {
          const envelope = JSON.parse(body);
          const originalUser = JSON.parse(envelope.messages[1].content);
          const requestSize = (parts) => {
            const bundle = publicEvidenceBundle(parts, refs);
            const payload = {
              ...originalUser,
              scope: {
                ...originalUser.scope,
                paths: [...new Set(parts.map((part) => part.path))],
                followupThreads: parts.flatMap((part) =>
                  (part.followups ?? []).map((thread) => ({
                    id: thread.id,
                    path: part.path,
                    currentLine: thread.currentLine,
                  })),
                ),
              },
              ...bundle,
            };
            const messages = envelope.messages.map((message, messageIndex) =>
              messageIndex === 1 ? { ...message, content: JSON.stringify(payload) } : message,
            );
            return JSON.stringify({ ...envelope, messages }).length;
          };
          const fits = (parts) =>
            JSON.stringify(publicEvidenceBundle(parts, refs)).length <= plan.limits.chunkChars &&
            requestSize(parts) <= plan.limits.inputChars;
          if (
            restartWithPartitions(
              { ...chunk, parts: chunk.parts.map((part) => ({ ...part })) },
              fits,
              "solicitud completa supera el presupuesto con instrucciones y JSON",
            )
          )
            break;
          errors.push("Presupuesto de entrada por llamada agotado.");
          assessment = {
            findings: [],
            resolutions: [],
            limitations: [
              "La solicitud completa no cabe en el presupuesto y no hay una partición segura.",
            ],
            evidenceRequests: [...outstanding.values()],
          };
          break;
        }
        const response = await fetchImpl(ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(180000),
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
          lastFailure = `OpenRouter devolvió HTTP ${response.status} en una llamada necesaria.`;
          throw new Error("Proveedor no disponible.");
        }
        const json = await response.json();
        if (!(await isCurrent())) {
          errors.push("Cambió el head, la base o la elegibilidad durante la revisión.");
          return finish();
        }
        stage = "parse";
        if (json.choices?.[0]?.finish_reason === "length") {
          const reasoning = json.usage?.completion_tokens_details?.reasoning_tokens;
          const content = json.choices[0].message?.content;
          onProgress(
            `Salida truncada: límite ${plan.limits.outputTokens} tokens; razonamiento ${Number.isInteger(reasoning) && reasoning >= 0 ? reasoning : "no disponible"}; JSON recibido ${typeof content === "string" ? content.length : 0} caracteres.`,
          );
          throw new Error("Respuesta truncada.");
        }
        const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "null");
        stage = "validation";
        candidate = validateAssessment(parsed, chunk, { isolateInvalidFindings: true });
        for (const finding of candidate.rejectedFindings)
          onProgress(
            `Candidato ${finding.index + 1} inválido en bloque ${index + 1}; se conservan los demás: ${finding.reason}`,
          );
        if (candidate.limitations.length && resolveEvidence) {
          const resolved = resolveEvidence({ chunk, limitations: candidate.limitations });
          candidate.evidenceRequests = [
            ...new Map(
              [...candidate.evidenceRequests, ...resolved.requests].map((request) => [
                requestKey(request),
                request,
              ]),
            ).values(),
          ];
          candidate.limitations = resolved.limitations;
          if (resolved.requests.length)
            onProgress(
              `Bloque ${index + 1}: ${resolved.requests.length} solicitudes estructuradas recuperadas desde limitaciones de código.`,
            );
        }
        for (const request of candidate.evidenceResolutions) {
          outstanding.delete(requestKey(request));
          for (const part of chunk.parts)
            part.evidenceRecovery = (part.evidenceRecovery ?? []).filter(
              (old) => requestKey(old) !== requestKey(request),
            );
        }
        candidate.evidenceRequests = [
          ...new Map(
            [...candidate.evidenceRequests, ...outstanding.values()].map((request) => [
              requestKey(request),
              request,
            ]),
          ).values(),
        ];
        if (await recover(candidate.evidenceRequests)) {
          attempt--;
          continue;
        }
        if (restart) break;
        stage = "verification";
        if (candidate.findings.length && calls < plan.limits.maxCalls)
          await sleep(plan.limits.intervalMs);
        const verified = await verify({
          assessment: candidate,
          chunk,
          sha: plan.sha,
          fetchImpl: async (...args) => {
            for (let retry = 0; retry < 3; retry++) {
              if (calls >= plan.limits.maxCalls || !(await isCurrent()))
                throw new Error("No queda presupuesto o vigencia para verificar.");
              const verificationResponse = await fetchImpl(...args);
              if (verificationResponse.status !== 429) return verificationResponse;
              const quota = await quotaInformation(verificationResponse);
              onProgress(quotaDescription(quota));
              const delay = rateLimitDelay(
                verificationResponse.headers,
                retry,
                plan.limits.intervalMs,
                quota,
              );
              if (
                retry === 2 ||
                calls >= plan.limits.maxCalls ||
                delay > 180000 ||
                rateLimitWait + delay > plan.limits.maxRateLimitWaitMs ||
                (quota.kind === "TPM" && quota.requested > quota.limit && quota.limit != null)
              )
                throw new Error(
                  "No se puede recuperar la cuota dentro del presupuesto de verificación.",
                );
              rateLimitWait += delay;
              await sleep(delay);
            }
            throw new Error("Verificación sin respuesta.");
          },
          apiKey,
          budget: plan.limits.maxCalls - calls,
          limits: plan.limits,
          isCurrent,
          sleep,
          refs: { base: plan.base, mergeBase: plan.mergeBase, headRef: plan.sha },
        });
        assessment = verified.assessment;
        if (assessment.limitations.length && resolveEvidence) {
          const resolved = resolveEvidence({ chunk, limitations: assessment.limitations });
          assessment.evidenceRequests = [
            ...new Map(
              [...(assessment.evidenceRequests ?? []), ...resolved.requests].map((request) => [
                requestKey(request),
                request,
              ]),
            ).values(),
          ];
          assessment.limitations = resolved.limitations;
        }
        assessment.evidenceRequests = [
          ...new Map(
            [...outstanding.values(), ...(assessment.evidenceRequests ?? [])].map((request) => [
              requestKey(request),
              request,
            ]),
          ).values(),
        ];
        if (await recover(assessment.evidenceRequests)) {
          attempt--;
          continue;
        }
        if (restart) break;
        try {
          for (const part of pending) {
            const complete = !assessment.limitations.length && !assessment.evidenceRequests?.length;
            const partAssessment = {
              changeSummary: assessment.changeSummary,
              findings: assessment.findings.filter(
                (f) =>
                  f.path === part.path &&
                  (f.scope === "pull_request" || part.anchors.includes(`${f.side}:${f.line}`)),
              ),
              resolutions: assessment.resolutions.filter((r) =>
                part.followups?.some((t) => t.id === String(r.id)),
              ),
            };
            if (complete && (!recoveryRounds || hasStableEvidenceDependencies(part)) && memory)
              memory.set(part, partAssessment);
            const group = cacheGroups.get(part.cacheGroupId);
            if (!complete || !group) continue;
            recordCacheAssessment(part.cacheGroupId, partAssessment, part);
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
              errors.push("Presupuesto de espera para la cuota de OpenRouter agotado.");
              return finish();
            }
            nextDelay = reset;
            rateLimitWait += reset;
          }
        }
        break;
      } catch (error) {
        if (error.message === "Presupuesto total de tokens agotado.") {
          lastFailure = error.message;
          break;
        }
        if (stage === "verification") {
          const known =
            /^(La evidencia de verificación supera|Decisiones de verificación inválidas|La verificación del proveedor no está disponible|La verificación no está completa|No queda presupuesto|No se puede recuperar la cuota|Solicitud de evidencia inválida|Solicitudes de evidencia fuera)/.test(
              error.message,
            );
          const cause = known
            ? error.message
            : error.name === "SyntaxError"
              ? "Respuesta JSON inválida en la verificación."
              : error.name === "TimeoutError" || error.name === "AbortError"
                ? "La verificación superó el tiempo permitido."
                : "La verificación no se completó; consultar el contrato y los logs.";
          errors.push(`Incidente del revisor: ${cause}`);
          onProgress(`Bloque ${index + 1}: ${cause}`);
          assessment = {
            ...candidate,
            findings: [],
            resolutions: candidate.resolutions.map((r) =>
              r.status === "maintain"
                ? {
                    ...r,
                    status: "needs_context",
                    explanation: "La verificación del hallazgo no se completó.",
                  }
                : r,
            ),
            limitations: [
              ...candidate.limitations,
              "La verificación de candidatos no se completó; se conserva cobertura incompleta.",
            ],
          };
          break;
        }
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
    if (restart) {
      index--;
      continue;
    }
    if (!assessment) {
      const callsExhausted = calls >= plan.limits.maxCalls;
      const exhausted = callsExhausted || lastFailure === "Presupuesto total de tokens agotado.";
      const cause = callsExhausted ? "Presupuesto máximo de llamadas agotado." : lastFailure;
      errors.push(cause);
      if (exhausted) break;
      results.push(
        merge([
          ...cachedResults,
          {
            findings: [],
            resolutions: [],
            limitations: [`Bloque incompleto por incidente del revisor: ${cause}`],
            evidenceRequests: [...outstanding.values()],
          },
        ]),
      );
      onProgress(
        `Bloque ${index + 1}/${plan.chunks.length} incompleto por incidente del revisor; se continúan los demás bloques.`,
      );
      continue;
    }
    results.push(merge([...cachedResults, assessment]));
    onProgress(
      `Bloque ${index + 1}/${plan.chunks.length} ${assessment.limitations?.length || assessment.evidenceRequests?.length ? "procesado con evidencia pendiente" : "completo"}; llamadas: ${calls}.`,
    );
  }
  if (!(await isCurrent()))
    errors.push("Cambió el head, la base o la elegibilidad durante la revisión.");
  return finish();
}

async function publishFindings({
  github,
  args,
  sha,
  botLogin,
  report,
  isCurrent = async () => true,
}) {
  const requireCurrent = async () => {
    if (!(await isCurrent())) throw new Error("La revisión ya no está vigente.");
  };
  if (
    report.sha !== sha ||
    report.findings.length > 5 ||
    report.findings.some((f) => !publishable(f, sha))
  )
    throw new Error("Hallazgos de otro SHA o fuera del límite.");
  const existing = await github.paginate(github.rest.pulls.listReviewComments, {
    ...args,
    per_page: 100,
  });
  const owned = existing.filter((c) => c.user?.login === botLogin && !c.in_reply_to_id);
  const comments = [],
    general = [];
  for (const finding of report.findings) {
    const id = hash(`${finding.path}:${finding.issue_key}`).slice(0, 24);
    const marker = `<!-- ceretime-r2d2-finding:${id} -->`;
    const severity = {
      critical: "Crítico",
      important: "Importante",
      warning: "Advertencia",
      minor: "Observación funcional menor",
    }[finding.severity];
    let body = `${marker}\n### R2D2 · ${severity}\n\n${withoutBold(finding.body)}\n\nVerificado en ${sha}: ${finding.scope === "pull_request" ? `${finding.path} (cambio de ruta)` : `${finding.path}:${finding.line} (${finding.side})`}.`;
    const evidence = finding.verification.evidence;
    if (typeof evidence.input === "string")
      body += `\n\nEntrada: ${withoutBold(evidence.input)}\n\nResultado actual: ${withoutBold(evidence.actual)}\n\nResultado esperado: ${withoutBold(evidence.expected)}\n\nTraza: ${withoutBold(evidence.trace)}\n\nComprobaciones: ${withoutBold(evidence.counterevidence)}`;
    if (evidence.expectedContract)
      body += `\n\nContrato esperado (${withoutBold(evidence.expectedContract.path)}): ${withoutBold(evidence.expectedContract.rule)}\n\nCita: ${withoutBold(evidence.expectedContract.quote)}\n\nEfecto posterior: ${withoutBold(evidence.impactTrace)}`;
    if (finding.scope === "pull_request") {
      general.push(body);
      continue;
    }
    const old = owned.find(
      (c) => (finding.threadId && String(c.id) === finding.threadId) || c.body?.startsWith(marker),
    );
    const originalBase = old ? reviewedBase(old.body) : report.mergeBase;
    if (/^[a-f0-9]{40}$/.test(originalBase ?? ""))
      body += `\n\n<!-- ceretime-r2d2-base:${originalBase} -->`;
    if (old) {
      // Preserve the root and its human replies. GitHub keeps its original anchor.
      if (old.body !== body) {
        await requireCurrent();
        await github.rest.pulls.updateReviewComment({
          owner: args.owner,
          repo: args.repo,
          comment_id: old.id,
          body,
        });
      }
    } else comments.push({ path: finding.path, line: finding.line, side: finding.side, body });
  }
  if (general.length || report.coverage === "complete") {
    const reviews = await github.paginate(github.rest.pulls.listReviews, {
      ...args,
      per_page: 100,
    });
    const ownedGeneral = reviews.filter(
      (review) =>
        review.user?.login === botLogin &&
        review.body?.startsWith("<!-- ceretime-r2d2-general-findings -->"),
    );
    const previous = ownedGeneral.find((review) => review.commit_id === sha);
    for (const review of ownedGeneral) {
      if (general.length && review.id === previous?.id) continue;
      if (report.coverage !== "complete" && review.commit_id === sha) continue;
      await requireCurrent();
      await github.rest.pulls.updateReview({
        ...args,
        review_id: review.id,
        body: `<!-- ceretime-r2d2-general-history -->\nRevisión general sustituida por la comprobación formal de ${sha}. Consultar el informe vigente.\n\n<details>\n<summary>Evidencia histórica</summary>\n\n${review.body}\n\n</details>`,
      });
    }
    if (general.length) {
      const body = `<!-- ceretime-r2d2-general-findings -->\n${general.join("\n\n")}`;
      await requireCurrent();
      if (previous) await github.rest.pulls.updateReview({ ...args, review_id: previous.id, body });
      else
        await github.rest.pulls.createReview({ ...args, commit_id: sha, event: "COMMENT", body });
    }
  }
  if (comments.length) {
    await requireCurrent();
    await github.rest.pulls.createReview({
      ...args,
      commit_id: sha,
      event: "COMMENT",
      body: "<!-- ceretime-ai-review-inline-only -->",
      comments,
    });
  }
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
    await requireCurrent();
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
