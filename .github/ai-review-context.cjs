const { execFileSync } = require("node:child_process");
const path = require("node:path").posix;
const crypto = require("node:crypto");
const { stable, parseConfig, PACKAGE_KEYS } = require("./ai-review-selection.cjs");
const BOT = "r2d2-reviewer[bot]";
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const clip = (value, size) => String(value ?? "").slice(0, size);

function rootOf(comment, comments) {
  const visited = new Set();
  while (comment?.in_reply_to_id) {
    if (visited.has(comment.id)) return null;
    visited.add(comment.id);
    comment = comments.find((item) => item.id === comment.in_reply_to_id);
  }
  return comment;
}

function human(comment) {
  return (
    comment?.user?.type === "User" &&
    !comment.user.login.endsWith("[bot]") &&
    ["OWNER", "MEMBER", "COLLABORATOR"].includes(comment.author_association)
  );
}

function reviewThreads(comments, botLogin = BOT) {
  return comments
    .filter(
      (c) =>
        !c.in_reply_to_id &&
        c.user?.login === botLogin &&
        /^<!-- ceretime-r2d2-(?:chunk|inline|finding:)/.test(c.body ?? ""),
    )
    .map((root) => {
      const replies = comments
        .filter(
          (c) =>
            rootOf(c, comments)?.id === root.id &&
            c.id !== root.id &&
            (human(c) ||
              (c.user?.login === botLogin && c.body?.startsWith("<!-- ceretime-r2d2-thread:"))),
        )
        .sort((a, b) => a.id - b.id);
      const formal = comments
        .filter(
          (c) =>
            rootOf(c, comments)?.id === root.id &&
            c.user?.login === botLogin &&
            c.body?.startsWith(`<!-- ceretime-r2d2-resolution:${root.id}:`),
        )
        .sort((a, b) => b.id - a.id)[0];
      return {
        previous_resolution: formal
          ? clip(formal.body.replace(/\n\nComprobación formal:.*$/, ""), 1600)
          : undefined,
        id: String(root.id),
        path: root.path,
        side: root.side,
        line: root.original_line ?? root.line,
        currentLine: root.line,
        sha: root.original_commit_id,
        finding: clip((root.body ?? "").replace(/\n\nVerificado en [\s\S]*$/, ""), 2200),
        hunk: clip(root.diff_hunk, 3000),
        messages: replies.slice(-4).map((c) => ({
          id: c.id,
          author: c.user.login,
          body: clip(c.body, c.id === replies.at(-1)?.id ? 1500 : 500),
        })),
        truncated:
          replies.length > 4 ||
          replies.some((c, i) => c.body.length > (i === replies.length - 1 ? 1500 : 500)) ||
          (root.body?.length ?? 0) > 2200,
      };
    });
}

// Map coordinates using an old-to-new diff. A deleted line has no current coordinate.
function mapLine(patch, line) {
  let offset = 0;
  const hunks = [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[^\n]*\n?/gm)];
  for (let i = 0; i < hunks.length; i++) {
    const hunk = hunks[i],
      start = Number(hunk[1]),
      count = Number(hunk[2] ?? 1),
      next = Number(hunk[3]),
      newCount = Number(hunk[4] ?? 1);
    if (count === 0) {
      if (line > start) offset += newCount;
      continue;
    }
    if (line < start) return line + offset;
    if (line >= start + count) {
      offset += newCount - count;
      continue;
    }
    let old = start,
      current = next;
    for (const text of patch
      .slice(hunk.index + hunk[0].length, hunks[i + 1]?.index ?? patch.length)
      .split("\n")) {
      if (text.startsWith("+")) current++;
      else if (text.startsWith("-")) {
        if (old === line) return null;
        old++;
      } else if (text.startsWith(" ")) {
        if (old === line) return current;
        old++;
        current++;
      }
    }
    return null;
  }
  return line + offset;
}

function excerpt(text, line, radius = 10) {
  if (!Number.isInteger(line) || line < 1 || typeof text !== "string") return null;
  const lines = text.split("\n"),
    start = Math.max(0, line - radius - 1);
  return clip(
    lines
      .slice(start, line + radius)
      .map((value, i) => `${start + i + 1}: ${value}`)
      .join("\n"),
    2200,
  );
}

async function threadEvidence({ github, repo, root, head }) {
  let ref = root.original_commit_id,
    delta = null,
    currentPath = root.path;
  let line = root.original_line ?? root.line,
    currentLine = null,
    original = null,
    current = null;
  const compare = async (base, next) =>
    (
      await github.request("GET /repos/{owner}/{repo}/compare/{basehead}", {
        ...repo,
        basehead: `${base}...${next}`,
      })
    ).data;
  const read = async (version, filename) => {
    const file = (await github.rest.repos.getContent({ ...repo, path: filename, ref: version }))
      .data;
    return file.type === "file" && file.encoding === "base64" && file.size <= 200000
      ? Buffer.from(file.content, "base64").toString("utf8")
      : null;
  };
  try {
    if (root.side === "LEFT") ref = (await compare("main", ref)).merge_base_commit.sha;
    original = await read(ref, root.path);
    if (ref === head) delta = "";
    else {
      const comparison = await compare(ref, head);
      // A rebased history or a truncated comparison cannot safely map old lines.
      if (comparison.merge_base_commit.sha === ref && comparison.files.length < 300) {
        const file = comparison.files.find(
          (f) => f.filename === root.path || f.previous_filename === root.path,
        );
        if (!file) delta = "";
        else {
          delta = file.patch ?? null;
          currentPath = file.filename;
        }
      }
    }
    if (delta != null) currentLine = mapLine(delta, line);
    current = await read(head, currentPath);
  } catch {
    /* Preserve the original hunk, but do not invent a current location. */
  }
  return {
    original_excerpt: excerpt(original, line),
    current_excerpt: excerpt(current, currentLine),
    related_change: clip(delta, 3200),
    evidence_incomplete:
      original == null || current == null || delta == null || delta.length > 3200,
    currentLine,
    currentPath,
  };
}

function gitReader(directory) {
  const git = (...args) =>
    execFileSync("git", ["--no-pager", ...args], {
      cwd: directory,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  const read = (ref, filename) => {
    try {
      const value = git("show", `${ref}:${filename}`);
      return value.length <= 200000 ? value : null;
    } catch {
      return null;
    }
  };
  return { git, read };
}

function enrichFiles(files, { directory, base, sha, threads = [] }) {
  const { git, read } = gitReader(directory);
  const mergeBase = git("merge-base", base, sha).trim();
  const paths = [
    ...new Set(
      [sha, mergeBase].flatMap((ref) =>
        git("ls-tree", "-r", "--name-only", ref).trim().split("\n"),
      ),
    ),
  ].filter(
    (p) => /\.[cm]?[jt]sx?$/.test(p) && !/(?:node_modules|_generated|dist|\.agents)\//.test(p),
  );
  const sources = new Map(paths.map((p) => [p, read(sha, p)]));
  const baseSources = new Map(paths.map((p) => [p, read(mergeBase, p)]));
  const imports = (filename, text) =>
    [...(text ?? "").matchAll(/["'](\.[^"']+|[@~]\/[^"']+)["']/g)]
      .map((m) => {
        const app = filename.match(/^(apps\/[^/]+)/)?.[1];
        const target = m[1].startsWith(".")
          ? path.normalize(path.join(path.dirname(filename), m[1]))
          : app
            ? `${app}/src/${m[1].slice(2)}`
            : m[1];
        return [
          target,
          ...[".ts", ".tsx", ".js", ".cjs", "/index.ts", "/index.tsx"].map((ext) => target + ext),
        ].find((p) => sources.has(p));
      })
      .filter(Boolean);
  const graph = new Map(
    paths.map((p) => [
      p,
      [...new Set([...imports(p, sources.get(p)), ...imports(p, baseSources.get(p))])],
    ]),
  );
  const declarations = (text) => {
    const lines = (text ?? "").split("\n"),
      selected = new Set();
    lines.forEach((line, i) => {
      if (/\b(?:import|export|function|class|interface|type|require)\b/.test(line))
        for (let n = i; n < Math.min(lines.length, i + 5); n++) selected.add(n);
    });
    return clip(
      [...selected]
        .sort((a, b) => a - b)
        .map((i) => lines[i])
        .join("\n"),
      900,
    );
  };
  const environment = (filename) => {
    const app = filename.match(/^(apps\/[^/]+)/)?.[1];
    return [
      "package.json",
      "tsconfig.json",
      "convex/tsconfig.json",
      ...(app ? [`${app}/package.json`, `${app}/tsconfig.json`, `${app}/app.json`] : []),
    ].map((p) => {
      const text = read(sha, p);
      try {
        let data = parseConfig(text, p);
        if (p.endsWith("package.json"))
          data = Object.fromEntries(Object.entries(data).filter(([key]) => PACKAGE_KEYS.has(key)));
        return [p, hash(JSON.stringify(stable(data)))];
      } catch {
        return [p, hash(text ?? "")];
      }
    });
  };
  for (const file of files) {
    file.before = read(mergeBase, file.previous_filename ?? file.filename);
    file.after = read(sha, file.filename);
    const dependencies = new Set(),
      queue = [file.filename];
    // Follow dependency and consumer chains, including re-export barrels.
    while (queue.length) {
      const target = queue.pop();
      for (const p of graph.get(target) ?? [])
        if (!dependencies.has(p)) {
          dependencies.add(p);
          queue.push(p);
        }
      for (const [consumer, imported] of graph)
        if (imported.includes(target) && !dependencies.has(consumer)) {
          dependencies.add(consumer);
          queue.push(consumer);
        }
    }
    if (
      /\.[cm]?[jt]sx?$/.test(file.filename) &&
      /["'][^"']*(?:convex\/|_generated\/)[^"']*["']/.test(file.after ?? "")
    )
      for (const p of paths.filter((p) => p.startsWith("convex/"))) dependencies.add(p);
    // Keep the complete dependency fingerprint even when excerpts exceed the budget.
    file.contextKey = hash(
      JSON.stringify({
        own: hash(file.after ?? ""),
        environment: environment(file.filename),
        dependencies: [...dependencies].sort().map((p) => [p, hash(sources.get(p) ?? "")]),
      }),
    );
    file.context = [file.filename, ...[...dependencies].sort().filter((p) => p !== file.filename)]
      .slice(0, 4)
      .map((p) => ({
        path: p,
        base: declarations(read(mergeBase, p)),
        head: declarations(sources.get(p)),
      }));
    file.context = JSON.parse(clipContext(file.context, 2400));
    file.followups = threads.filter(
      (thread) => thread.path === file.filename || thread.path === file.previous_filename,
    );
  }
  const followups = threads.map((thread) => {
    let ref = thread.sha,
      original = null,
      currentLine = null,
      delta = null,
      currentPath = thread.path;
    try {
      if (thread.side === "LEFT") ref = git("merge-base", base, thread.sha).trim();
      original = read(ref, thread.path);
      const rename = git("diff", "--name-status", "--find-renames", ref, sha)
        .split("\n")
        .map((line) => line.split("\t"))
        .find(([status, from]) => status.startsWith("R") && from === thread.path);
      if (rename) currentPath = rename[2];
      delta = git(
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--find-renames",
        "--unified=3",
        ref,
        sha,
        "--",
        thread.path,
        currentPath,
      );
      currentLine = mapLine(delta, thread.line);
    } catch {
      /* Missing old commits produce explicit partial evidence. */
    }
    const current = read(sha, currentPath),
      deleted = current == null && /deleted file mode/.test(delta ?? "");
    return {
      ...thread,
      currentPath,
      currentState: deleted ? "deleted" : current == null ? "unavailable" : "present",
      original_excerpt: excerpt(original, thread.line),
      current_excerpt: excerpt(current, currentLine),
      currentLine,
      related_change: clip(delta, 3200),
      evidence_incomplete:
        delta == null ||
        original == null ||
        (current == null && !deleted) ||
        (delta?.length ?? 0) > 3200,
    };
  });
  for (const file of files)
    file.followups = followups.filter(
      (t) => t.path === file.filename || t.path === file.previous_filename,
    );
  return { mergeBase, followups };
}

function clipContext(items, budget) {
  const result = [];
  for (const item of items) {
    if (JSON.stringify([...result, item]).length > budget) break;
    result.push(item);
  }
  return JSON.stringify(result);
}

function contentKey(part) {
  const patch = (part.patch ?? "")
    .replace(/^@@[^\n]*$/gm, "@@")
    .replace(/\[(?:RIGHT|LEFT):\d+\] /g, "");
  const followups = (part.followups ?? []).map(
    ({ sha: _sha, currentLine: _currentLine, line: _line, ...thread }) => ({
      ...thread,
      original_excerpt: thread.original_excerpt?.replace(/^\d+: /gm, ""),
      current_excerpt: thread.current_excerpt?.replace(/^\d+: /gm, ""),
      related_change: thread.related_change?.replace(/^@@[^\n]*$/gm, "@@"),
    }),
  );
  return hash(
    JSON.stringify(
      stable({
        path: part.path,
        previousPath: part.previousPath,
        kind: part.kind,
        status: part.status,
        patch,
        contextKey: part.contextKey,
        context: part.context,
        followups,
      }),
    ),
  );
}

module.exports = {
  BOT,
  hash,
  rootOf,
  human,
  reviewThreads,
  mapLine,
  excerpt,
  threadEvidence,
  gitReader,
  enrichFiles,
  contentKey,
};
