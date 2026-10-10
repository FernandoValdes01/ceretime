import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrichFiles } from "./ai-review-context.cjs";
function context(files: Record<string, string>, after: string) {
  const directory = mkdtempSync(join(tmpdir(), "r2d2-context-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    for (const [name, text] of Object.entries(files)) writeFileSync(join(directory, name), text);
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    writeFileSync(join(directory, "target.ts"), after);
    git("add", ".");
    git("commit", "-qm", "head");
    const sha = git("rev-parse", "HEAD");
    const raw = git("diff", "--unified=3", base, sha, "--", "target.ts");
    const file: any = {
      filename: "target.ts",
      status: "modified",
      patch: raw.slice(raw.indexOf("@@")),
    };
    enrichFiles([file], { directory, base, sha });
    return file.context;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
test("related tests survive more than eight direct imports within the context budget", () => {
  const modules = Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [`dep${i}.ts`, `export const dep${i}=${i};\n`]),
  );
  const before =
    Array.from({ length: 9 }, (_, i) => `import {dep${i}} from './dep${i}';`).join("\n") +
    "\nexport function total() {return " +
    Array.from({ length: 9 }, (_, i) => `dep${i}`).join("+") +
    ";}\n";
  const result = context(
    {
      ...modules,
      "target.ts": before,
      "target.test.ts": "import {total} from './target';\n// Regression for the result.\n",
    },
    before.replace("return dep0", "return 1+dep0"),
  );
  expect(result.some((item: any) => item.path === "target.test.ts")).toBe(true);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(12000);
});
test("AST retrieval preserves the full distant helper used by the changed function", () => {
  const before =
    "function stableIdentity(value: string) {\n return `assigned-before-sort:${value}`;\n}\n" +
    Array.from({ length: 240 }, (_, i) => `// padding ${i} ${"x".repeat(50)}`).join("\n") +
    "\nexport function changed(value: string) {\n return stableIdentity(value);\n}\n";
  const result = context(
    { "target.ts": before },
    before.replace("return stableIdentity(value);", "return stableIdentity(value.trim());"),
  );
  expect(result[0].head).toContain("assigned-before-sort:");
  expect(result[0].head).toContain("return stableIdentity(value.trim());");
  expect(result[0].headComplete).toBe(false);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(12000);
});
