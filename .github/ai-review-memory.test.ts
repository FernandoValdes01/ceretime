import { fixtureVerifier } from "./ai-review-test-verifier.cjs";
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPlan, reviewPlan } from "./ai-review-chunks.cjs";
import { TTL_MS, memoryIdentity, createMemory } from "./ai-review-memory.cjs";

const sha = "a".repeat(40);
const instructions = "CERETIME: autorización en backend.";
const assessment = { findings: [], resolutions: [] };
const valid = () => ({
  ok: true,
  headers: new Headers(),
  json: async () => ({
    usage: {
      prompt_tokens: 1000,
      completion_tokens: 100,
      prompt_tokens_details: { cached_tokens: 200 },
    },
    choices: [{ message: { content: JSON.stringify(assessment) } }],
  }),
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "r2d2-memory-"));
  const files = ["one.ts", "two.ts"].map((filename) => ({
    filename,
    additions: 100,
    deletions: 0,
    patch: `@@ -0,0 +1,100 @@\n${Array.from({ length: 100 }, () => `+${"x".repeat(75)}`).join("\n")}`,
  }));
  const plan = buildPlan(files, { chunking: { chunkChars: 12000 } }, sha);
  const identity = memoryIdentity(plan, instructions);
  const memory = createMemory({ directory, identity, apiKey: "simulation" });
  const options = { plan, instructions, apiKey: "simulation", sleep: async () => {}, memory };
  return {
    directory,
    plan,
    identity,
    memory,
    options,
    clean: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("resumes partial quota failure using valid blocks instead of reviewing them again", async () => {
  const f = fixture();
  let calls = 0;
  try {
    const first = await reviewPlan({
      verify: fixtureVerifier,
      ...f.options,
      fetchImpl: async () => {
        if (++calls === 1) return valid();
        return { ok: false, status: 429, headers: new Headers({ "retry-after": "3600" }) };
      },
    });
    expect(first.coverage).toBe("incomplete");
    expect(first.processed).toBe(2);
    expect(first.usage).toEqual({
      prompt: 1000,
      completion: 100,
      cachedPrompt: 200,
      measuredCalls: 1,
    });
    const resumed = await reviewPlan({
      verify: fixtureVerifier,
      ...f.options,
      fetchImpl: async () => {
        calls++;
        return valid();
      },
    });
    expect(resumed.coverage).toBe("complete");
    expect(resumed.score).toBe(5);
    expect(resumed.reused).toBe(1);
    expect(resumed.calls).toBe(f.plan.chunks.length - 1);
    expect(resumed.usage.prompt).toBe(1000 * resumed.calls);
    const complete = await reviewPlan({
      verify: fixtureVerifier,
      ...f.options,
      fetchImpl: async () => {
        throw new Error("No network expected");
      },
    });
    expect(complete.coverage).toBe("complete");
    expect(complete.reused).toBe(f.plan.chunks.length);
    expect(complete.calls).toBe(0);
    expect(complete.usage.prompt).toBe(0);
  } finally {
    f.clean();
  }
});

for (const change of [
  "base",
  "instructions",
  "model-policy",
  "expiry",
  "signature",
  "corruption",
  "credentials",
]) {
  test(`memory misses safely after ${change}`, () => {
    const f = fixture();
    try {
      f.memory.set(f.plan.chunks[0].parts[0], assessment);
      let identity = f.identity,
        now = Date.now,
        apiKey = "simulation";
      if (change === "base")
        identity = memoryIdentity({ ...f.plan, base: "b".repeat(40) }, instructions);
      if (change === "instructions")
        identity = memoryIdentity(f.plan, `${instructions} Nueva regla.`);
      if (change === "model-policy")
        identity = memoryIdentity(
          { ...f.plan, limits: { ...f.plan.limits, outputTokens: 500 } },
          instructions,
        );
      if (change === "expiry") now = () => Date.now() + TTL_MS + 1;
      if (change === "credentials") apiKey = "rotated";
      const file = join(f.directory, readdirSync(f.directory)[0]);
      if (change === "corruption") writeFileSync(file, "invalid JSON");
      if (change === "signature") {
        const data = JSON.parse(readFileSync(file, "utf8"));
        data.payload.assessment.findings = ["tampered"];
        writeFileSync(file, JSON.stringify(data));
      }
      expect(
        createMemory({ directory: f.directory, identity, apiKey, now }).get(
          f.plan.chunks[0].parts[0],
        ),
      ).toBeNull();
      expect(readFileSync(file, "utf8")).not.toContain("simulation");
      expect(readFileSync(file, "utf8")).not.toContain("patch");
    } finally {
      f.clean();
    }
  });
}

test("cached invalid assessments and stale heads never become completed coverage", async () => {
  const f = fixture();
  try {
    f.memory.set(f.plan.chunks[0].parts[0], {
      ...assessment,
      findings: [
        {
          path: "one.ts",
          side: "RIGHT",
          line: 1,
          severity: "important",
          issue_key: "invalid",
          cause: "",
          impact: "Unauthorized access.",
          fix: "Require ownership.",
        },
      ],
    });
    const recovered = await reviewPlan({
      verify: fixtureVerifier,
      ...f.options,
      fetchImpl: async () => valid(),
    });
    expect(recovered.calls).toBe(f.plan.chunks.length);
    expect(recovered.reused).toBe(0);
    const stale = await reviewPlan({
      verify: fixtureVerifier,
      ...f.options,
      isCurrent: async () => false,
      fetchImpl: async () => valid(),
    });
    expect(stale.coverage).toBe("incomplete");
    expect(stale.score).toBe(0);
    expect(stale.calls).toBe(0);
  } finally {
    f.clean();
  }
});

test("cache workflow uses exact scope, saves partial progress and adds no permission", () => {
  const workflow = readFileSync(join(import.meta.dir, "workflows/ai-code-review.yml"), "utf8");
  expect(workflow).toContain("actions/cache/restore@0057852bfaa89a56745cba8c7296529d2fc39830");
  expect(workflow).toContain("actions/cache/save@0057852bfaa89a56745cba8c7296529d2fc39830");
  expect(workflow).toContain("steps.prepare.outputs.memory_key");
  expect(workflow).not.toContain("actions: write");
  expect(workflow).not.toContain("actions: read");
  expect(memoryIdentity({ sha: "a", base: "main", limits: {} }, instructions)).toBe(
    memoryIdentity({ sha: "b", base: "main", limits: {} }, instructions),
  );
});

test("a signed checkpoint copied to a different block is never accepted", () => {
  const f = fixture();
  try {
    f.memory.set(f.plan.chunks[0].parts[0], assessment);
    const first = readdirSync(f.directory)[0];
    f.memory.set(f.plan.chunks[1].parts[0], assessment);
    const second = readdirSync(f.directory).find((name) => name !== first)!;
    writeFileSync(join(f.directory, second), readFileSync(join(f.directory, first)));
    expect(f.memory.get(f.plan.chunks[1].parts[0])).toBeNull();
  } finally {
    f.clean();
  }
});
