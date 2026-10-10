const { hash } = require("./ai-review-context.cjs");
const { mergeRecoveredContext } = require("./ai-review-evidence.cjs");

function ordered(values = []) {
  return [...new Set(values)].sort((a, b) => {
    const [aSide, aLine] = String(a).split(":");
    const [bSide, bLine] = String(b).split(":");
    return aSide.localeCompare(bSide) || Number(aLine) - Number(bLine);
  });
}

function selectorFor(item, part) {
  const selected =
    item.evidenceSelector ??
    (item.evidenceSymbols?.length
      ? { symbols: [...new Set(item.evidenceSymbols)].sort((a, b) => a.localeCompare(b)) }
      : null);
  if (selected?.symbols?.length) {
    // Aliases and namespace members can resolve to the same declaration. Use
    // the names declared in the selected excerpt so equivalent references share
    // one identity while retaining the actual symbol that identifies the code.
    const declarations = new Set(
      [
        ...`${item.base ?? ""}\n${item.head ?? ""}`
          .replace(/^\d+: /gm, "")
          .matchAll(
            /^\s*(?:(?:export|declare|default|abstract|async)\s+)*(?:const|let|var|function|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/gm,
          ),
      ].map((match) => match[1]),
    );
    const symbols = selected.symbols.filter((symbol) => declarations.has(symbol));
    if (symbols.length)
      return { symbols: [...new Set(symbols)].sort((a, b) => a.localeCompare(b)) };
    return { symbol: "<excerpt>" };
  }
  if (selected) return selected;
  if (part.anchors?.length) return { coordinates: ordered(part.anchors) };
  if (part.change?.oldPath && part.change.oldPath !== part.change.newPath)
    return { symbol: "<rename>" };
  return { symbol: "<file>" };
}

function completeDeclarations(part, context) {
  const result = {};
  for (const side of ["base", "head"]) {
    const available = new Map();
    for (const item of context) {
      if (item.path !== part.path && item.basePath !== part.path) continue;
      const lines = String(item[side] ?? "").split("\n");
      const numbered = lines.some((line) => /^\d+: /.test(line));
      const start = item.evidenceSelector?.startLine;
      for (const [index, line] of lines.entries()) {
        const match = numbered && line.match(/^(\d+): (.*)$/);
        if (match) available.set(Number(match[1]), match[2]);
        else if (!numbered && (item[`${side}Complete`] || (start && !item.offset)))
          available.set((start ?? 1) + index, line);
      }
    }
    const tag = side === "head" ? "RIGHT" : "LEFT";
    for (const line of String(part.patch ?? "").split("\n")) {
      const match = line.match(/^\[(RIGHT|LEFT):(\d+)\] ([+-])(.*)$/);
      if (match?.[1] === tag) available.set(Number(match[2]), match[4]);
    }
    const complete = (part.declarationCatalog?.[side] ?? []).flatMap((entry) => {
      const lines = [];
      for (let line = entry.startLine; line <= entry.endLine; line++) {
        if (!available.has(line)) return [];
        lines.push(available.get(line));
      }
      lines[0] = lines[0].trimStart();
      if (entry.endColumn != null) lines[lines.length - 1] = lines.at(-1).slice(0, entry.endColumn);
      if (hash(lines.join("\n")) !== entry.hash) return [];
      return entry.symbols.map((symbol) => ({
        symbol,
        startLine: entry.startLine,
        endLine: entry.endLine,
      }));
    });
    if (complete.length) result[side] = complete;
  }
  return Object.keys(result).length ? result : undefined;
}

function withoutDuplicatePatch(part, context) {
  const changed = { head: new Map(), base: new Map() };
  for (const line of String(part.patch ?? "").split("\n")) {
    const match = line.match(/^\[(RIGHT|LEFT):(\d+)\] ([+-])(.*)$/);
    if (match) changed[match[1] === "RIGHT" ? "head" : "base"].set(Number(match[2]), match[4]);
  }
  return context.map((item) => {
    if (item.path !== part.path && item.basePath !== part.path) return item;
    const result = { ...item };
    for (const side of ["head", "base"]) {
      const text = item[side];
      if (typeof text !== "string" || !item[`${side}Complete`] || changed[side].size < 10) continue;
      const lines = text.split("\n");
      const duplicateSize = lines.reduce(
        (size, line, index) => size + (changed[side].get(index + 1) === line ? line.length : 0),
        0,
      );
      if (duplicateSize < 1000) continue;
      result[side] = lines
        .flatMap((line, index) =>
          changed[side].get(index + 1) === line ? [] : [`${index + 1}: ${line}`],
        )
        .join("\n");
      result[`${side}Complete`] = false;
      result.declarationComplete = false;
    }
    return result;
  });
}

function publicEvidenceBundle(parts, refs = {}) {
  const evidence = new Map();
  const versions = {
    base: refs.mergeBase ?? refs.base ?? null,
    head: refs.headRef ?? refs.sha ?? null,
  };
  const publicParts = parts.map((part) => {
    const references = [];
    const context = withoutDuplicatePatch(part, mergeRecoveredContext(part.context ?? []));
    for (const item of context) {
      const identity = {
        path: {
          base: item.basePath ?? item.path,
          head: item.path,
        },
        version: versions,
        side: item.evidenceSide ?? null,
        selector: selectorFor(item, part),
        offset: item.offset ?? 0,
      };
      const content = {
        baseState: item.baseState,
        headState: item.headState,
        baseComplete: item.baseComplete,
        headComplete: item.headComplete,
        declarationComplete: item.declarationComplete,
        selection: item.selection,
        recovered: item.recovered,
        base: item.base && item.base === item.head ? "" : (item.base ?? ""),
        head: item.head ?? "",
        ...(item.base && item.base === item.head ? { baseSameAsHead: true } : {}),
      };
      const id = hash(JSON.stringify({ identity, content })).slice(0, 24);
      if (!evidence.has(id))
        evidence.set(id, {
          id,
          ...identity,
          ...content,
        });
      const relationship = item.relationship ?? (item.recovered ? "recovered" : "related");
      const reference = {
        id,
        relationship,
        ...(item.forPath ? { forPath: item.forPath } : {}),
      };
      if (
        !references.some(
          (old) =>
            old.id === reference.id &&
            old.relationship === reference.relationship &&
            old.forPath === reference.forPath,
        )
      )
        references.push(reference);
    }
    const {
      anchors: _anchors,
      context: _context,
      contextKey: _contextKey,
      cacheGroupId: _cacheGroupId,
      declarationCatalog: _declarationCatalog,
      ...publicPart
    } = part;
    const completeness = completeDeclarations(part, context);
    const completeFiles = Object.fromEntries(
      Object.entries(completeness ?? {})
        .filter(([, entries]) => entries.some((entry) => entry.symbol === "<file>"))
        .map(([side]) => [side, true]),
    );
    const declarations = Object.fromEntries(
      Object.entries(completeness ?? {})
        .map(([side, entries]) => [side, entries.filter((entry) => entry.symbol !== "<file>")])
        .filter(([, entries]) => entries.length),
    );
    return {
      ...publicPart,
      completeFiles: Object.keys(completeFiles).length ? completeFiles : undefined,
      completeDeclarations: Object.keys(declarations).length ? declarations : undefined,
      evidenceRefs: references,
    };
  });
  const sortedEvidence = [...evidence.values()]
    .map(({ version: _version, ...item }) => item)
    .sort(
      (a, b) =>
        a.path.head.localeCompare(b.path.head) ||
        a.path.base.localeCompare(b.path.base) ||
        JSON.stringify(a.selector).localeCompare(JSON.stringify(b.selector)) ||
        a.id.localeCompare(b.id),
    );
  return { versions, parts: publicParts, evidence: sortedEvidence };
}

// Kept as a small projection for internal callers that only need part metadata.
function publicParts(parts, refs = {}) {
  return publicEvidenceBundle(parts, refs).parts;
}

// Split a recovered block that no longer fits. Keep every patch coordinate and
// distribute large recovered context across fitting partitions instead of
// copying the full context into each one.
function splitRecoveredChunk(chunk, limit, options = {}) {
  const measure =
    options.measure ??
    ((parts) => JSON.stringify(publicEvidenceBundle(parts, options.refs)).length);
  const recoveredByPath = new Map();
  for (const item of chunk.parts
    .flatMap((part) => part.context ?? [])
    .filter((entry) => entry.recovered)) {
    const key = JSON.stringify([
      item.path,
      item.basePath,
      item.side ?? (item.headState === "present" ? "head" : "base"),
      item.offset ?? 0,
      item.forPath,
      item.evidenceSelector,
      item.evidenceSymbols,
    ]);
    recoveredByPath.set(key, item);
  }
  const fits = options.fits ?? ((parts) => measure(parts) <= limit);
  const chunks = [];
  let current = [];
  for (const original of chunk.parts) {
    const paths = new Set([
      original.path,
      original.change?.oldPath,
      original.previousPath,
      ...(original.context ?? []).map((item) => item.path),
    ]);
    const relatedRecovered = [...recoveredByPath.values()].filter((item) =>
      item.forPath ? item.forPath === original.path : paths.has(item.path),
    );
    const context = (original.context ?? []).filter((item) => !item.recovered);
    const part = { ...original, context };
    const pieces = [];
    if (fits([{ ...part, context: [...context, ...relatedRecovered] }]))
      pieces.push({ ...part, context: [...context, ...relatedRecovered] });
    else {
      let lines = [];
      const piece = () => ({
        ...part,
        context: [...part.context],
        patch: lines.join("\n"),
        anchors: lines.flatMap((line) => {
          const coordinate = line.match(/^\[(RIGHT|LEFT):(\d+)\]/);
          return coordinate ? [`${coordinate[1]}:${coordinate[2]}`] : [];
        }),
        followups: part.followups ?? [],
      });
      const fitsWithEvidence = (candidate) =>
        !relatedRecovered.length ||
        relatedRecovered.some((item) =>
          fits([{ ...candidate, context: [...candidate.context, item] }]),
        );
      for (const line of part.patch.split("\n")) {
        lines.push(line);
        if (fits([piece()]) && fitsWithEvidence(piece())) continue;
        lines.pop();
        if (!lines.length) return null;
        pieces.push(piece());
        lines = [line];
        if (!fits([piece()]) || !fitsWithEvidence(piece())) return null;
      }
      if (lines.length) pieces.push(piece());
      while (pieces.length < relatedRecovered.length) {
        const candidate = pieces
          .map((item, index) => ({ item, index, lines: item.patch.split("\n") }))
          .filter(({ lines }) => lines.length > 1)
          .sort((a, b) => b.lines.length - a.lines.length || a.index - b.index)[0];
        if (!candidate) return null;
        const midpoint = Math.ceil(candidate.lines.length / 2);
        const split = [candidate.lines.slice(0, midpoint), candidate.lines.slice(midpoint)].map(
          (values) => ({
            ...candidate.item,
            context: [...candidate.item.context],
            patch: values.join("\n"),
            anchors: values.flatMap((line) => {
              const coordinate = line.match(/^\[(RIGHT|LEFT):(\d+)\]/);
              return coordinate ? [`${coordinate[1]}:${coordinate[2]}`] : [];
            }),
            followups: [],
          }),
        );
        if (split.some((item) => !fits([item]) || !fitsWithEvidence(item))) return null;
        pieces.splice(candidate.index, 1, ...split);
      }
    }
    // Spread recovered context across fitting pieces. Each piece keeps the
    // request status, so a later inference can request evidence it still needs.
    for (const item of relatedRecovered) {
      while (true) {
        const candidates = pieces
          .map((piece, index) => ({ piece, index }))
          .filter(({ piece }) => fits([{ ...piece, context: [...piece.context, item] }]))
          .sort(
            (a, b) =>
              JSON.stringify(a.piece.context).length - JSON.stringify(b.piece.context).length ||
              a.index - b.index,
          );
        if (candidates.length) {
          candidates[0].piece.context.push(item);
          break;
        }
        const candidate = pieces
          .map((piece, index) => ({ piece, index, lines: piece.patch.split("\n") }))
          .filter(({ lines }) => lines.length > 1)
          .sort((a, b) => b.lines.length - a.lines.length || a.index - b.index)[0];
        if (!candidate) return null;
        const midpoint = Math.ceil(candidate.lines.length / 2);
        const recoveredContext = candidate.piece.context.filter((entry) => entry.recovered);
        const commonContext = candidate.piece.context.filter((entry) => !entry.recovered);
        const split = [candidate.lines.slice(0, midpoint), candidate.lines.slice(midpoint)].map(
          (values, index) => ({
            ...candidate.piece,
            context: [...commonContext, ...(index === 0 ? recoveredContext : [])],
            patch: values.join("\n"),
            anchors: values.flatMap((line) => {
              const coordinate = line.match(/^\[(RIGHT|LEFT):(\d+)\]/);
              return coordinate ? [`${coordinate[1]}:${coordinate[2]}`] : [];
            }),
            followups: [],
          }),
        );
        if (split.some((piece) => !fits([piece]))) return null;
        pieces.splice(candidate.index, 1, ...split);
      }
    }
    // A previous inline finding travels with the patch containing its current
    // coordinate, rather than arbitrarily following the first segment.
    for (const piece of pieces) piece.followups = [];
    for (const thread of part.followups ?? []) {
      const at = pieces.findIndex(
        (piece) =>
          thread.currentLine != null &&
          piece.anchors.some((anchor) => anchor === `RIGHT:${thread.currentLine}`),
      );
      pieces[Math.max(0, at)].followups.push(thread);
    }
    for (const piece of pieces) {
      if (!fits([piece])) return null;
      if (current.length && !fits([...current, piece])) {
        chunks.push({ ...chunk, parts: current });
        current = [];
      }
      current.push(piece);
    }
  }
  if (current.length) chunks.push({ ...chunk, parts: current });
  return chunks.length > 1 ? chunks : null;
}

module.exports = { publicEvidenceBundle, publicParts, splitRecoveredChunk };
