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
      ![request.symbol, request.fragment].some((text) => typeof text === "string" && text.trim()) ||
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
  const visit = (node) => {
    const declared =
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isVariableDeclaration(node)) &&
      node.name?.getText(source);
    if (declared && names.has(declared)) {
      selected.push(node);
      foundNames.add(declared);
      return;
    }
    ts.forEachChild(node, visit);
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
    text: selected.map((node) => node.getText(source)).join("\n"),
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
  ]);
}
module.exports = {
  requestKey,
  evidenceRequests,
  recoverEvidence,
  MAX_REQUESTS,
  MAX_FRAGMENT,
  MAX_RECOVERED,
};
