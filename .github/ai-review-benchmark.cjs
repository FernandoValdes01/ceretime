const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = "08686f501739d7bca6454a0140ca4fee34afa820";
const INSTRUCTIONS = "Detecta defectos demostrables y conserva toda la evidencia necesaria.";
const CONTRACT_PATH = "apps/web/src/contracts/status.ts";
const MISSING_PATH = "apps/web/src/missing.ts";
const HELPER_PATH = "apps/web/src/helper.ts";
const DEFECT_PATH = "apps/web/src/defect.ts";
const FOLLOWUP_PATH = "apps/web/src/followup.ts";
const INDEPENDENT_PATH = "apps/web/src/independent.ts";
const IMPLEMENTATION_FILES = [
  "ai-review-benchmark.cjs",
  "ai-review-chunks.cjs",
  "ai-review-confidence.cjs",
  "ai-review-context.cjs",
  "ai-review-evidence.cjs",
  "ai-review-memory.cjs",
  "ai-review-payload.cjs",
  "ai-review-presentation.cjs",
  "ai-review-provider.cjs",
  "ai-review-selection.cjs",
  "ai-review-score.cjs",
  "ai-review-verification.cjs",
  ".pr-reviewer.yml",
];
const IMPLEMENTATION_PATHS = IMPLEMENTATION_FILES.map((name) =>
  name === ".pr-reviewer.yml" ? name : `.github/${name}`,
);

function git(directory, args, env = {}) {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  }).trimEnd();
}

function write(directory, filename, value) {
  const target = path.join(directory, filename);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
}

function fixtureFiles() {
  const status = [
    "export enum Status {",
    ...Array.from({ length: 72 }, (_, index) => `  State${index} = "state-${index}",`),
    "  Ready = " + '"ready",',
    "  Busy = " + '"busy",',
    "}",
    "",
  ].join("\n");
  const files = {
    [CONTRACT_PATH]: status,
    "apps/web/src/one.ts":
      'import { Status } from "./contracts/status";\nexport const value = Status.Ready;\n',
    "apps/web/src/two.ts":
      'import { Status } from "./contracts/status";\nexport const value = Status.Ready;\n',
    "apps/web/src/alias.ts":
      'import { Status as State } from "./contracts/status";\nexport const value = State.Ready;\n',
    "apps/web/src/namespace.ts":
      'import * as Contract from "./contracts/status";\nexport const value = Contract.Status.Ready;\n',
    "apps/web/src/required.ts":
      'const { Status: State } = require("./contracts/status");\nexport const value = State.Ready;\n',
    "apps/web/src/register.ts":
      "globalThis.__registrationCount = (globalThis.__registrationCount ?? 0) + 1;\nexport {};\n",
    "apps/web/src/effect-user.ts": 'import "./register";\nexport const enabled = false;\n',
    [HELPER_PATH]: "export const helper = (value: number) => value * 2;\n",
    [MISSING_PATH]:
      'import { helper } from "./helper";\nexport const value = (input: number) => helper(input);\n',
    "apps/web/src/legacy-name.ts": 'export const legacy = () => "old";\n',
    "apps/web/src/pure-old.ts": 'export const unchanged = () => "same";\n',
    "apps/web/src/defect.ts": [
      "/** calculate must preserve the requested amount. */",
      "export function calculate(value: number) {",
      "  return value;",
      "}",
      "/** normalize must trim spaces and lowercase text. */",
      "export function normalize(value: string) {",
      "  return value;",
      "}",
      "",
    ].join("\n"),
    [FOLLOWUP_PATH]: "export const status = () => 1;\n",
    [INDEPENDENT_PATH]: "export const version = 0;\n",
  };
  for (let index = 0; index < 12; index++)
    files[`apps/web/src/shared-${String(index).padStart(2, "0")}.ts`] =
      `import { Status } from "./contracts/status";\nexport const state${index} = Status.Ready;\n`;
  return files;
}

function createFixture(directory) {
  fs.mkdirSync(directory, { recursive: true });
  git(directory, ["init", "--quiet"]);
  git(directory, ["config", "user.name", "R2D2 Benchmark"]);
  git(directory, ["config", "user.email", "r2d2-benchmark@example.invalid"]);
  git(directory, ["config", "commit.gpgSign", "false"]);
  for (const [filename, content] of Object.entries(fixtureFiles()))
    write(directory, filename, content);
  git(directory, ["add", "."]);
  git(directory, ["commit", "--quiet", "-m", "benchmark-base"], {
    GIT_AUTHOR_DATE: "2026-10-01T12:00:00Z",
    GIT_COMMITTER_DATE: "2026-10-01T12:00:00Z",
  });
  const base = git(directory, ["rev-parse", "HEAD"]);

  for (let index = 0; index < 12; index++) {
    const filename = `apps/web/src/shared-${String(index).padStart(2, "0")}.ts`;
    write(
      directory,
      filename,
      `import { Status } from "./contracts/status";\nexport const state${index} = Status.Busy;\n`,
    );
  }
  for (const filename of [
    "apps/web/src/one.ts",
    "apps/web/src/two.ts",
    "apps/web/src/alias.ts",
    "apps/web/src/namespace.ts",
    "apps/web/src/required.ts",
  ])
    write(
      directory,
      filename,
      fs.readFileSync(path.join(directory, filename), "utf8").replace("Ready", "Busy"),
    );
  write(
    directory,
    "apps/web/src/effect-user.ts",
    'import "./register";\nexport const enabled = true;\n',
  );
  write(
    directory,
    MISSING_PATH,
    'import { helper } from "./helper";\nexport const value = (input: number) => helper(input) + 1;\n',
  );
  git(directory, ["mv", "apps/web/src/legacy-name.ts", "apps/web/src/renamed.ts"]);
  write(directory, "apps/web/src/renamed.ts", 'export const legacy = () => "new";\n');
  git(directory, ["mv", "apps/web/src/pure-old.ts", "apps/web/src/pure-new.ts"]);
  write(
    directory,
    "apps/web/src/defect.ts",
    [
      "/** calculate must preserve the requested amount. */",
      "export function calculate(value: number) {",
      "  return value - value;",
      "}",
      "/** normalize must trim spaces and lowercase text. */",
      "export function normalize(value: string) {",
      "  return value.trim().toLowerCase();",
      "}",
      "",
    ].join("\n"),
  );
  write(
    directory,
    "apps/web/src/defect.test.ts",
    [
      'import { calculate, normalize } from "./defect";',
      "expect(calculate(5)).toBe(5);",
      'expect(normalize(" Hola ")).toBe("hola");',
      "",
    ].join("\n"),
  );
  write(directory, FOLLOWUP_PATH, "export const status = () => 2;\n");
  write(directory, INDEPENDENT_PATH, "export const version = 1;\n");
  git(directory, ["add", "-A"]);
  git(directory, ["commit", "--quiet", "-m", "benchmark-head"], {
    GIT_AUTHOR_DATE: "2026-10-01T12:01:00Z",
    GIT_COMMITTER_DATE: "2026-10-01T12:01:00Z",
  });
  const head = git(directory, ["rev-parse", "HEAD"]);
  return { base, head };
}

function diffFiles(directory, base, sha) {
  const statuses = git(directory, ["diff", "--name-status", "--find-renames", base, sha])
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"));
  const files = statuses.map(([code, first, second]) => {
    const renamed = code.startsWith("R");
    const removed = code === "D";
    const oldPath = renamed ? first : removed ? first : undefined;
    const filename = renamed ? second : first;
    const paths = renamed ? [first, second] : [first];
    const rawDiff = git(directory, [
      "diff",
      "--no-ext-diff",
      "--find-renames",
      "--unified=3",
      base,
      sha,
      "--",
      ...paths,
    ]);
    const hunkAt = rawDiff.indexOf("@@ ");
    const patch = hunkAt < 0 ? undefined : rawDiff.slice(hunkAt);
    const numstat = git(directory, [
      "diff",
      "--numstat",
      "--find-renames",
      base,
      sha,
      "--",
      ...paths,
    ]).split("\n")[0];
    const [additions, deletions] = numstat.split("\t");
    return {
      filename,
      previous_filename: oldPath,
      status: renamed ? "renamed" : code === "A" ? "added" : removed ? "removed" : "modified",
      patch,
      additions: Number(additions) || 0,
      deletions: Number(deletions) || 0,
    };
  });
  return files;
}

function changedCoordinates(files) {
  const coordinates = [];
  for (const file of files) {
    let left = 0,
      right = 0;
    for (const text of String(file.patch ?? "").split("\n")) {
      const match = text.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        left = Number(match[1]);
        right = Number(match[3]);
      } else if (text.startsWith("+")) coordinates.push(`${file.filename}:RIGHT:${right++}`);
      else if (text.startsWith("-")) coordinates.push(`${file.filename}:LEFT:${left++}`);
      else if (text.startsWith(" ")) {
        left++;
        right++;
      }
    }
  }
  return coordinates.sort();
}

function preparePlan(runtime, directory, base, sha, config) {
  const files = diffFiles(directory, base, sha);
  runtime.context.enrichFiles(files, { directory, base, sha });
  const plan = runtime.chunks.buildPlan(files, config, sha);
  plan.base = base;
  plan.baseRef = "benchmark-base";
  plan.mergeBase = git(directory, ["merge-base", base, sha]);
  plan.intent = { title: "R2D2 synthetic benchmark", description: "Fixed fixtures and responses." };
  const missing = plan.chunks
    .flatMap((chunk) => chunk.parts)
    .find((part) => part.path === MISSING_PATH);
  assert.ok(missing, "the missing-evidence fixture must be in the plan");
  missing.context = missing.context.filter((item) => item.path !== HELPER_PATH);

  const followupBase = plan.chunks
    .flatMap((chunk) => chunk.parts)
    .find((part) => part.path === FOLLOWUP_PATH);
  assert.ok(followupBase, "the followup fixture must be in the plan");
  for (const id of ["701", "702"])
    plan.chunks.push({
      parts: [
        {
          ...followupBase,
          followupOnly: true,
          kind: "followup",
          followups: [
            {
              id,
              path: FOLLOWUP_PATH,
              currentLine: 1,
              finding: `Archived finding ${id}.`,
              messages: [],
              original_excerpt: "export const status = () => 1;",
              current_excerpt: "export const status = () => 2;",
              related_change: "export const status = () => 2;",
              evidence_incomplete: false,
            },
          ],
        },
      ],
    });
  plan.chunks = runtime.score.packReviewParts(
    plan.chunks.flatMap((chunk) => chunk.parts),
    plan.limits.chunkChars,
    { base, mergeBase: plan.mergeBase, headRef: sha },
  );
  if (runtime.payload.publicEvidenceBundle)
    for (const chunk of plan.chunks) {
      const bundle = runtime.payload.publicEvidenceBundle(chunk.parts, {
        base,
        mergeBase: plan.mergeBase,
        headRef: sha,
      });
      const shared = bundle.evidence.filter((item) => item.path.head === CONTRACT_PATH);
      const consumers = bundle.parts.filter(
        (part) =>
          part.path.startsWith("apps/web/src/shared-") ||
          [
            "apps/web/src/one.ts",
            "apps/web/src/two.ts",
            "apps/web/src/alias.ts",
            "apps/web/src/namespace.ts",
            "apps/web/src/required.ts",
          ].includes(part.path),
      );
      if (consumers.length > 1) {
        assert.equal(shared.length, 1, "shared declarations have one evidence copy per request");
        for (const part of consumers)
          assert.ok(part.evidenceRefs.some((reference) => reference.id === shared[0].id));
      }
    }
  return { plan, files };
}

function contextForPayload(data, part) {
  if (Array.isArray(part.context)) return part.context;
  const evidence = new Map((data.evidence ?? []).map((item) => [item.id, item]));
  return (part.evidenceRefs ?? []).flatMap((reference) => {
    const item = evidence.get(reference.id);
    return item
      ? [{ ...item, relationship: reference.relationship, forPath: reference.forPath }]
      : [];
  });
}

function patchFor(data, filePath) {
  return data.parts.find((part) => part.path === filePath)?.patch ?? "";
}

function finding(issueKey, line, cause) {
  return {
    path: DEFECT_PATH,
    line,
    side: "RIGHT",
    severity: "important",
    issue_key: issueKey,
    cause,
    impact: "El consumidor recibe un resultado distinto al contrato vigente.",
    fix: "Conservar el resultado exigido por el contrato.",
  };
}

function decisionFor(candidate, index) {
  const f = candidate.finding ?? candidate;
  const calculate = f.issue_key === "calculate-zero";
  return {
    index: candidate.index ?? index,
    issue_key: f.issue_key,
    verdict: calculate ? "confirmed" : "refuted",
    symbol: calculate ? "calculate" : "normalize",
    input: calculate ? "calculate(5)" : 'normalize(" Hola ")',
    actual: calculate ? "0" : "hola",
    expected: calculate ? "5" : "hola",
    trace: calculate
      ? "La resta de un valor consigo mismo siempre devuelve cero."
      : "El consumidor espera texto recortado y en minúsculas; el cambio cumple esa regla.",
    counterevidence: "Se comprobó la declaración y la regla documentada junto con el consumidor.",
    ...(calculate
      ? {
          expectedContract: {
            path: DEFECT_PATH,
            quote: "calculate must preserve the requested amount.",
            rule: "La función conserva el importe solicitado.",
          },
          impactTrace: "El consumidor usa el valor para calcular el importe presentado.",
        }
      : {}),
    references: [
      {
        path: DEFECT_PATH,
        quote: calculate ? "return value - value;" : "return value.trim().toLowerCase();",
      },
    ],
  };
}

function response(data) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({
      usage: { prompt_tokens: 0, completion_tokens: 0 },
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(data) } }],
    }),
  };
}

function hasRecovered(data, filePath) {
  return data.parts.some((part) =>
    contextForPayload(data, part).some((item) =>
      Boolean(item.recovered && (item.path?.head === filePath || item.path === filePath)),
    ),
  );
}

function runReview(runtime, directory, base, sha, config, memoryDirectory, phase) {
  const { plan, files } = preparePlan(runtime, directory, base, sha, config);
  const inputCoordinates = plan.chunks.flatMap((chunk) =>
    chunk.parts
      .filter((part) => !part.followupOnly)
      .flatMap((part) => part.anchors.map((anchor) => `${part.path}:${anchor}`)),
  );
  const plannedPaths = [
    ...new Set(plan.chunks.flatMap((chunk) => chunk.parts.map((part) => part.path))),
  ];
  assert.deepEqual(inputCoordinates.sort(), changedCoordinates(files));
  const followupParts = plan.chunks
    .flatMap((chunk) => chunk.parts)
    .filter((part) => part.followupOnly);
  assert.equal(followupParts.length, 2);
  assert.equal(
    new Set(followupParts.flatMap((part) => part.followups.map((item) => item.id))).size,
    2,
  );

  const identity = runtime.memory.memoryIdentity(plan, INSTRUCTIONS);
  const { readState } = runtime.context.gitReader(directory);
  const memory = runtime.memory.createMemory({
    directory: memoryDirectory,
    identity,
    apiKey: "fixed-benchmark-key",
    readEvidence: (dependency) => {
      const current = readState(dependency.ref, dependency.path);
      return {
        status: current.status,
        hash: current.status === "present" ? runtime.context.hash(current.text) : null,
      };
    },
  });
  const cacheMissPathsBefore = plan.chunks
    .flatMap((chunk) => chunk.parts)
    .filter((part) => !memory.get(part))
    .map((part) => part.path);
  const counters = {
    calls: 0,
    analysisCalls: 0,
    recoveryCalls: 0,
    verificationCalls: 0,
    retryCalls: 0,
    requestChars: 0,
    analysisChars: 0,
    recoveryChars: 0,
    verificationChars: 0,
    retryChars: 0,
    retrievedEvidenceChars: 0,
    requestBodies: [],
    seenPaths: [],
    progress: [],
    retryIssued: false,
  };
  const fetchImpl = async (_url, request) => {
    const envelope = JSON.parse(request.body);
    const [systemMessage, userMessage] = envelope.messages;
    const data = JSON.parse(userMessage.content);
    const verification = systemMessage.content.startsWith("Verifica de forma independiente");
    const paths = verification
      ? data.candidates.map((candidate) => (candidate.finding ?? candidate).path)
      : (data.scope?.paths ?? data.parts.map((part) => part.path));
    counters.seenPaths.push(...paths);
    const recovered = !verification && hasRecovered(data, HELPER_PATH);
    const retry =
      !verification && systemMessage.content.includes("La respuesta anterior fue rechazada");
    counters.calls++;
    counters.requestChars += request.body.length;
    counters.requestBodies.push({
      stage: verification ? "verification" : recovered ? "recovery" : "analysis",
      chars: request.body.length,
    });
    if (verification) {
      counters.verificationCalls++;
      counters.verificationChars += request.body.length;
      const candidates = data.candidates;
      assert.ok(candidates.length > 0, "verification mock requires explicit candidates");
      return response({ decisions: candidates.map(decisionFor) });
    }
    if (retry) {
      counters.retryCalls++;
      counters.retryChars += request.body.length;
    }
    if (recovered) {
      counters.recoveryCalls++;
      counters.recoveryChars += request.body.length;
      assert.ok(
        hasRecovered(data, HELPER_PATH),
        "recovery request must carry the retrieved helper",
      );
    } else {
      counters.analysisCalls++;
      counters.analysisChars += request.body.length;
    }

    for (const part of data.parts) {
      const contexts = contextForPayload(data, part);
      if (part.path === MISSING_PATH && !recovered)
        assert.ok(
          !contexts.some((item) => item.path?.head === HELPER_PATH || item.path === HELPER_PATH),
        );
      if (part.path === MISSING_PATH && recovered)
        assert.ok(
          contexts.some((item) => item.path?.head === HELPER_PATH || item.path === HELPER_PATH),
        );
    }

    if (
      data.scope?.followupThreads?.some((thread) => String(thread.id) === "701") &&
      !counters.retryIssued
    ) {
      counters.retryIssued = true;
      return response({ findings: { rejected: "fixture forces one local protocol retry" } });
    }

    const missingRequests =
      paths.includes(MISSING_PATH) && !recovered
        ? [
            {
              path: HELPER_PATH,
              symbol: "helper",
              side: "head",
              reason: "Recuperar la función aplicada por el cambio.",
              forPath: MISSING_PATH,
            },
          ]
        : [];
    const findings = [];
    const defectPatch = patchFor(data, DEFECT_PATH);
    if (paths.includes(DEFECT_PATH)) {
      assert.match(defectPatch, /\[RIGHT:3\] \+  return value - value;/);
      assert.match(defectPatch, /\[RIGHT:7\] \+  return value\.trim\(\)\.toLowerCase\(\);/);
      findings.push(
        finding("calculate-zero", 3, "La función resta el importe consigo mismo."),
        finding("normalize-case", 7, "El cambio normaliza minúsculas según el contrato."),
      );
    }
    const resolutions = (data.scope?.followupThreads ?? []).map((thread) => ({
      id: String(thread.id),
      status: "not_applicable",
      explanation: "El cambio vigente conserva el comportamiento evaluado por este hilo.",
    }));
    return response({ findings, resolutions, evidenceRequests: missingRequests, limitations: [] });
  };
  const recoverContext = async ({ chunk, requests }) => {
    const result = runtime.evidence.recoverEvidence({ directory, base, sha, chunk, requests });
    counters.retrievedEvidenceChars += result.recoveredChars;
    return { chunk: result.chunk, unresolved: result.unresolved };
  };
  const current = async () => git(directory, ["rev-parse", "HEAD"]) === sha;
  return runtime.chunks
    .reviewPlan({
      plan,
      instructions: INSTRUCTIONS,
      apiKey: "fixed-benchmark-key",
      fetchImpl,
      sleep: async () => {},
      isCurrent: current,
      memory,
      recoverContext,
      verify: async (options) => {
        try {
          return await runtime.verification.verifyAssessment(options);
        } catch (error) {
          counters.progress.push(`Verifier error: ${error.stack ?? error}`);
          throw error;
        }
      },
      onProgress: (message) => counters.progress.push(message),
    })
    .then((report) => {
      assert.equal(
        report.coverage,
        "complete",
        `incomplete benchmark review (${phase}): ${report.reasons.join(" | ")}; calls ${counters.calls}; phases ${JSON.stringify(counters.requestBodies)}; progress ${JSON.stringify(counters.progress)}`,
      );
      assert.deepEqual(
        report.findings.map((item) => item.issue_key),
        ["calculate-zero"],
      );
      assert.equal(report.score, 2);
      if (phase === "first") {
        assert.ok(counters.retryCalls > 0, "the fixed retry response must be measured");
        assert.ok(counters.recoveryCalls > 0, "the fixed evidence recovery must be measured");
        assert.ok(counters.verificationCalls > 0, "the independent verifier must be measured");
      }
      assert.ok(counters.requestBodies.every((item) => item.chars <= plan.limits.inputChars));
      const reportEvidence = {
        totalParts: plan.chunks.flatMap((chunk) => chunk.parts).length,
        cacheMissPathsBefore,
        analysisChunks: plan.chunks.length,
        plannedPaths,
        plannedCoordinates: inputCoordinates.length,
        uniqueCoordinates: new Set(inputCoordinates).size,
        ...counters,
        reused: report.reused,
        coverage: report.coverage,
        findings: report.findings.map((item) => item.issue_key),
        score: report.score,
      };
      return reportEvidence;
    });
}

function loadRuntime(directory) {
  const module = (name) => require(path.join(directory, ".github", `ai-review-${name}.cjs`));
  return {
    chunks: module("chunks"),
    context: module("context"),
    evidence: module("evidence"),
    memory: module("memory"),
    payload: module("payload"),
    score: module("score"),
    verification: module("verification"),
  };
}

function implementationFingerprint() {
  const patch = execFileSync("git", ["diff", "--binary", BASELINE, "--", ...IMPLEMENTATION_PATHS], {
    cwd: ROOT,
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024,
  });
  return crypto.createHash("sha256").update(patch).digest("hex");
}

function extractBaseline(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const archive = execFileSync("git", ["archive", BASELINE], {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-C", directory], { input: archive, maxBuffer: 64 * 1024 * 1024 });
  fs.symlinkSync(
    path.join(ROOT, "apps", "web", "node_modules"),
    path.join(directory, "apps", "web", "node_modules"),
    "dir",
  );
}

function formatRow(label, baseline, optimized) {
  const diff = (before, after) =>
    (after - before >= 0 ? "+" : "") + (after - before).toLocaleString("en-US");
  return `| ${label} | ${baseline.calls} / ${optimized.calls} | ${baseline.analysisChars.toLocaleString("en-US")} / ${optimized.analysisChars.toLocaleString("en-US")} | ${baseline.recoveryChars.toLocaleString("en-US")} / ${optimized.recoveryChars.toLocaleString("en-US")} | ${baseline.verificationChars.toLocaleString("en-US")} / ${optimized.verificationChars.toLocaleString("en-US")} | ${baseline.retryChars.toLocaleString("en-US")} / ${optimized.retryChars.toLocaleString("en-US")} | ${baseline.requestChars.toLocaleString("en-US")} / ${optimized.requestChars.toLocaleString("en-US")} (${diff(baseline.requestChars, optimized.requestChars)}) | ${baseline.reused}/${baseline.totalParts} / ${optimized.reused}/${optimized.totalParts} | ${baseline.coverage} / ${optimized.coverage} |`;
}

const inlineCode = (value) => "`" + value + "`";
const signed = (value) => `${value >= 0 ? "+" : "−"}${Math.abs(value).toLocaleString("en-US")}`;

async function runBenchmark() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "r2d2-benchmark-"));
  const repository = path.join(temporary, "fixture-repo");
  const baselineRoot = path.join(temporary, "baseline-source");
  const baselineMemory = path.join(temporary, "baseline-memory");
  const currentMemory = path.join(temporary, "current-memory");
  try {
    extractBaseline(baselineRoot);
    const { base, head } = createFixture(repository);
    const baseline = loadRuntime(baselineRoot);
    const current = loadRuntime(ROOT);
    const configText = fs.readFileSync(path.join(baselineRoot, ".pr-reviewer.yml"), "utf8");
    assert.equal(configText, fs.readFileSync(path.join(ROOT, ".pr-reviewer.yml"), "utf8"));
    const config = Bun.YAML.parse(configText);
    const results = { baseline: {}, optimized: {} };
    results.baseline.first = await runReview(
      baseline,
      repository,
      base,
      head,
      config,
      baselineMemory,
      "first",
    );
    results.baseline.repeat = await runReview(
      baseline,
      repository,
      base,
      head,
      config,
      baselineMemory,
      "repeat",
    );
    results.optimized.first = await runReview(
      current,
      repository,
      base,
      head,
      config,
      currentMemory,
      "first",
    );
    results.optimized.repeat = await runReview(
      current,
      repository,
      base,
      head,
      config,
      currentMemory,
      "repeat",
    );

    write(repository, INDEPENDENT_PATH, "export const version = 2;\n");
    git(repository, ["add", INDEPENDENT_PATH]);
    git(repository, ["commit", "--quiet", "-m", "benchmark-one-file-update"], {
      GIT_AUTHOR_DATE: "2026-10-01T12:02:00Z",
      GIT_COMMITTER_DATE: "2026-10-01T12:02:00Z",
    });
    const updatedHead = git(repository, ["rev-parse", "HEAD"]);
    results.baseline.update = await runReview(
      baseline,
      repository,
      base,
      updatedHead,
      config,
      baselineMemory,
      "update",
    );
    results.optimized.update = await runReview(
      current,
      repository,
      base,
      updatedHead,
      config,
      currentMemory,
      "update",
    );

    for (const stage of ["first", "repeat", "update"]) {
      const before = results.baseline[stage];
      const after = results.optimized[stage];
      assert.equal(before.coverage, "complete");
      assert.equal(after.coverage, "complete");
      assert.deepEqual(before.findings, after.findings);
    }
    assert.equal(
      results.optimized.repeat.calls,
      0,
      `optimized repeat missed cache: reused ${results.optimized.repeat.reused}/${results.optimized.repeat.totalParts}`,
    );
    assert.ok(results.baseline.repeat.calls > 0);
    assert.ok(results.baseline.repeat.reused < results.baseline.repeat.totalParts);
    assert.equal(results.optimized.repeat.reused, results.optimized.repeat.totalParts);
    assert.ok(results.baseline.update.reused > 0 && results.optimized.update.reused > 0);
    assert.equal(git(repository, ["rev-parse", "HEAD"]), updatedHead);

    const baselineTotal = ["first", "repeat", "update"].reduce(
      (sum, stage) => sum + results.baseline[stage].requestChars,
      0,
    );
    const optimizedTotal = ["first", "repeat", "update"].reduce(
      (sum, stage) => sum + results.optimized[stage].requestChars,
      0,
    );
    const savings = ((baselineTotal - optimizedTotal) / baselineTotal) * 100;
    const codeRefs = IMPLEMENTATION_PATHS.map((name) => {
      const digest = crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(ROOT, name)))
        .digest("hex");
      return `- ${inlineCode(name)}: ${inlineCode(digest)}`;
    }).join("\n");
    const table = [
      "| Fase | Llamadas antes / después | Análisis antes / después (caracteres) | Recuperación antes / después (caracteres) | Verificación antes / después (caracteres) | Reintentos antes / después (subconjunto de etapas) | Total transmitido antes / después (caracteres) | Reutilizados antes / después | Cobertura antes / después |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
      ...["first", "repeat", "update"].map((stage) =>
        formatRow(
          {
            first: "Primera revisión",
            repeat: "Repetición sin cambios",
            update: "Actualización de un archivo",
          }[stage],
          results.baseline[stage],
          results.optimized[stage],
        ),
      ),
    ].join("\n");
    const fixturePaths = [
      ...Object.keys(fixtureFiles()),
      "apps/web/src/defect.test.ts",
      "apps/web/src/pure-new.ts",
      "apps/web/src/renamed.ts",
    ]
      .filter((filename, index, values) => values.indexOf(filename) === index)
      .sort()
      .map((filename) => `- ${inlineCode(filename)}`)
      .join("\n");
    const report = [
      "# Benchmark reproducible de optimizaciones R2D2",
      "",
      `Referencia antes: ${inlineCode(BASELINE)}.`,
      `Referencia después: árbol de trabajo en ${inlineCode(ROOT)}; SHA-256 del diff de implementación: ${inlineCode(implementationFingerprint())}.`,
      `Fixture: base ${inlineCode(base)}, primera revisión ${inlineCode(head)}, actualización ${inlineCode(updatedHead)}. Commits sintéticos con fechas fijas.`,
      "",
      "## Comando",
      "",
      "```sh",
      "bun .github/ai-review-benchmark.cjs --write",
      "```",
      "",
      "El script extrae el baseline con `git archive`, crea el mismo repositorio sintético para ambos runtimes y recorre `enrichFiles`, `buildPlan`, `packReviewParts`, `reviewPlan`, recuperación Git real, caché firmada y el verificador independiente. Todas las respuestas de inferencia son mocks deterministas con asserts sobre rutas, coordenadas, candidatos y evidencia. No contacta al proveedor ni a GitHub.",
      "",
      "## Datos del fixture",
      "",
      "Incluye doce consumidores de un contrato compartido; imports ES con alias, namespace, `require` y efecto lateral; renombre puro y renombre modificado; un símbolo de helper omitido a propósito y recuperado desde Git; dos seguimientos incompatibles del mismo archivo; un candidato confirmado y otro refutado; y un archivo independiente que se cambia entre la repetición y la actualización.",
      "",
      fixturePaths,
      "",
      "## Resultados",
      "",
      table,
      "",
      `Total de caracteres de solicitudes en las tres fases: ${baselineTotal.toLocaleString("en-US")} antes y ${optimizedTotal.toLocaleString("en-US")} después; ahorro ${savings.toFixed(1)}%. Las etapas incluyen instrucciones, formato JSON y mensajes completos; la columna de reintentos es un subconjunto informativo y no se suma dos veces. La recuperación local obtuvo ${results.baseline.first.retrievedEvidenceChars} caracteres antes y ${results.optimized.first.retrievedEvidenceChars} después; esos bytes también aparecen en la solicitud de análisis posterior y no se duplican en el total transmitido.`,
      `Etapas con mayor consumo después: en la primera revisión, análisis ${signed(results.optimized.first.analysisChars - results.baseline.first.analysisChars)} caracteres y recuperación ${signed(results.optimized.first.recoveryChars - results.baseline.first.recoveryChars)}; el verificador baja ${signed(results.optimized.first.verificationChars - results.baseline.first.verificationChars)}. La actualización de un archivo suma ${signed(results.optimized.update.requestChars - results.baseline.update.requestChars)} caracteres. La inferencia es que los IDs y referencias explícitas aumentan las solicitudes de análisis/recuperación, mientras la selección por candidato reduce la evidencia del verificador.`,
      `Tokens estimados: ${Math.ceil(baselineTotal / 4).toLocaleString("en-US")} antes y ${Math.ceil(optimizedTotal / 4).toLocaleString("en-US")} después, usando 4 caracteres por token como aproximación gruesa. Tokens facturados: 0 en ambos runtimes; el benchmark no hizo llamadas reales.`,
      `Cobertura de coordenadas: ${results.baseline.first.uniqueCoordinates}/${results.baseline.first.plannedCoordinates} antes y ${results.optimized.first.uniqueCoordinates}/${results.optimized.first.plannedCoordinates} después; cada coordenada del diff aparece una vez. Ambos runtimes devolvieron ${inlineCode(results.optimized.first.findings.join(", "))} y refutaron ${inlineCode("normalize-case")}.`,
      `Ahorro total: ${savings.toFixed(1)}%. Meta orientativa de 15%: ${savings >= 15 ? "alcanzada" : "no alcanzada"}.`,
      "",
      "## Reutilización y comprobaciones",
      "",
      `Repetición sin cambios: ${results.baseline.repeat.reused}/${results.baseline.repeat.totalParts} partes reutilizadas antes con ${results.baseline.repeat.calls} llamadas; después ${results.optimized.repeat.reused}/${results.optimized.repeat.totalParts} partes y ${results.optimized.repeat.calls} llamadas. Actualización: ${results.baseline.update.reused}/${results.baseline.update.totalParts} partes reutilizadas antes y ${results.optimized.update.reused}/${results.optimized.update.totalParts} después; el archivo cambiado se vuelve a analizar.`,
      `Las seis revisiones terminaron con cobertura completa. El mock exige la recuperación de ${inlineCode(HELPER_PATH)}, presencia del hunk del defecto, envío a verificación, decisión confirmada/refutada, resolución de ambos seguimientos y presupuesto de entrada válido en todas las solicitudes.`,
      "",
      "## Identidad del código medido",
      "",
      codeRefs,
      "",
      "Los valores describen bytes de texto JavaScript transmitidos por request, no el tokenizer de un proveedor. Los campos de usage están fijados a cero y no representan una factura real. El ahorro puede variar con la longitud de contexto, el empaquetado y el tokenizer del proveedor.",
      "",
    ].join("\n");
    if (process.argv.includes("--write")) {
      const reportPath = path.join(ROOT, ".github/r2d2-benchmark.md");
      fs.writeFileSync(reportPath, report);
      execFileSync(path.join(ROOT, "node_modules/.bin/oxfmt"), [reportPath], {
        cwd: ROOT,
        stdio: "ignore",
      });
      process.stdout.write(fs.readFileSync(reportPath, "utf8"));
    } else process.stdout.write(report);
    return { results, baselineTotal, optimizedTotal, savings };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (require.main === module)
  runBenchmark().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });

module.exports = { runBenchmark };
