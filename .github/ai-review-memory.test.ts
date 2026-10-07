import { fixtureVerifier } from "./ai-review-test-verifier.cjs";
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPlan, reviewPlan } from "./ai-review-chunks.cjs";
import { contentKey, hash } from "./ai-review-context.cjs";
import { TTL_MS, memoryIdentity, createMemory } from "./ai-review-memory.cjs";

const sha = "a".repeat(40);
const instructions = "CERETIME: autorización en backend.";
const assessment = { findings: [], resolutions: [] };
const valid = (data: any = assessment) => ({
  ok: true,
  headers: new Headers(),
  json: async () => ({
    usage: {
      prompt_tokens: 1000,
      completion_tokens: 100,
      prompt_tokens_details: { cached_tokens: 200 },
    },
    choices: [{ message: { content: JSON.stringify(data) } }],
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

function recoveredFixture() {
  const directory = mkdtempSync(join(tmpdir(), "r2d2-evidence-memory-"));
  const head = sha;
  const base = "b".repeat(40);
  const evidence = new Map([
    ["A.ts", `contract A ${"a".repeat(7100)}`],
    ["B.ts", `contract B ${"b".repeat(7100)}`],
    ["C.ts", `contract C ${"c".repeat(7100)}`],
  ]);
  const currentRefs: Record<string, string> = { head, base };
  const readEvidence = (dependency: any) => {
    if (dependency.ref !== currentRefs[dependency.side]) return null;
    const text = evidence.get(dependency.path);
    return text == null
      ? { status: "absent", hash: null }
      : { status: "present", hash: hash(text) };
  };
  const newPlan = () => {
    const plan = buildPlan(
      [
        {
          filename: "changed.ts",
          status: "modified",
          additions: 4,
          deletions: 0,
          patch: `@@ -0,0 +1,4 @@\n${Array.from({ length: 4 }, (_, index) => `+const value${index} = ${index};`).join("\n")}`,
        },
      ],
      { chunking: { chunkChars: 12000 } },
      head,
    );
    plan.base = base;
    plan.baseRef = "main";
    plan.intent = { title: "QA", description: "" };
    return plan;
  };
  const plan = newPlan();
  const identity = memoryIdentity(plan, instructions);
  const memory = createMemory({
    directory,
    identity,
    apiKey: "simulation",
    readEvidence,
  });
  let analysisCalls = 0;
  const respond = (data: any) => ({
    ok: true,
    headers: new Headers(),
    json: async () => ({
      usage: { prompt_tokens: 100, completion_tokens: 20 },
      choices: [{ message: { content: JSON.stringify(data) } }],
    }),
  });
  const run = async (nested = false) => {
    const activePlan = newPlan();
    let runCalls = 0;
    const report = await reviewPlan({
      plan: activePlan,
      instructions,
      apiKey: "simulation",
      memory,
      verify: fixtureVerifier,
      sleep: async () => {},
      fetchImpl: async () => {
        analysisCalls++;
        runCalls++;
        const requests =
          runCalls === 1
            ? ["A.ts", "B.ts"].map((path) => ({
                path,
                symbol: path.slice(0, 1),
                side: "head",
                reason: "Confirmar el contrato llamado por el cambio.",
                forPath: "changed.ts",
              }))
            : nested && runCalls === 2
              ? [
                  {
                    path: "C.ts",
                    symbol: "C",
                    side: "head",
                    reason: "Confirmar el contrato consumido por el helper recuperado.",
                    forPath: "changed.ts",
                  },
                ]
              : [];
        return respond({ findings: [], resolutions: [], evidenceRequests: requests });
      },
      recoverContext: async ({ chunk, requests }: any) => ({
        chunk: {
          ...chunk,
          parts: chunk.parts.map((part: any) => ({
            ...part,
            context: [
              ...(part.context ?? []),
              ...requests.map((request: any) => ({
                path: request.path,
                side: request.side,
                headState: "present",
                head: evidence.get(request.path),
                headComplete: false,
                recovered: true,
                offset: 0,
                forPath: request.forPath,
              })),
            ],
            evidenceDependencies: [
              ...(part.evidenceDependencies ?? []),
              ...requests.map((request: any) => ({
                path: request.path,
                side: request.side,
                ref: request.side === "base" ? activePlan.base : activePlan.sha,
                status: "present",
                hash: hash(evidence.get(request.path)!),
                forPath: request.forPath,
              })),
            ],
          })),
        },
        unresolved: [],
      }),
    });
    return { activePlan, report };
  };
  return {
    directory,
    evidence,
    currentRefs,
    memory,
    identity,
    newPlan,
    run,
    analysisCalls: () => analysisCalls,
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
  "review-policy",
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
      if (change === "review-policy")
        identity = memoryIdentity(
          { ...f.plan, reviewPolicy: { ...f.plan.reviewPolicy, reviewLanguage: "en" } },
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

test("operational limits reuse complete results when their semantic inputs stay equal", async () => {
  const f = fixture();
  try {
    const first = await reviewPlan({
      verify: fixtureVerifier,
      ...f.options,
      fetchImpl: async () => valid(),
    });
    expect(first.coverage).toBe("complete");
    const plan = {
      ...f.plan,
      limits: {
        ...f.plan.limits,
        chunkChars: 11000,
        inputChars: 63000,
        maxChunks: 47,
        maxCalls: 79,
        intervalMs: 250,
        maxRateLimitWaitMs: 590000,
      },
    };
    const identity = memoryIdentity(plan, instructions);
    expect(identity).toBe(f.identity);
    const memory = createMemory({ directory: f.directory, identity, apiKey: "simulation" });
    const repeated = await reviewPlan({
      verify: fixtureVerifier,
      ...f.options,
      plan,
      memory,
      fetchImpl: async () => {
        throw new Error("No network expected for a complete operational cache hit");
      },
    });
    expect(repeated.coverage).toBe("complete");
    expect(repeated.reused).toBe(f.plan.chunks.length);
    expect(repeated.calls).toBe(0);
  } finally {
    f.clean();
  }
});

test("output token ceiling remains part of the semantic memory identity", () => {
  const f = fixture();
  try {
    const changed = {
      ...f.plan,
      limits: { ...f.plan.limits, outputTokens: f.plan.limits.outputTokens - 1 },
    };
    expect(memoryIdentity(changed, instructions)).not.toBe(f.identity);
  } finally {
    f.clean();
  }
});

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
    expect(stale.score).toBeNull();
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

test("a complete evidence recovery caches every verified hash and reuses it without analysis calls", async () => {
  const f = recoveredFixture();
  try {
    const first = await f.run();
    const original = f.newPlan().chunks[0].parts[0];
    const cached = f.memory.get(original);
    expect(first.report.coverage).toBe("complete");
    expect(first.report.reused).toBe(0);
    expect(cached?.evidenceDependencies.map((item: any) => [item.path, item.hash]).sort()).toEqual(
      ["A.ts", "B.ts"].map((path) => [path, hash(f.evidence.get(path)!)]).sort(),
    );

    const callsBeforeReuse = f.analysisCalls();
    const repeated = await f.run();
    expect(repeated.report.coverage).toBe("complete");
    expect(repeated.report.reused).toBe(1);
    expect(repeated.report.calls).toBe(0);
    expect(f.analysisCalls()).toBe(callsBeforeReuse);
  } finally {
    f.clean();
  }
});

test("unrelated complete parts cache after a sibling's evidence recovery", async () => {
  const directory = mkdtempSync(join(tmpdir(), "r2d2-shared-recovery-cache-"));
  const head = "c".repeat(40);
  const base = "d".repeat(40);
  const text = "export const helper = (value: number) => value + 1;";
  const evidenceDependency = {
    path: "helper.ts",
    side: "head" as const,
    ref: head,
    status: "present" as const,
    hash: hash(text),
    forPath: "changed.ts",
  };
  const readEvidence = (item: any) =>
    item.path === "helper.ts" && item.ref === head ? { status: "present", hash: hash(text) } : null;
  const newPlan = () => {
    const plan = buildPlan(
      [
        {
          filename: "changed.ts",
          status: "modified",
          additions: 1,
          deletions: 1,
          patch: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = helper(1);",
        },
        {
          filename: "independent.ts",
          status: "modified",
          additions: 1,
          deletions: 1,
          patch: "@@ -1 +1 @@\n-export const other = 1;\n+export const other = 2;",
        },
      ],
      { chunking: { chunkChars: 12000 } },
      head,
    );
    plan.base = base;
    plan.baseRef = "main";
    plan.mergeBase = base;
    plan.intent = { title: "Shared evidence cache", description: "" };
    return plan;
  };
  const initialPlan = newPlan();
  expect(initialPlan.chunks).toHaveLength(1);
  expect(initialPlan.chunks[0].parts).toHaveLength(2);
  const identity = memoryIdentity(initialPlan, instructions);
  const memory = createMemory({ directory, identity, apiKey: "simulation", readEvidence });
  let analysisCalls = 0;
  const run = (plan: any, fetchImpl: any) =>
    reviewPlan({
      plan,
      instructions,
      apiKey: "simulation",
      memory,
      verify: fixtureVerifier,
      sleep: async () => {},
      fetchImpl,
      recoverContext: async ({ chunk, requests }: any) => ({
        chunk: {
          ...chunk,
          parts: chunk.parts.map((part: any) =>
            requests.some((request: any) => request.forPath === part.path)
              ? {
                  ...part,
                  context: [
                    ...part.context,
                    {
                      path: "helper.ts",
                      head: text,
                      headState: "present",
                      baseState: "not_requested",
                      headComplete: false,
                      recovered: true,
                      evidenceSelector: { symbol: "helper" },
                      forPath: part.path,
                    },
                  ],
                  evidenceDependencies: [evidenceDependency],
                }
              : part,
          ),
        },
        unresolved: [],
      }),
    });
  try {
    const first = await run(newPlan(), async () => {
      analysisCalls++;
      return valid({
        findings: [],
        resolutions: [],
        evidenceRequests:
          analysisCalls === 1
            ? [
                {
                  path: "helper.ts",
                  symbol: "helper",
                  side: "head",
                  reason: "Verificar la dependencia consumida por changed.ts.",
                  forPath: "changed.ts",
                },
              ]
            : [],
      });
    });
    expect(first.coverage).toBe("complete");
    expect(first.calls).toBe(2);

    const cachedChanged = memory.get(
      newPlan().chunks[0].parts.find((part: any) => part.path === "changed.ts"),
    );
    const cachedIndependent = memory.get(
      newPlan().chunks[0].parts.find((part: any) => part.path === "independent.ts"),
    );
    expect(cachedChanged?.evidenceDependencies).toEqual([evidenceDependency]);
    expect(cachedIndependent?.evidenceDependencies).toEqual([]);

    const repeated = await run(newPlan(), async () => {
      throw new Error("A complete unchanged sibling must be reused after evidence recovery.");
    });
    expect(repeated.coverage).toBe("complete");
    expect(repeated.reused).toBe(2);
    expect(repeated.calls).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const changedPath of ["A.ts", "B.ts"]) {
  test(`recovered cache invalidates when ${changedPath} changes`, async () => {
    const f = recoveredFixture();
    try {
      await f.run();
      const original = f.newPlan().chunks[0].parts[0];
      expect(f.memory.get(original)).not.toBeNull();
      f.evidence.set(changedPath, `${f.evidence.get(changedPath)} changed`);
      expect(f.memory.get(original)).toBeNull();

      const beforeReanalysis = f.analysisCalls();
      const updated = await f.run();
      expect(updated.report.coverage).toBe("complete");
      expect(updated.report.reused).toBe(0);
      expect(f.analysisCalls()).toBeGreaterThan(beforeReanalysis);
    } finally {
      f.clean();
    }
  });
}

for (const nested of [false, true]) {
  test(`reconstructing a missing parent from ${nested ? "nested " : ""}cached parts preserves all evidence dependencies`, async () => {
    const f = recoveredFixture();
    try {
      const first = await f.run(nested);
      expect(first.report.coverage).toBe("complete");
      const original = f.newPlan().chunks[0].parts[0];
      const parentPath = join(f.directory, `${contentKey(original)}.json`);
      expect(f.memory.get(original)).not.toBeNull();
      unlinkSync(parentPath);
      expect(f.memory.get(original)).toBeNull();

      const beforeReconstruction = f.analysisCalls();
      const rebuilt = await f.run(nested);
      const cached = f.memory.get(f.newPlan().chunks[0].parts[0]);
      const expectedPaths = nested ? ["A.ts", "B.ts", "C.ts"] : ["A.ts", "B.ts"];
      expect(rebuilt.report.coverage).toBe("complete");
      expect(rebuilt.report.calls).toBe(1);
      expect(rebuilt.report.reused).toBeGreaterThan(0);
      expect(f.analysisCalls() - beforeReconstruction).toBe(1);
      expect(cached?.evidenceDependencies.map((item: any) => item.path).sort()).toEqual(
        expectedPaths.sort(),
      );
    } finally {
      f.clean();
    }
  });
}

test("incomplete recovered results are never reused as complete", async () => {
  const f = recoveredFixture();
  try {
    const firstPlan = f.newPlan();
    const first = await reviewPlan({
      plan: firstPlan,
      instructions,
      apiKey: "simulation",
      memory: f.memory,
      verify: fixtureVerifier,
      sleep: async () => {},
      fetchImpl: async () =>
        valid({
          findings: [],
          resolutions: [],
          limitations: ["El contrato sigue sin resolverse."],
        }),
    });
    expect(first.coverage).toBe("incomplete");
    expect(f.memory.get(firstPlan.chunks[0].parts[0])).toBeNull();

    let calls = 0;
    const completed = await reviewPlan({
      plan: f.newPlan(),
      instructions,
      apiKey: "simulation",
      memory: f.memory,
      verify: fixtureVerifier,
      sleep: async () => {},
      fetchImpl: async () => {
        calls++;
        return valid();
      },
    });
    expect(completed.coverage).toBe("complete");
    expect(completed.reused).toBe(0);
    expect(calls).toBe(1);
  } finally {
    f.clean();
  }
});

test("evidence cache rejects references from stale head or base commits", () => {
  const f = recoveredFixture();
  try {
    const plan = f.newPlan();
    const part = plan.chunks[0].parts[0];
    const addDependency = (path: string, side: "head" | "base") => ({
      path,
      side,
      ref: side === "head" ? plan.sha : plan.base,
      status: "present",
      hash: hash(f.evidence.get(path)!),
    });
    part.evidenceDependencies = [addDependency("A.ts", "head"), addDependency("B.ts", "base")];
    f.memory.set(part, assessment);
    expect(f.memory.get(part)).not.toBeNull();

    f.currentRefs.head = "c".repeat(40);
    expect(f.memory.get(part)).toBeNull();
    f.currentRefs.head = plan.sha;
    f.currentRefs.base = "d".repeat(40);
    expect(f.memory.get(part)).toBeNull();
  } finally {
    f.clean();
  }
});
