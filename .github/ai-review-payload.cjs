// Context is shared by the block. Remove internal coordinates and identical
// excerpts without changing the evidence available to either inference stage.
function publicParts(parts) {
  const seen = new Set();
  return parts.map(({ anchors: _anchors, contextKey: _contextKey, ...part }) => ({
    ...part,
    context: (part.context ?? [])
      .map(({ forPath: _forPath, ...item }) => item)
      .filter((item) => {
        const key = JSON.stringify(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
  }));
}
// Split a recovered block that no longer fits. Keep every patch coordinate and
// distribute large recovered context across fitting partitions instead of
// copying the full context into each one.
function splitRecoveredChunk(chunk, limit) {
  const recoveredByPath = new Map();
  for (const item of publicParts(chunk.parts)
    .flatMap((part) => part.context)
    .filter((entry) => entry.recovered)) {
    const key = `${item.path}:${item.side ?? (item.headState === "present" ? "head" : "base")}:${item.offset ?? 0}`;
    recoveredByPath.set(key, item);
  }
  const fits = (parts) => JSON.stringify(publicParts(parts)).length <= limit;
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
    const context = publicParts([
      { ...original, context: original.context ?? [] },
    ])[0].context.filter((item) => !item.recovered);
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
          .sort((a, b) => b.lines.length - a.lines.length)[0];
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
      const candidates = pieces
        .map((piece, index) => ({ piece, index }))
        .filter(({ piece }) => fits([{ ...piece, context: [...piece.context, item] }]))
        .sort(
          (a, b) =>
            JSON.stringify(a.piece.context).length - JSON.stringify(b.piece.context).length ||
            a.index - b.index,
        );
      if (!candidates.length) return null;
      candidates[0].piece.context.push(item);
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
module.exports = { publicParts, splitRecoveredChunk };
