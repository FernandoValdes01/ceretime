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
    unresolved = [];
  for (const request of evidenceRequests(requests)) {
    const state = readState(request.side === "base" ? base : sha, request.path);
    if (state.status !== "present") {
      unresolved.push({ ...request, availability: state.status, detail: state.reason });
      continue;
    }
    const needle = request.symbol ?? request.fragment;
    const source = ts.createSourceFile(
      request.path,
      state.text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const statement = source.statements.find((node) => {
      if (request.fragment) return node.getText(source).includes(needle);
      if (ts.isVariableStatement(node))
        return node.declarationList.declarations.some((d) => d.name.getText(source) === needle);
      return node.name?.getText(source) === needle;
    });
    const start = statement?.getStart(source) ?? state.text.indexOf(needle);
    if (start < 0) {
      unresolved.push({
        ...request,
        availability: "symbol_absent",
        detail: "El símbolo o fragmento no existe en este commit.",
      });
      continue;
    }
    const text =
      statement?.getText(source) ?? state.text.slice(Math.max(0, start - 400), start + 1600);
    if (text.length > MAX_FRAGMENT || recoveredChars + text.length > MAX_RECOVERED) {
      unresolved.push({
        ...request,
        availability: "too_large",
        detail: "La declaración supera el presupuesto de recuperación.",
      });
      continue;
    }
    const imports = source.statements
      .filter((node) => ts.isImportDeclaration(node))
      .map((node) => node.getText(source))
      .join("\n");
    const fragment = (imports + "\n" + text).trim();
    if (fragment.length > MAX_FRAGMENT || recoveredChars + fragment.length > MAX_RECOVERED) {
      unresolved.push({
        ...request,
        availability: "too_large",
        detail: "Imports y declaración superan el presupuesto de recuperación.",
      });
      continue;
    }
    recoveredChars += fragment.length;
    recovered.push({
      path: request.path,
      side: request.side,
      text: fragment,
      complete: fragment === state.text.trim(),
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
      });
    }
    return {
      ...part,
      context,
      evidenceRecovery: [
        ...new Map(
          [...(part.evidenceRecovery ?? []), ...unresolved].map((request) => [
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
function requestKey(request) {
  return JSON.stringify([
    request.path,
    request.side ?? "head",
    request.symbol ?? null,
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
