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
// Split only a recovered block that no longer fits. Every partition receives the
// same contracts; patch coordinates survive verbatim and no line is discarded.
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
    ])[0].context.concat(relatedRecovered);
    const part = { ...original, context };
    const pieces = [];
    if (fits([part])) pieces.push(part);
    else {
      let lines = [];
      const piece = () => ({
        ...part,
        patch: lines.join("\n"),
        anchors: lines.flatMap((line) => {
          const coordinate = line.match(/^\[(RIGHT|LEFT):(\d+)\]/);
          return coordinate ? [`${coordinate[1]}:${coordinate[2]}`] : [];
        }),
        followups: part.followups ?? [],
      });
      for (const line of part.patch.split("\n")) {
        lines.push(line);
        if (fits([piece()])) continue;
        lines.pop();
        if (!lines.length) return null;
        pieces.push(piece());
        lines = [line];
        if (!fits([piece()])) return null;
      }
      if (lines.length) pieces.push(piece());
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
