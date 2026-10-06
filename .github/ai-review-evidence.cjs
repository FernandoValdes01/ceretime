const { gitReader, hash } = require("./ai-review-context.cjs");
const { createRequire } = require("node:module");
const path = require("node:path");
const ts = createRequire(path.join(__dirname, "../apps/web/package.json"))("typescript");
const MAX_REQUESTS = 8;
const MAX_FRAGMENT = 4000;
const MAX_RECOVERED = 16000;

function evidenceRequests(value = []) {
  if (!Array.isArray(value) || value.length > MAX_REQUESTS)
    throw new Error("Solicitudes de evidencia fuera del límite.");
  return value.map((request) => {
    if (
      !request ||
      typeof request.path !== "string" ||
      request.path.length > 300 ||
      !/^[a-zA-Z0-9_.@/ -]+$/.test(request.path) ||
      request.path.startsWith("/") ||
      request.path.split("/").some((part) => !part || part === "." || part === "..") ||
      !["base", "head"].includes(request.side ?? "head") ||
      (request.cursor != null &&
        (!Number.isInteger(request.cursor) || request.cursor < 0 || request.cursor > 200000)) ||
      typeof request.reason !== "string" ||
      !request.reason.trim() ||
      request.reason.length > 800 ||
      (request.forPath != null &&
        (typeof request.forPath !== "string" ||
          !/^[a-zA-Z0-9_.@/ -]+$/.test(request.forPath) ||
          request.forPath.startsWith("/") ||
          request.forPath.split("/").some((part) => !part || part === "." || part === ".."))) ||
      (request.scope != null && request.scope !== "file") ||
      (request.scope !== "file" &&
        ![request.symbol, request.fragment].some(
          (text) => typeof text === "string" && text.trim(),
        )) ||
      [request.symbol, request.fragment].some(
        (text) => text != null && (typeof text !== "string" || !text.trim() || text.length > 300),
      )
    )
      throw new Error("Solicitud de evidencia inválida.");
    return { ...request, side: request.side ?? "head" };
  });
}

function recoverEvidence({ directory, base, sha, chunk, requests }) {
  const { readState } = gitReader(directory);
  let recoveredChars = 0;
  const recovered = [],
    unresolved = [],
    fulfilled = [];
  for (const request of evidenceRequests(requests)) {
    const state = readState(request.side === "base" ? base : sha, request.path);
    if (state.status !== "present") {
      unresolved.push({ ...request, availability: state.status, detail: state.reason });
      continue;
    }
    const selected = selectEvidence(state.text, request);
    if (!selected) {
      unresolved.push({
        ...request,
        availability: "symbol_absent",
        detail:
          "El símbolo o fragmento no existe en este commit. Solicita un identificador declarado o una cita literal.",
      });
      continue;
    }
    if (request.scope === "file" && selected.text === "") {
      recovered.push({
        path: request.path,
        side: request.side,
        text: "",
        complete: true,
        declarationComplete: true,
        offset: 0,
        ...(request.forPath
          ? { forPath: request.forPath }
          : chunk.parts.length === 1
            ? { forPath: chunk.parts[0].path }
            : {}),
      });
      fulfilled.push({
        ...request,
        availability: "present",
        detail: "El archivo existe y está vacío.",
      });
      continue;
    }
    const imports = selected.imports;
    if (imports.length >= MAX_FRAGMENT) {
      unresolved.push({
        ...request,
        availability: "too_large",
        detail: "Los imports superan el presupuesto por fragmento.",
      });
      continue;
    }
    let cursor = request.cursor ?? 0;
    if (cursor >= selected.text.length) {
      unresolved.push({
        ...request,
        availability: "invalid_cursor",
        detail: "El cursor no identifica una continuación pendiente de la declaración.",
      });
      continue;
    }
    while (cursor < selected.text.length) {
      const capacity = Math.min(
        MAX_FRAGMENT - imports.length,
        MAX_RECOVERED - recoveredChars - imports.length,
      );
      if (capacity <= 0) break;
      const end = Math.min(selected.text.length, cursor + capacity);
      const text = imports + selected.text.slice(cursor, end);
      recoveredChars += text.length;
      recovered.push({
        path: request.path,
        side: request.side,
        text,
        complete: cursor === 0 && end === selected.text.length && text.trim() === state.text.trim(),
        declarationComplete: end === selected.text.length,
        offset: cursor,
        ...(request.forPath
          ? { forPath: request.forPath }
          : chunk.parts.length === 1
            ? { forPath: chunk.parts[0].path }
            : {}),
      });
      cursor = end;
    }
    if (cursor >= selected.text.length && selected.missing?.length) {
      unresolved.push({
        ...request,
        availability: "symbol_absent",
        detail: `No se encontraron estas declaraciones: ${selected.missing.join(", ")}.`,
      });
    } else if (cursor >= selected.text.length) {
      const { cursor: _cursor, ...completeRequest } = request;
      fulfilled.push({
        ...completeRequest,
        availability: "present",
        detail: "La declaración solicitada fue recuperada.",
      });
    }
    if (cursor < selected.text.length)
      unresolved.push({
        ...request,
        cursor,
        availability: "partial",
        detail: "Declaración recuperada parcialmente; la siguiente ronda continúa desde el cursor.",
      });
  }
  const parts = chunk.parts.map((part) => {
    const context = structuredClone(part.context ?? []);
    for (const item of recovered) {
      const relatedPaths = new Set([
        part.path,
        part.change?.oldPath,
        part.previousPath,
        ...context.map((entry) => entry.path),
      ]);
      // Attach a request to the changed part that requested its contract, not
      // every unrelated change that happened to share the provider block.
      const requestPart =
        item.forPath ?? (chunk.parts.length === 1 ? chunk.parts[0].path : undefined);
      if (requestPart && requestPart !== part.path) continue;
      if (!requestPart && !relatedPaths.has(item.path)) continue;
      // Keep recovered declarations separate from an existing excerpt; never replace other evidence.
      context.push({
        path: item.path,
        base: item.side === "base" ? item.text : "",
        head: item.side === "head" ? item.text : "",
        baseState: item.side === "base" ? "present" : "not_requested",
        headState: item.side === "head" ? "present" : "not_requested",
        baseComplete: item.side === "base" && item.complete,
        headComplete: item.side === "head" && item.complete,
        recovered: true,
        declarationComplete: item.declarationComplete,
        offset: item.offset,
        ...(item.forPath ? { forPath: item.forPath } : {}),
      });
    }
    return {
      ...part,
      context,
      evidenceRecovery: [
        ...new Map(
          [...(part.evidenceRecovery ?? []), ...fulfilled, ...unresolved].map((request) => [
            requestKey(request),
            request,
          ]),
        ).values(),
      ],
      contextKey: hash(JSON.stringify({ previous: part.contextKey, recovered })),
    };
  });
  return { chunk: { ...chunk, parts }, recovered: recovered.length, unresolved, recoveredChars };
}
function selectEvidence(text, request) {
  if (request.scope === "file") return { text, imports: "" };
  if (/\.ya?ml$/.test(request.path)) {
    const needle = (request.fragment ?? request.symbol).replace(/^(?:paso|step)\s+/i, "");
    const lines = text.split("\n");
    const at = lines.findIndex((line) => line.includes(needle));
    if (at < 0) return null;
    let start = at;
    while (start > 0 && !/^\s*- name:/.test(lines[start])) start--;
    if (!/^\s*- name:/.test(lines[start])) start = Math.max(0, at - 10);
    const indent = lines[start].match(/^ */)[0].length;
    let end = at + 1;
    while (end < lines.length && (!lines[end].trim() || lines[end].match(/^ */)[0].length > indent))
      end++;
    return { text: lines.slice(start, end).join("\n"), imports: "" };
  }
  const source = ts.createSourceFile(
    request.path,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const names = new Set(
    (request.symbol ?? "").split("(")[0].match(/[a-zA-Z_$][a-zA-Z0-9_$]*/g) ?? [],
  );
  const selected = [];
  const foundNames = new Set();
  const visit = (node, owner = null) => {
    const isDeclaration =
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isVariableDeclaration(node);
    const declared = isDeclaration && node.name?.getText(source);
    if (declared && names.has(declared)) {
      selected.push(node);
      foundNames.add(declared);
      return;
    }
    const property =
      (ts.isPropertyAssignment(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isPropertySignature(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isPropertyAccessExpression(node)) &&
      ts.isIdentifier(node.name)
        ? node.name.text
        : ts.isShorthandPropertyAssignment(node)
          ? node.name.text
          : null;
    if (property && names.has(property) && owner) {
      selected.push(owner);
      foundNames.add(property);
    }
    const nextOwner = isDeclaration && node.name ? node : owner;
    ts.forEachChild(node, (child) => visit(child, nextOwner));
  };
  if (request.symbol) visit(source);
  if (request.fragment) {
    const node = source.statements.find((statement) =>
      statement.getText(source).includes(request.fragment),
    );
    if (node) selected.push(node);
    else {
      const at = text.indexOf(request.fragment);
      if (at >= 0) return { text: text.slice(Math.max(0, at - 400), at + 1600), imports: "" };
    }
  }
  if (!selected.length) return null;
  const imports = source.statements
    .filter((node) => ts.isImportDeclaration(node))
    .map((node) => node.getText(source))
    .join("\n");
  return {
    missing: request.symbol?.split("(")[0].includes(",")
      ? [...names].filter((name) => !foundNames.has(name))
      : [],
    text: [...new Set(selected)].map((node) => node.getText(source)).join("\n"),
    imports: imports ? imports + "\n" : "",
  };
}
function requestKey(request) {
  const identifiers = request.symbol
    ?.split("(")[0]
    .split(",")
    .map((name) => name.trim())
    .filter((name) => /^[$A-Za-z_][$\w]*$/.test(name))
    .sort();
  return JSON.stringify([
    request.path,
    request.side ?? "head",
    identifiers?.length ? identifiers.join(",") : (request.symbol ?? null),
    request.fragment ?? null,
    request.scope ?? null,
    request.forPath ?? null,
  ]);
}
// Resolve legacy free-text limitations only against declarations and paths in
// the changed module's bounded dependency neighborhood. Ambiguity stays visible.
function inferEvidenceRequests({ directory, sha, chunk, limitations }) {
  const { readState } = gitReader(directory);
  const paths = new Set(
    chunk.parts.flatMap((part) => [part.path, ...(part.context ?? []).map((entry) => entry.path)]),
  );
  for (const part of chunk.parts) {
    const state = readState(sha, part.path);
    if (state.status !== "present") continue;
    for (const match of state.text.matchAll(/(?:from\s*|require\(\s*)["'](\.[^"']+)["']/g)) {
      const stem = path.posix.normalize(path.posix.join(path.posix.dirname(part.path), match[1]));
      if (stem.startsWith("../")) continue;
      for (const candidate of [
        stem,
        ...[".ts", ".tsx", ".cjs", ".js", "/index.ts", "/index.tsx"].map((suffix) => stem + suffix),
      ]) {
        if (readState(sha, candidate).status === "present") {
          paths.add(candidate);
          break;
        }
      }
    }
  }
  const sources = [...paths]
    .slice(0, 32)
    .map((filename) => ({ path: filename, state: readState(sha, filename) }))
    .filter(({ state }) => state.status === "present");
  const requests = [];
  for (const reason of limitations ?? []) {
    const tokens = new Set(reason.match(/[A-Za-z_$][\w$]*/g) ?? []);
    const matched = [];
    for (const source of sources.filter(({ path }) => /\.(?:[cm]?js|tsx?)$/.test(path))) {
      const tree = ts.createSourceFile(
        source.path,
        source.state.text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const visit = (node) => {
        if (
          (ts.isFunctionDeclaration(node) ||
            ts.isClassDeclaration(node) ||
            ts.isInterfaceDeclaration(node) ||
            ts.isTypeAliasDeclaration(node) ||
            ts.isVariableDeclaration(node)) &&
          node.name
        ) {
          const symbol = node.name.getText(tree);
          if (tokens.has(symbol) && /^[$A-Za-z_][$\w]*$/.test(symbol))
            matched.push({ path: source.path, symbol, side: "head", reason });
        }
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }
    const unique = [...new Map(matched.map((request) => [request.symbol, request])).values()];
    // A named declaration must occur in exactly one candidate file.
    const candidates = unique.filter(
      (request) => matched.filter((item) => item.symbol === request.symbol).length === 1,
    );
    if (!candidates.length) {
      const explicit = sources.filter((source) => reason.includes(source.path));
      if (explicit.length === 1)
        candidates.push({ path: explicit[0].path, scope: "file", side: "head", reason });
    }
    const fresh = candidates.filter(
      (request) => !requests.some((old) => requestKey(old) === requestKey(request)),
    );
    if (candidates.length && requests.length + fresh.length <= MAX_REQUESTS)
      requests.push(...fresh);
  }
  // Only the subsequent analysis may resolve a limitation. A unique symbol
  // within a mixed limitation does not prove that its other assumptions hold.
  return { requests: evidenceRequests(requests), limitations: [...(limitations ?? [])] };
}
module.exports = {
  requestKey,
  inferEvidenceRequests,
  evidenceRequests,
  recoverEvidence,
  MAX_REQUESTS,
  MAX_FRAGMENT,
  MAX_RECOVERED,
};
