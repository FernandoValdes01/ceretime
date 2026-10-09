import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrichFiles } from "./ai-review-context.cjs";
import { buildPlan, validateAssessment } from "./ai-review-chunks.cjs";
import { evaluateReview } from "./ai-review-score.cjs";
import { formatReview } from "./ai-review-presentation.cjs";

const sha = "a".repeat(40);
const rename = () => ({
  filename: "new.ts",
  previous_filename: "old.ts",
  status: "renamed",
  additions: 0,
  deletions: 0,
});
test("pure rename records paths without inventing a hunk and accepts general findings", () => {
  const plan = buildPlan([rename()], {}, sha);
  const part = plan.chunks[0].parts[0];
  expect(part.patch).not.toContain("@@");
  expect(part.change).toEqual({ oldPath: "old.ts", newPath: "new.ts", contentChanged: false });
  const result = validateAssessment(
    {
      findings: [
        {
          scope: "pull_request",
          path: "new.ts",
          severity: "important",
          issue_key: "broken-import",
          cause: "The move leaves a consumer importing old.ts",
          impact: "Module resolution fails",
          fix: "Update the consumer import",
        },
      ],
    },
    plan.chunks[0],
  );
  expect(result.findings[0].scope).toBe("pull_request");
});
test("rename reads history at previous path and retains consumers of the removed path", () => {
  const directory = mkdtempSync(join(tmpdir(), "r2d2-rename-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    writeFileSync(join(directory, "old.ts"), "export const stableIdentity = 42;\n");
    writeFileSync(
      join(directory, "consumer.ts"),
      "import { stableIdentity } from './old';\nexport const value = stableIdentity;\n",
    );
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    git("mv", "old.ts", "new.ts");
    git("commit", "-qm", "rename");
    const file: any = rename();
    enrichFiles([file], { directory, base, sha: git("rev-parse", "HEAD") });
    const own = file.context.find((c: any) => c.path === "new.ts");
    expect(own.base).toContain("stableIdentity");
    expect(own.basePath).toBe("old.ts");
    expect(file.context.some((c: any) => c.path === "consumer.ts")).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("complete block processing with missing evidence reports incomplete review without a quality zero", () => {
  const summary = `Review status: incomplete; Risk: low; Reviewed commit: ${sha}; Hallazgos: 0; Resumen: Procesados 13/13 bloques. Falta contrato de imports.`;
  const result = evaluateReview({
    outcome: "success",
    summary,
    risk: "low",
    commentsCount: "0",
    expectedSha: sha,
    currentSha: sha,
    coverage: "incomplete",
  });
  expect(result.description).not.toContain("no se completaron todos");
  const body = formatReview(result, sha, "https://github.com/test/repo/actions/runs/1", "0", {
    report: {
      processed: 13,
      total: 13,
      calls: 13,
      coverage: "incomplete",
      reasons: ["Falta contrato de imports."],
    },
  });
  expect(body).toContain("Revisión incompleta");
  expect(body).not.toContain("Confidence Score: 0/5");
});
