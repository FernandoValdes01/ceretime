const { execFileSync } = require("node:child_process");

const BINARY =
  /\.(?:png|jpe?g|gif|webp|ico|avif|pdf|woff2?|ttf|eot|mp[34]|wav|zip|gz|7z|jar|apk|aab|so|dll|exe|bin)$/i;
const GENERATED =
  /(?:^|\/)(?:node_modules|vendor|dist|build|coverage|\.expo|\.next)\/|(?:\.min\.(?:js|css)|\.map|\.generated\.[^/]+|\.gen\.[^/]+|\.lock|\.lockb)$|(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|go\.sum|skills-lock\.json)$/;
const CONFIG = /\.(?:jsonc?|ya?ml|toml|ini|conf|config|env)$/i;
const PACKAGE_KEYS = new Set([
  "name",
  "version",
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "overrides",
  "resolutions",
  "scripts",
  "engines",
  "packageManager",
  "workspaces",
  "exports",
  "imports",
  "main",
  "module",
  "types",
  "type",
  "bin",
  "files",
  "private",
  "publishConfig",
  "sideEffects",
  "os",
  "cpu",
]);

function matchesIgnore(path, patterns) {
  return patterns.some((pattern) => {
    const source = [...pattern]
      .map((char) =>
        char === "*" ? ".*" : char === "?" ? "." : char.replace(/[.+^${}()|[\]\\]/g, "\\$&"),
      )
      .join("");
    return new RegExp(`^${source}$`).test(pattern.includes("/") ? path : path.split("/").at(-1));
  });
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  return value;
}

function parseConfig(text, path) {
  if (path.endsWith(".json")) return JSON.parse(text);
  if (/\.ya?ml$/.test(path)) {
    if (typeof Bun !== "undefined") return Bun.YAML.parse(text);
    return JSON.parse(
      execFileSync(
        "bun",
        ["-e", "console.log(JSON.stringify(Bun.YAML.parse(await Bun.stdin.text())))"],
        { input: text, encoding: "utf8", maxBuffer: 1024 * 1024 },
      ),
    );
  }
  throw new Error("Configuración sin parser semántico.");
}

// Preserve literals, comments and line breaks. Never hide ASI or string changes.
function spacingOnly(before, after) {
  // Without a parser, discard only indentation and trailing whitespace in plain JS/TS.
  // Templates and continued literals can make even indentation functional.
  if ([before, after].some((text) => text.includes("`") || /\\\r?\n/.test(text))) return false;
  const normalize = (text) =>
    text
      .split("\n")
      .map((line) => line.replace(/^[ \t]+|[ \t]+$/g, ""))
      .join("\n");
  return normalize(before) === normalize(after);
}

function classifyFile(file, config = {}) {
  const path = file.filename;
  if (
    matchesIgnore(path, config.ignore_paths ?? []) ||
    GENERATED.test(path) ||
    /(?:^|\/)docs\/evidence\/.*\.(?:xml|patch)$/i.test(path)
  )
    return { eligible: false, reason: "generated-or-ignored" };
  if (BINARY.test(path) || file.binary) return { eligible: false, reason: "binary" };
  const contractDoc = matchesIgnore(
    path,
    config.selection?.contract_docs ?? [
      "CONTEXT.md",
      "DESIGN.md",
      "docs/adr/**",
      "docs/adrs/**",
      "docs/contracts/**",
    ],
  );
  if (/\.(?:md|mdx|txt|tex|rst)$/i.test(path) && !contractDoc)
    return { eligible: false, reason: "documentation" };
  if (
    file.status !== "renamed" &&
    typeof file.before === "string" &&
    typeof file.after === "string"
  ) {
    if (CONFIG.test(path)) {
      try {
        let before = parseConfig(file.before, path),
          after = parseConfig(file.after, path);
        if (path.split("/").at(-1) === "package.json") {
          const relevant = (value) =>
            Object.fromEntries(Object.entries(value).filter(([key]) => PACKAGE_KEYS.has(key)));
          before = relevant(before);
          after = relevant(after);
        }
        if (JSON.stringify(stable(before)) === JSON.stringify(stable(after)))
          return { eligible: false, reason: "configuration-without-functional-change" };
      } catch {
        /* Invalid or unfamiliar configuration must remain reviewable. */
      }
    } else if (
      /\.[cm]?[jt]s$/.test(path) &&
      !/<[A-Za-z]/.test(file.before + file.after) &&
      spacingOnly(file.before, file.after)
    )
      return { eligible: false, reason: "spacing-only" };
  }
  if (
    /^(?:\/\/|#|\/\*)[^\n]*(?:@generated|auto-generated|DO NOT EDIT)/im.test(
      (file.after ?? "").slice(0, 1500),
    )
  )
    return { eligible: false, reason: "generated" };
  if (path.startsWith(".github/workflows/"))
    return {
      eligible: true,
      kind: "workflow",
      focus: "Cambios de eventos, permisos, secretos, ejecución, CI y despliegue.",
    };
  if (
    CONFIG.test(path) ||
    /(?:^|\/)(?:Dockerfile|Makefile|\.gitignore|\.npmrc)$|(?:config|schema)\.[cm]?[jt]s$/.test(path)
  )
    return {
      eligible: true,
      kind: "configuration",
      focus:
        "Revisa solo dependencias, scripts, permisos, build, CI, seguridad y comportamiento. No trates esta configuración como código general.",
    };
  if (contractDoc)
    return {
      eligible: true,
      kind: "contract",
      focus:
        "Revisa contradicciones funcionales en contratos y decisiones, no redacción ni formato.",
    };
  return { eligible: true, kind: /(?:test|spec)\.[^.]+$/.test(path) ? "test" : "source" };
}

module.exports = { classifyFile, matchesIgnore, stable, parseConfig, PACKAGE_KEYS };
