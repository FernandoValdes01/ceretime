import { expect, test } from "bun:test";

const workflow = Bun.YAML.parse(
  await Bun.file(`${import.meta.dir}/workflows/greptile-score.yml`).text(),
) as any;
const ciWorkflow = Bun.YAML.parse(
  await Bun.file(`${import.meta.dir}/workflows/ci.yml`).text(),
) as any;
const script = workflow.jobs.score.steps[0].with.script;
const gateScript = ciWorkflow.jobs?.greptile_score?.steps?.[0]?.with?.script ?? "";
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const sha = "a".repeat(40);
const oldSha = "b".repeat(40);
const reviewedRealSha = "2688e29ff8291dde87afbb69609ed8faedc9abb2";

function summary(score: string, reviewedSha = sha, updatedAt = "2026-09-23T00:00:00Z", id = 1) {
  return {
    id,
    user: { login: "greptile-apps[bot]", type: "Bot" },
    html_url: "https://github.com/owner/repo/pull/1#issuecomment-2",
    updated_at: updatedAt,
    body: `<!-- greptile_summary --><h2><a href="https://app.greptile.com/api/retrigger">Retrigger</a>Confidence Score: ${score}</h2><sub>Reviews (2) · Last reviewed commit: ["review"](https://github.com/owner/repo/commit/${reviewedSha})</sub>`,
  };
}

async function check(
  comments: object[],
  eventName = "pull_request_target",
  headSha = sha,
  gateConclusion = "failure",
  runAttempt = 1,
  includePullRequestAssociation = true,
) {
  const statuses: any[] = [];
  const reruns: any[] = [];
  const jobQueries: any[] = [];
  const pullListQueries: any[] = [];
  const pullRequest = {
    number: 1,
    base: { ref: "main" },
    state: "open",
    draft: false,
    head: {
      sha: headSha,
      ref: "feature/ti4-34",
      repo: { full_name: "owner/repo" },
    },
    html_url: "https://github.com/owner/repo/pull/1",
  };
  const run = {
    id: 50,
    name: "CI",
    event: "pull_request",
    head_sha: headSha,
    head_branch: "feature/ti4-34",
    head_repository: { full_name: "owner/repo" },
    run_number: 3,
    run_attempt: runAttempt,
    pull_requests: includePullRequestAssociation
      ? [{ number: 1, base: { ref: "main" }, head: { sha: headSha } }]
      : undefined,
  };
  const listPullRequests = async (args: any) => {
    pullListQueries.push(args);
    return { data: [pullRequest] };
  };
  const github = {
    rest: {
      pulls: { get: async () => ({ data: pullRequest }), list: listPullRequests },
      issues: { listComments: () => {} },
      repos: { createCommitStatus: async (args: any) => statuses.push(args) },
      actions: {
        listWorkflowRunsForRepo: async () => ({ data: { workflow_runs: [run] } }),
        listJobsForWorkflowRun: async (args: any) => {
          jobQueries.push(args);
          return {
            data: {
              jobs: [
                {
                  id: 99,
                  name: "Greptile 5/5",
                  status: "completed",
                  conclusion: gateConclusion,
                },
              ],
            },
          };
        },
        reRunJobForWorkflowRun: async (args: any) => reruns.push(args),
      },
    },
    paginate: async (method: unknown, args: any) =>
      method === listPullRequests ? (await listPullRequests(args)).data : comments,
  };
  const context = {
    eventName,
    repo: { owner: "owner", repo: "repo" },
    payload: {
      pull_request: eventName === "pull_request_target" ? { number: 1 } : undefined,
      issue: eventName === "issue_comment" ? { number: 1, pull_request: {} } : undefined,
      comment:
        eventName === "issue_comment"
          ? { user: { login: "greptile-apps[bot]", type: "Bot" } }
          : undefined,
      workflow_run: eventName === "workflow_run" ? run : undefined,
    },
  };
  await new AsyncFunction("github", "context", "core", script)(github, context, {
    info: () => {},
    warning: () => {},
  });
  return { statuses, reruns, jobQueries, pullListQueries };
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
            base: { ref: "main" },
            state: "open",
            draft: false,
            head: { sha: headSha },
            html_url: "https://github.com/owner/repo/pull/1",
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

test("aprueba solo 5/5 para el commit actual", async () => {
  const result = await check([summary("5/5")]);
  expect(result.statuses[0]).toMatchObject({
    sha,
    context: "Greptile 5/5",
    state: "success",
    target_url: summary("5/5").html_url,
  });
});

test("lee el formato publicado por Greptile en una PR real", async () => {
  const comment = {
    ...summary("5/5", reviewedRealSha),
    html_url: "https://github.com/FernandoValdes01/ceretime/pull/45#issuecomment-5798968474",
    body: `<!-- greptile_summary -->

<h2><a href="https://app.greptile.com/api/retrigger?id=68156626"><picture><source media="(prefers-color-scheme: dark)" srcset="https://greptile-static-assets.s3.amazonaws.com/badges/RetriggerDark.svg?v=2"></picture></a>Confidence Score: 5/5</h2>

<!-- greptile_confidence_score:5 -->

<sub>Reviews (1) · Last reviewed commit: ["Update api.d.ts"](https://github.com/fernandovaldes01/ceretime/commit/${reviewedRealSha})</sub>`,
  };
  const result = await check([comment], "pull_request_target", reviewedRealSha);
  expect(result.statuses[0]).toMatchObject({
    sha: reviewedRealSha,
    context: "Greptile 5/5",
    state: "success",
    target_url: comment.html_url,
  });
});

test("rechaza 4/5 aunque Greptile publique su propio check correcto", async () => {
  const result = await check([summary("4/5")], "issue_comment");
  expect(result.statuses[0]).toMatchObject({ sha, context: "Greptile 5/5", state: "failure" });
  expect(result.statuses[0].description).toContain("4/5");
});

test("rechaza revisiones anteriores y la ausencia de revisión", async () => {
  expect((await check([summary("5/5", oldSha)])).statuses[0].state).toBe("failure");
  expect((await check([])).statuses[0].state).toBe("failure");
});

test("actualiza el status cuando se elimina el comentario de Greptile", async () => {
  expect(workflow.on.issue_comment.types).toContain("deleted");
  expect((await check([], "issue_comment")).statuses[0].state).toBe("failure");
});

test("usa la última revisión cuando hay varios comentarios de Greptile", async () => {
  const comments = [summary("5/5"), summary("4/5", sha, "2026-09-23T01:00:00Z")];
  expect((await check(comments)).statuses[0].state).toBe("failure");
});

test("desempata comentarios de Greptile por su ID más reciente", async () => {
  const sameTime = "2026-09-23T01:00:00Z";
  const comments = [summary("5/5", sha, sameTime, 10), summary("4/5", sha, sameTime, 11)];
  expect((await check(comments)).statuses[0].state).toBe("failure");
});

test("ignora comentarios que imitan el marcador de Greptile", async () => {
  const fake = { ...summary("5/5"), user: { login: "someone", type: "User" } };
  expect((await check([fake])).statuses[0].state).toBe("failure");
});

test("solo un workflow confiable publica statuses y reconcilia comentarios tardíos", () => {
  expect(workflow.on.pull_request_target.branches).toEqual(["main"]);
  expect(workflow.on.pull_request_target.types).toContain("ready_for_review");
  expect(workflow.on.issue_comment.types).toEqual(["created", "edited", "deleted"]);
  expect(workflow.on.workflow_run).toMatchObject({ workflows: ["CI"], types: ["completed"] });
  expect(workflow.jobs.score.permissions).toEqual({
    actions: "write",
    issues: "read",
    "pull-requests": "read",
    statuses: "write",
  });
  expect(workflow.jobs.score.steps).toHaveLength(1);
  expect(workflow.jobs.score.steps[0].uses).toMatch(/^actions\/github-script@[0-9a-f]{40}$/);
});

test("la nota tardía vuelve a ejecutar el gate sobre el mismo SHA", async () => {
  const result = await check([summary("5/5")], "issue_comment", sha, "failure");
  expect(result.reruns).toEqual([{ owner: "owner", repo: "repo", job_id: 99 }]);
  expect(result.jobQueries).toEqual([{ owner: "owner", repo: "repo", run_id: 50, per_page: 100 }]);
});

test("reconcilia el gate cuando GitHub omite pull_requests en el run", async () => {
  const result = await check([summary("5/5")], "issue_comment", sha, "failure", 1, false);
  expect(result.reruns).toEqual([{ owner: "owner", repo: "repo", job_id: 99 }]);
});

test("workflow_run busca la PR por repo y rama si GitHub omite pull_requests", async () => {
  const result = await check([summary("5/5")], "workflow_run", sha, "failure", 1, false);
  expect(result.pullListQueries).toEqual([
    {
      owner: "owner",
      repo: "repo",
      state: "open",
      base: "main",
      head: "owner:feature/ti4-34",
      per_page: 100,
    },
  ]);
  expect(result.reruns).toEqual([{ owner: "owner", repo: "repo", job_id: 99 }]);
});

test("workflow_run repara un gate que terminó con un resultado viejo", async () => {
  const result = await check([summary("5/5")], "workflow_run", sha, "failure");
  expect(result.reruns).toEqual([{ owner: "owner", repo: "repo", job_id: 99 }]);
  expect(result.statuses[0]).toMatchObject({ sha, state: "success" });
});

test("no ejecuta otra vez el gate cuando ya coincide con 4/5", async () => {
  const result = await check([summary("4/5")], "workflow_run", sha, "failure");
  expect(result.reruns).toHaveLength(0);
});

test("limita las reconciliaciones automáticas a tres intentos por ejecución", async () => {
  const result = await check([summary("5/5")], "workflow_run", sha, "failure", 3);
  expect(result.reruns).toHaveLength(0);
});

test("la CI no puede escribir el status requerido desde el código de la PR", () => {
  const gate = ciWorkflow.jobs.greptile_score;
  expect(ciWorkflow.on.pull_request.types).toContain("ready_for_review");
  expect(gate.name).toBe("Greptile 5/5");
  expect(gate.if).toContain("pull_request.draft == false");
  expect(gate.permissions).toEqual({ issues: "read", "pull-requests": "read" });
  expect(gate["timeout-minutes"]).toBe(20);
  expect(gate.steps[0].with.script).not.toContain("createCommitStatus");
});

test("el CI informa el error cuando Greptile da 4/5", async () => {
  expect(gateScript).not.toBe("");
  const result = await checkCiGate([[summary("4/5")]]);
  expect(result.failures).toEqual(["Oye, Greptile dice 4/5; no puedes mergear así."]);
  expect(result.infos).toEqual([]);
});

test("el CI acepta 5/5 para el SHA actual", async () => {
  const result = await checkCiGate([[summary("5/5")]]);
  expect(result.failures).toEqual([]);
  expect(result.infos).toEqual(["Greptile dice 5/5 para el commit actual; puedes mergear."]);
});

test("el CI acepta una revisión actual que llega después de diez minutos", async () => {
  const staleReview = [summary("5/5", oldSha)];
  const snapshots = [...Array.from({ length: 21 }, () => staleReview), [summary("5/5")]];

  const result = await checkCiGate(snapshots);
  expect(result.failures).toEqual([]);
  expect(result.infos).toEqual(["Greptile dice 5/5 para el commit actual; puedes mergear."]);
});

test("el CI espera la revisión actual y rechaza la nota 4/5", async () => {
  const result = await checkCiGate([[summary("5/5", oldSha)], [summary("4/5")]]);
  expect(result.failures).toEqual(["Oye, Greptile dice 4/5; no puedes mergear así."]);
  expect(result.infos).toEqual([]);
});

test("el CI relee los comentarios al vencer el plazo para capturar una nota tardía", async () => {
  const staleReview = [summary("5/5", oldSha)];
  const snapshots = [...Array.from({ length: 30 }, () => staleReview), [summary("5/5")]];

  const result = await checkCiGate(snapshots);
  expect(result.failures).toEqual([]);
  expect(result.infos).toEqual(["Greptile dice 5/5 para el commit actual; puedes mergear."]);
});

test("el CI falla si no llega revisión para el SHA actual", async () => {
  const result = await checkCiGate([[summary("5/5", oldSha)]]);
  expect(result.failures).toEqual(["Falta la revisión de Greptile para el commit actual."]);
  expect(result.infos).toEqual([]);
});
