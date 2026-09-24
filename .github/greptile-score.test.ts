import { expect, test } from "bun:test";

const ciWorkflow = Bun.YAML.parse(
  await Bun.file(`${import.meta.dir}/workflows/ci.yml`).text(),
) as any;
const gate = ciWorkflow.jobs.greptile_score;
const gateScript = gate.steps[0].with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const sha = "a".repeat(40);
const oldSha = "b".repeat(40);

function summary(score: string, reviewedSha = sha, updatedAt = "2026-09-23T00:00:00Z", id = 1) {
  return {
    id,
    user: { login: "greptile-apps[bot]", type: "Bot" },
    updated_at: updatedAt,
    body: `<!-- greptile_summary --><h2>Confidence Score: ${score}</h2><sub>Last reviewed commit: ["review"](https://github.com/owner/repo/commit/${reviewedSha})</sub>`,
  };
}

async function checkCiGate(commentSnapshots: object[][], headSha = sha) {
  const failures: string[] = [];
  const infos: string[] = [];
  let now = 0;
  let commentRead = 0;
  const FakeDate = class extends Date {
    static now() {
      return now;
    }
  };
  const github = {
    rest: {
      pulls: {
        get: async () => ({
          data: {
            head: { sha: headSha },
          },
        }),
      },
      issues: { listComments: () => {} },
    },
    paginate: async () => {
      const index = Math.min(commentRead, commentSnapshots.length - 1);
      commentRead += 1;
      return commentSnapshots[index] ?? [];
    },
  };
  const context = {
    repo: { owner: "owner", repo: "repo" },
    payload: { pull_request: { number: 1, draft: false } },
  };
  const core = {
    info: (message: string) => infos.push(message),
    setFailed: (message: string) => failures.push(message),
  };
  const fakeSetTimeout = (callback: () => void, delay = 0) => {
    now += delay;
    callback();
    return 0;
  };
  await new AsyncFunction("github", "context", "core", "Date", "setTimeout", gateScript)(
    github,
    context,
    core,
    FakeDate,
    fakeSetTimeout,
  );
  return { failures, infos };
}

test("Greptile 5/5 es un job de CI sin status auxiliar", async () => {
  expect(gate.name).toBe("Greptile 5/5");
  expect(gate.permissions).toEqual({ issues: "read", "pull-requests": "read" });
  expect(gate.steps[0].with.script).not.toContain("createCommitStatus");
  expect(await Bun.file(`${import.meta.dir}/workflows/greptile-score.yml`).exists()).toBe(false);
});

test("marca el check como fallido cuando Greptile da 4/5", async () => {
  const result = await checkCiGate([[summary("4/5")]]);
  expect(result.failures).toEqual(["Hay cambios pendientes de Greptile (4/5)."]);
  expect(result.infos).toEqual([]);
});

test("acepta 5/5 para el SHA actual", async () => {
  const result = await checkCiGate([[summary("5/5")]]);
  expect(result.failures).toEqual([]);
  expect(result.infos).toEqual(["Greptile 5/5 para el commit actual."]);
});

test("espera la revisión del SHA actual antes de decidir", async () => {
  const result = await checkCiGate([[summary("5/5", oldSha)], [summary("4/5")]]);
  expect(result.failures).toEqual(["Hay cambios pendientes de Greptile (4/5)."]);
  expect(result.infos).toEqual([]);
});

test("falla si no llega una revisión para el SHA actual", async () => {
  const result = await checkCiGate([[summary("5/5", oldSha)]]);
  expect(result.failures).toEqual(["Falta la revisión de Greptile para el commit actual."]);
  expect(result.infos).toEqual([]);
});

test("captura una nota 5/5 que llega antes de vencer la espera", async () => {
  const oldReview = [summary("5/5", oldSha)];
  const snapshots = [...Array.from({ length: 10 }, () => oldReview), [summary("5/5")]];
  const result = await checkCiGate(snapshots);
  expect(result.failures).toEqual([]);
  expect(result.infos).toEqual(["Greptile 5/5 para el commit actual."]);
});

test("rechaza una nota inválida para el commit actual", async () => {
  const result = await checkCiGate([[summary("nota inválida")]]);
  expect(result.failures).toEqual(["Greptile no publicó una nota válida para el commit actual."]);
  expect(result.infos).toEqual([]);
});
