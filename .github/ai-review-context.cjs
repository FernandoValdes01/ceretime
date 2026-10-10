const { execFileSync } = require("node:child_process");
const path = require("node:path").posix;
const crypto = require("node:crypto");
const { stable, parseConfig, PACKAGE_KEYS } = require("./ai-review-selection.cjs");
const BOT = "r2d2-reviewer[bot]";
const HISTORY_CHARS = 12000;
const ts = require("node:module").createRequire(path.join(__dirname, "../apps/web/package.json"))(
  "typescript",
);
const declarationCache = new Map();
const MAX_DECLARATION_CACHE = 8;

function declarationAnalysis(text, patch, side) {
  let analysis = declarationCache.get(text);
  if (!analysis) {
    const source = ts.createSourceFile(
      "context.tsx",
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const declarations = source.statements.filter(
      (node) =>
        ts.isImportDeclaration(node) ||
        ts.isExpressionStatement(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isVariableStatement(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node),
    );
    const names = (node) => {
      const result = new Set();
      const visit = (child) => {
        if (ts.isIdentifier(child)) result.add(child.text);
        ts.forEachChild(child, visit);
      };
      visit(node);
      return result;
    };
    const declared = (node) =>
      ts.isVariableStatement(node)
        ? node.declarationList.declarations.flatMap((d) => [...names(d.name)])
        : node.name
          ? [node.name.text]
          : [];
    const references = (node) => {
      const result = new Set();
      const visit = (child) => {
        if (ts.isIdentifier(child)) {
          const parent = child.parent;
          const binding =
            parent.name === child &&
            (ts.isVariableDeclaration(parent) ||
              ts.isFunctionDeclaration(parent) ||
              ts.isClassDeclaration(parent) ||
              ts.isInterfaceDeclaration(parent) ||
              ts.isTypeAliasDeclaration(parent) ||
              ts.isEnumDeclaration(parent) ||
              ts.isParameter(parent) ||
              ts.isTypeParameterDeclaration(parent) ||
              ts.isBindingElement(parent));
          const property =
            (ts.isPropertyAccessExpression(parent) ||
              ts.isPropertyAssignment(parent) ||
              ts.isPropertyDeclaration(parent) ||
              ts.isPropertySignature(parent) ||
              ts.isMethodDeclaration(parent)) &&
            parent.name === child;
          if (!binding && !property) result.add(child.text);
        }
        ts.forEachChild(child, visit);
      };
      visit(node);
      return result;
    };
    analysis = { source, declarations, names, declared, references };
    declarationCache.set(text, analysis);
    if (declarationCache.size > MAX_DECLARATION_CACHE)
      declarationCache.delete(declarationCache.keys().next().value);
  } else {
    declarationCache.delete(text);
    declarationCache.set(text, analysis);
  }
  const { source, declarations, names, declared, references } = analysis;
  const ranges = [...(patch ?? "").matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map(
    (m) => {
      const start = Number(m[side === "base" ? 1 : 3]) - 1;
      return [start, start + Math.max(1, Number(m[side === "base" ? 2 : 4] ?? 1))];
    },
  );
  const selected = ranges.length
    ? declarations.filter((node) =>
        ranges.some(
          ([start, end]) =>
            source.getLineAndCharacterOfPosition(node.getStart(source)).line < end &&
            source.getLineAndCharacterOfPosition(node.end).line >= start,
        ),
      )
    : [];
  return { source, declarations, names, declared, references, ranges, selected };
}

function expandImportedSymbols(source, symbols, importedOnly = false) {
  const references = new Set(symbols);
  const result = new Set(importedOnly ? [] : symbols);
  const bindings = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      if (!clause) continue;
      if (clause.name) bindings.push([clause.name.text, "default"]);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings))
        for (const element of clause.namedBindings.elements)
          bindings.push([element.name.text, element.propertyName?.text ?? element.name.text]);
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))
        bindings.push([clause.namedBindings.name.text, clause.namedBindings.name.text]);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        !declaration.initializer ||
        !ts.isCallExpression(declaration.initializer) ||
        !ts.isIdentifier(declaration.initializer.expression) ||
        declaration.initializer.expression.text !== "require"
      )
        continue;
      if (ts.isObjectBindingPattern(declaration.name)) {
        for (const element of declaration.name.elements)
          if (ts.isIdentifier(element.name))
            bindings.push([
              element.name.text,
              element.propertyName && ts.isIdentifier(element.propertyName)
                ? element.propertyName.text
                : element.name.text,
            ]);
      } else if (ts.isIdentifier(declaration.name)) {
        bindings.push([declaration.name.text, declaration.name.text]);
      }
    }
  }
  for (const [local, imported] of bindings)
    if (references.has(local) || references.has(imported)) {
      result.add(local);
      result.add(imported);
    }
  return result;
}

function namespaceBindings(source) {
  const namespaces = new Set();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (
        statement.importClause?.namedBindings &&
        ts.isNamespaceImport(statement.importClause.namedBindings)
      )
        namespaces.add(statement.importClause.namedBindings.name.text);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations)
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer &&
        ts.isCallExpression(declaration.initializer) &&
        ts.isIdentifier(declaration.initializer.expression) &&
        declaration.initializer.expression.text === "require" &&
        ts.isStringLiteral(declaration.initializer.arguments[0])
      )
        namespaces.add(declaration.name.text);
  }
  return namespaces;
}

function namespaceMembers(source, selected, namespaces = namespaceBindings(source)) {
  const members = new Set();
  for (const declaration of selected) {
    const visit = (node) => {
      if (ts.isPropertyAccessExpression(node)) {
        let root = node.expression;
        while (ts.isPropertyAccessExpression(root)) root = root.expression;
        if (ts.isIdentifier(root) && namespaces.has(root.text)) {
          let access = node;
          while (ts.isPropertyAccessExpression(access)) {
            members.add(access.name.text);
            access = access.expression;
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(declaration);
  }
  return members;
}

function declarationSymbols(text, patch, side, mode = "all") {
  if (!text) return [];
  const { source, selected, declared, references } = declarationAnalysis(text, patch, side);
  const symbols = selected.flatMap((node) => [
    ...(mode === "all" || mode === "declared" ? declared(node) : []),
    ...(mode === "all" || mode === "references" ? references(node) : []),
  ]);
  const members = mode === "all" || mode === "references" ? namespaceMembers(source, selected) : [];
  return [
    ...new Set([...expandImportedSymbols(source, symbols, mode === "references"), ...members]),
  ];
}

function declarationSymbolsAtLine(text, line, side, mode = "all") {
  if (typeof text !== "string" || !Number.isInteger(line) || line < 1) return [];
  const lines = text.split("\n");
  const numbered = lines.some((value) => /^\d+: /.test(value));
  let source = text;
  if (numbered) {
    const indexed = [];
    for (const value of lines) {
      const match = value.match(/^(\d+): (.*)$/);
      if (match) indexed[Number(match[1]) - 1] = match[2];
    }
    source = indexed.map((value) => value ?? "").join("\n");
  }
  if (line > source.split("\n").length) return [];
  return declarationSymbols(source, `@@ -${line},1 +${line},1 @@`, side, mode);
}

function publicContracts(text, patch, side) {
  if (!text) return new Map();
  const { source, selected, declared } = declarationAnalysis(text, patch, side);
  const exported = new Map();
  const addExport = (local, name = local) => {
    const names = exported.get(local) ?? new Set();
    names.add(name);
    exported.set(local, names);
  };
  for (const statement of source.statements) {
    if (
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const { left, right } = statement.expression;
      const moduleExports =
        ts.isPropertyAccessExpression(left) &&
        ts.isIdentifier(left.expression) &&
        left.expression.text === "module" &&
        left.name.text === "exports";
      const exportsMember =
        ts.isPropertyAccessExpression(left) &&
        ts.isIdentifier(left.expression) &&
        left.expression.text === "exports";
      if (moduleExports && ts.isObjectLiteralExpression(right))
        for (const property of right.properties) {
          if (ts.isShorthandPropertyAssignment(property)) addExport(property.name.text);
          else if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer))
            addExport(
              property.initializer.text,
              property.name.getText(source).replaceAll(/["']/g, ""),
            );
        }
      if (exportsMember && ts.isIdentifier(right)) addExport(right.text, left.name.text);
    }
  }
  const contract = (node) => {
    const modifiers = node.modifiers?.map((modifier) => modifier.kind) ?? [];
    const parameters = (items) =>
      [...items].map(
        (parameter) =>
          `${parameter.dotDotDotToken ? "..." : ""}${parameter.name.getText(source)}${parameter.questionToken ? "?" : ""}:${parameter.type?.getText(source) ?? ""}${parameter.initializer ? `=${parameter.initializer.getText(source)}` : ""}`,
      );
    const callable = (node) =>
      JSON.stringify({
        typeParameters: node.typeParameters?.map((item) => item.getText(source)) ?? [],
        parameters: parameters(node.parameters),
        returnType: node.type?.getText(source) ?? "",
      });
    if (ts.isFunctionDeclaration(node))
      return JSON.stringify([
        modifiers,
        node.name?.text,
        callable(node),
        node.type || !node.body ? null : node.body.getText(source),
      ]);
    if (ts.isVariableStatement(node))
      return JSON.stringify([
        modifiers,
        node.declarationList.declarations.map((declaration) => {
          const initializer = declaration.initializer;
          const isCallable =
            initializer &&
            (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer));
          return [
            declaration.name.getText(source),
            declaration.type?.getText(source) ?? "",
            isCallable
              ? callable(initializer) +
                (initializer.type ? "" : `:${initializer.body.getText(source)}`)
              : (initializer?.getText(source) ?? ""),
          ];
        }),
      ]);
    if (
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isEnumDeclaration(node)
    )
      return node.getText(source);
    return node.getText(source);
  };
  const uncertainReturn = (node) => {
    if (ts.isFunctionDeclaration(node)) return !node.type;
    if (!ts.isVariableStatement(node)) return false;
    return node.declarationList.declarations.some((declaration) => {
      const initializer = declaration.initializer;
      return (
        initializer &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) &&
        !declaration.type &&
        !initializer.type
      );
    });
  };
  const result = new Map();
  for (const node of selected) {
    const isEsExport = (node.modifiers ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    for (const local of declared(node)) {
      if (!isEsExport && !exported.has(local)) continue;
      result.set(local, {
        signature: contract(node),
        uncertain: uncertainReturn(node),
        names: [...(exported.get(local) ?? [local])],
      });
    }
  }
  return result;
}

function changedContractSymbols(before, after, basePatch, headPatch) {
  const base = publicContracts(before, basePatch, "base");
  const head = publicContracts(after, headPatch, "head");
  const changed = new Set();
  for (const local of new Set([...base.keys(), ...head.keys()])) {
    const before = base.get(local),
      current = head.get(local);
    if (!before?.uncertain && !current?.uncertain && before?.signature === current?.signature)
      continue;
    changed.add(local);
    for (const name of [...(before?.names ?? []), ...(current?.names ?? [])]) changed.add(name);
  }
  return [...changed];
}

// Keep canonical declaration digests private. A public completeness receipt
// is valid only if every source line survives the final payload projection.
function declarationDigests(text) {
  if (!text) return [];
  const { source, declarations, declared } = declarationAnalysis(text, "", "head");
  const whole = text.replace(/\n$/, "");
  return [
    {
      symbols: ["<file>"],
      startLine: 1,
      endLine: whole.split("\n").length,
      hash: hash(whole.replace(/^[^\S\r\n]*/, "")),
    },
    ...declarations.flatMap((node) => {
      const symbols = declared(node);
      if (!symbols.length) return [];
      const start = source.getLineAndCharacterOfPosition(node.getStart(source));
      const end = source.getLineAndCharacterOfPosition(node.end);
      const startLine = start.line + 1;
      const lines = node.getText(source).split("\n");
      return [
        {
          symbols,
          startLine,
          endLine: startLine + lines.length - 1,
          endColumn: end.character - (lines.length === 1 ? start.character : 0),
          hash: hash(lines.join("\n")),
        },
      ];
    }),
  ];
}

// Select the changed declarations, their local helpers, and direct consumers.
function relevantDeclarations(
  text,
  patch,
  side,
  budget,
  symbols = [],
  symbolMode = "definitions",
  { includeConsumers = true } = {},
) {
  if (!text) return "";
  const {
    source,
    declarations,
    names,
    declared,
    references,
    selected: changed,
  } = declarationAnalysis(text, patch, side);
  const requested = expandImportedSymbols(source, symbols);
  const namespaces =
    symbolMode === "consumers" || symbolMode === "all" ? namespaceBindings(source) : null;
  const primary = changed.length
    ? changed
    : requested.size
      ? declarations.filter((node) => {
          const nodeReferences = references(node);
          const members = namespaces ? namespaceMembers(source, [node], namespaces) : [];
          return symbolMode === "consumers"
            ? [...nodeReferences, ...members].some((name) => requested.has(name))
            : symbolMode === "all"
              ? [...declared(node), ...nodeReferences, ...members].some((name) =>
                  requested.has(name),
                )
              : [...declared(node)].some((name) => requested.has(name));
        })
      : declarations;
  if (requested.size && !primary.length) return "";
  const selected = new Set(primary);
  const addHelpers = (seeds, destination) => {
    let needed = new Set(seeds.flatMap((node) => [...references(node)]));
    while (needed.size) {
      const found = declarations.filter(
        (node) => !selected.has(node) && declared(node).some((name) => needed.has(name)),
      );
      if (!found.length) break;
      for (const node of found) {
        selected.add(node);
        destination.push(node);
        for (const name of declared(node)) needed.delete(name);
      }
      needed = new Set([...needed, ...found.flatMap((node) => [...references(node)])]);
    }
  };
  const helpers = [];
  addHelpers(primary, helpers);
  const contractNames = new Set(primary.flatMap((node) => declared(node)));
  const consumers =
    changed.length && includeConsumers
      ? declarations.filter(
          (node) =>
            !selected.has(node) && [...references(node)].some((name) => contractNames.has(name)),
        )
      : [];
  for (const node of consumers) selected.add(node);
  const consumerHelpers = [];
  addHelpers(consumers, consumerHelpers);
  const ordered = [...new Set([...primary, ...helpers, ...consumers, ...consumerHelpers])];
  const neededImports = new Set(
    ordered.flatMap((node) => [...declared(node), ...references(node)]),
  );
  const imports = source.statements.filter((node) => {
    if (ts.isExpressionStatement(node) && /\brequire\s*\(/.test(node.getText(source))) return true;
    if (
      ts.isVariableStatement(node) &&
      /\brequire\s*\(/.test(node.getText(source)) &&
      [...names(node)].some((name) => neededImports.has(name))
    )
      return true;
    if (!ts.isImportDeclaration(node)) return false;
    const clause = node.importClause;
    const sideEffectOnly =
      !clause ||
      (!clause.name &&
        (!clause.namedBindings ||
          (ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length === 0)));
    return sideEffectOnly || [...names(node)].some((name) => neededImports.has(name));
  });
  const snippets = [...new Set([...imports, ...ordered])].map((node) => {
    const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
    return node
      .getText(source)
      .split("\n")
      .map((line, index) => `${start + index + 1}: ${line}`)
      .join("\n");
  });
  // A prefix of a function hides its behavior. Keep complete declarations and
  // leave omitted ones available to the bounded Git recovery protocol.
  let used = 0;
  return snippets
    .filter((snippet) => {
      const size = snippet.length + Number(used > 0);
      if (used + size > budget) return false;
      used += size;
      return true;
    })
    .join("\n");
}
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
        originalBase: reviewedBase(root.body),
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

function reviewedBase(body) {
  return String(body ?? "").match(/<!-- ceretime-r2d2-base:([a-f0-9]{40}) -->/)?.[1];
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
    if (root.side === "LEFT") {
      ref = reviewedBase(root.body);
      if (!ref) throw new Error("Base histórica no disponible.");
    }
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
    related_change: clip(delta, HISTORY_CHARS),
    evidence_incomplete:
      original == null || current == null || delta == null || delta.length > HISTORY_CHARS,
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
  const readState = (ref, filename) => {
    try {
      git("cat-file", "-e", `${ref}^{commit}`);
      if (!git("ls-tree", "-z", ref, "--", `:(literal)${filename}`).trim())
        return { status: "absent", reason: "La ruta no existe en este commit.", text: null };
      const text = read(ref, filename);
      return text == null
        ? {
            status: "unavailable",
            reason: "No se pudo leer el contenido dentro del límite de tamaño.",
            text: null,
          }
        : { status: "present", reason: "Contenido recuperado de Git.", text };
    } catch {
      return {
        status: "unavailable",
        reason: "Commit o contenido no disponible en Git.",
        text: null,
      };
    }
  };
  return { git, read, readState };
}

function enrichFiles(files, { directory, base, sha, threads = [] }) {
  const { git, read, readState } = gitReader(directory);
  const mergeBase = git("merge-base", base, sha).trim();
  const paths = [
    ...new Set(
      [sha, mergeBase].flatMap((ref) =>
        git("ls-tree", "-rz", "--name-only", ref).split("\0").filter(Boolean),
      ),
    ),
  ].filter(
    (p) =>
      (/\.(?:[cm]?[jt]sx?|css)$/.test(p) || /^\.github\/workflows\/.*\.ya?ml$/.test(p)) &&
      !/(?:node_modules|_generated|dist|\.agents)\//.test(p),
  );
  const sources = new Map(paths.map((p) => [p, read(sha, p)]));
  const baseSources = new Map(paths.map((p) => [p, read(mergeBase, p)]));
  const imports = (filename, text) =>
    [...(text ?? "").matchAll(/["'](\.[^"']+|[@~]\/[^"']+)["']/g)]
      .map((m) => {
        const app = filename.match(/^(apps\/[^/]+)/)?.[1];
        const target = m[1].startsWith(".")
          ? path.normalize(
              path.join(
                filename.startsWith(".github/workflows/") ? "" : path.dirname(filename),
                m[1],
              ),
            )
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
  // CSS contracts have consumers without a JS import of their producer.
  for (const file of files.filter((file) => file.filename.endsWith(".css"))) {
    const tokens = new Set(
      `${read(mergeBase, file.filename) ?? ""}\n${read(sha, file.filename) ?? ""}`.match(
        /--[A-Za-z_][\w-]*/g,
      ) ?? [],
    );
    if (!tokens.size) continue;
    for (const candidate of paths) {
      if (candidate === file.filename) continue;
      const text = `${sources.get(candidate) ?? ""}\n${baseSources.get(candidate) ?? ""}`;
      if ([...tokens].some((token) => text.includes(token)))
        graph.get(candidate).push(file.filename);
    }
  }
  const declarations = (text, budget, workflow, patch, side, symbols) => {
    if (!text) return "";
    if (text.length <= budget) return text;
    if (workflow || !/\b(?:import|export|function|const|let|var|class|interface|type)\b/.test(text))
      return clip(text, budget);
    return relevantDeclarations(text, patch, side, budget, symbols);
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
      queue = [file.filename, file.previous_filename].filter(Boolean);
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
    const consumers = paths.filter((p) =>
      graph.get(p)?.some((target) => target === file.filename || target === file.previous_filename),
    );
    const directDependencies = new Set(graph.get(file.filename) ?? []);
    const consumerPaths = new Set(consumers);
    const direct = new Set([...consumers, ...(graph.get(file.filename) ?? [])]);
    const related = [...dependencies]
      .filter((p) => p !== file.filename)
      .sort((a, b) => {
        const priority = (p) =>
          (graph.get(file.filename)?.includes(p) ? 0 : direct.has(p) ? 2 : 4) +
          Number(/\.(?:test|spec)\./.test(p));
        return priority(a) - priority(b) || a.localeCompare(b);
      });
    const workflow = file.filename.startsWith(".github/workflows/");
    const invoked = new Set(graph.get(file.filename) ?? []);
    const tests = related.filter((p) => /\.(?:test|spec)\./.test(p));
    const contracts = related.filter((p) => !tests.includes(p));
    file.context = [
      ...new Set([file.filename, ...contracts.slice(0, 10), ...tests.slice(0, 3), ...contracts]),
    ]
      .slice(0, 16)
      .map((p) => {
        const basePath = p === file.filename ? (file.previous_filename ?? p) : p;
        const before = readState(mergeBase, basePath),
          after = readState(sha, p);
        const original = before.text,
          current = after.text;
        const own = p === file.filename;
        const budget = p.startsWith(".github/workflows/")
          ? own
            ? 8000
            : 1600
          : own
            ? 10000
            : invoked.has(p)
              ? 2000
              : direct.has(p)
                ? 6000
                : 600;
        const ownPatch = p === file.filename ? file.patch : undefined;
        const relationship = own
          ? "own"
          : directDependencies.has(p) && consumerPaths.has(p)
            ? "both"
            : directDependencies.has(p)
              ? "dependency"
              : consumerPaths.has(p)
                ? "consumer"
                : "related";
        const baseText = declarations(
          original,
          own ? 6000 : 2000,
          p.startsWith(".github/workflows/") || p.endsWith(".css"),
          ownPatch,
          "base",
        );
        const headText =
          workflow && invoked.has(p) && (current?.length ?? Infinity) <= 24000
            ? current
            : declarations(
                current,
                budget,
                p.startsWith(".github/workflows/") || p.endsWith(".css"),
                ownPatch,
                "head",
              );
        return {
          path: p,
          relationship,
          basePath,
          baseState:
            before.status === "absent" && p === file.filename && file.status === "added"
              ? "not_yet_created"
              : before.status,
          headState:
            after.status === "absent" && p === file.filename && file.status === "removed"
              ? "deleted"
              : after.status,
          baseReason: before.reason,
          headReason: after.reason,
          base: original === current ? headText : baseText,
          head: headText,
          baseComplete:
            original != null && (original === current ? headText : baseText) === original,
          headComplete: current != null && headText === current,
        };
      });
    file.context = JSON.parse(clipContext(file.context, workflow ? 32000 : 12000));
    file.followups = threads.filter(
      (thread) => thread.path === file.filename || thread.path === file.previous_filename,
    );
    Object.defineProperty(file, "contextSources", {
      value: { head: sources, base: baseSources },
      configurable: true,
    });
  }
  const followups = threads.map((thread) => {
    let ref = thread.sha,
      original = null,
      currentLine = null,
      delta = null,
      currentPath = thread.path;
    try {
      if (thread.side === "LEFT") {
        ref = thread.originalBase;
        if (!ref) throw new Error("Base histórica no disponible.");
      }
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
      related_change: clip(delta, HISTORY_CHARS),
      evidence_incomplete:
        delta == null ||
        original == null ||
        (current == null && !deleted) ||
        (delta?.length ?? 0) > HISTORY_CHARS,
    };
  });
  for (const file of files)
    file.followups = followups.filter(
      (t) => t.path === file.filename || t.path === file.previous_filename,
    );
  return { mergeBase, followups };
}

function clipContext(items, budget) {
  const result = items.map((item) => ({ ...item }));
  // Share the excerpt budget instead of dropping later contract producers entirely.
  while (JSON.stringify(result).length > budget) {
    const fields = result
      .flatMap((item) => ["base", "head"].map((key) => ({ item, key })))
      .filter(({ item, key }) => item[key].length);
    // Prefer current contracts over historical excerpts. Preserve complete small
    // modules and complete invoked scripts while partial evidence can be reduced.
    const candidates = fields.filter(({ item, key }) =>
      key === "base" ? item[key].length > 400 : !item.headComplete && item[key].length > 2000,
    );
    const partial = fields.filter(({ item, key }) => key === "base" || !item.headComplete);
    const largest = (candidates.length ? candidates : partial.length ? partial : fields).sort(
      (a, b) =>
        Number(b.key === "base") - Number(a.key === "base") ||
        b.item[b.key].length - a.item[a.key].length,
    )[0];
    if (!largest?.item[largest.key].length) break;
    const text = largest.item[largest.key];
    if (/\.[cm]?[jt]sx?$/.test(largest.item.path)) {
      const lines = text.split("\n");
      const raw = lines.map((line) => line.replace(/^\d+: /, "")).join("\n");
      const { source } = declarationAnalysis(raw);
      const last = source.statements.at(-1);
      const start = last ? source.getLineAndCharacterOfPosition(last.getStart(source)).line : 0;
      largest.item[largest.key] = lines.slice(0, start).join("\n");
    } else largest.item[largest.key] = text.slice(0, -100);
    largest.item[`${largest.key}Complete`] = false;
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
  reviewedBase,
  gitReader,
  enrichFiles,
  declarationSymbols,
  declarationSymbolsAtLine,
  changedContractSymbols,
  declarationDigests,
  relevantDeclarations,
  clipContext,
  contentKey,
};
