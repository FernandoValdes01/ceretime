#!/usr/bin/env node
// Lists installed UI components that no showcase file renders: an import counts
// only when one of its names is used in that file outside imports and comments.
// Usage: node showcase-coverage.mjs <ui-dir> <showcase-dir...>
import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename, extname, join, resolve } from "node:path"

const [uiArg, ...roots] = process.argv.slice(2)

if (!uiArg || roots.length === 0) {
  console.error("Usage: node showcase-coverage.mjs <ui-dir> <showcase-dir...>")
  process.exit(1)
}

const uiDir = resolve(uiArg)

const components = readdirSync(uiDir)
  .filter((file) => [".tsx", ".ts"].includes(extname(file)))
  .map((file) => basename(file, extname(file)))

function walk(path) {
  if (statSync(path).isFile()) {
    return [path]
  }

  return readdirSync(path).flatMap((entry) => {
    const child = join(path, entry)
    // Skip the ui directory so components don't count as using each other.
    if (entry === "node_modules" || child === uiDir) {
      return []
    }
    return walk(child)
  })
}

const IMPORT_RE = /import\s+([^;]*?)\s+from\s+["']([^"']*\/ui\/[^"']+)["']/g
const COMMENT_RE = /\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm

// Local names bound by an import clause: default, namespace and named (after `as`).
function importedNames(clause) {
  return [...clause.matchAll(/(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s*(?=[,}]|$)/g)]
    .map((match) => match[1])
    .filter((name) => name !== "as" && name !== "type")
}

const shown = new Set()

for (const root of roots.map((entry) => resolve(entry))) {
  for (const file of walk(root).filter((path) => /\.(tsx?|jsx?)$/.test(path))) {
    const code = readFileSync(file, "utf8").replace(COMMENT_RE, "$1")
    const body = code.replace(IMPORT_RE, "")

    for (const [, clause, specifier] of code.matchAll(IMPORT_RE)) {
      const names = importedNames(clause.replace(/^type\s+/, ""))
      if (names.some((name) => new RegExp(`\\b${name}\\b`).test(body))) {
        shown.add(basename(specifier))
      }
    }
  }
}

const missing = components.filter((name) => !shown.has(name))

console.log(
  `${components.length - missing.length}/${components.length} components shown.`
)

if (missing.length > 0) {
  console.log(`Missing: ${missing.join(", ")}`)
  process.exit(1)
}
