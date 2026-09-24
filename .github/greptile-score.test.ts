import { expect, test } from "bun:test";

const workflow = Bun.YAML.parse(
  await Bun.file(`${import.meta.dir}/workflows/greptile-score.yml`).text(),
) as any;
const ciWorkflow = Bun.YAML.parse(
  await Bun.file(`${import.meta.dir}/workflows/ci.yml`).text(),
) as any;
const script = workflow.jobs.score.steps[0].with.script;
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
    body: `<!-- greptile_summary --><h2>Confidence Score: ${score}</h2><sub>Reviews (2) · Last reviewed commit: ["review"](https://github.com/owner/repo/commit/${reviewedSha})</sub>`,
  };
}

async function publish(
  comments: object[],
  options: {
    eventName?: "workflow_run" | "issue_comment";
    headSha?: string;
    runSha?: string;
    associated?: boolean;
  } = {},
) {
  const statuses: any[] = [];
  const pullListQueries: any[] = [];
  const eventName = options.eventName ?? "workflow_run";
  const headSha = options.headSha ?? sha;
  const runSha = options.runSha ?? headSha;
  const pullRequest = {
    number: 1,
    base: { ref: "main" },
    state: "open",
    head: {
      sha: headSha,
      ref: "feature/ti4-34",
      repo: { full_name: "owner/repo" },
    },
    html_url: "https://github.com/owner/repo/pull/1",
  };
  const run = {
    name: "CI",
    event: "pull_request",
    head_sha: runSha,
    head_branch: "feature/ti4-34",
    head_repository: { full_name: "owner/repo" },
    pull_requests:
      options.associated === false
        ? []
        : [{ number: 1, base: { ref: "main" }, head: { sha: runSha } }],
  };
  const listPullRequests = async (args: any) => {
    pullListQueries.push(args);
    return { data: [pullRequest] };
  };
  const listComments = () => {};
  const github = {
    rest: {
      pulls: { get: async () => ({ data: pullRequest }), list: listPullRequests },
      issues: { listComments },
      repos: { createCommitStatus: async (args: any) => statuses.push(args) },
    },
    paginate: async (method: unknown, args: any) =>
      method === listPullRequests ? (await listPullRequests(args)).data : comments,
  };
  const context = {
    eventName,
    repo: { owner: "owner", repo: "repo" },
    payload: {
      issue: eventName === "issue_comment" ? { number: 1, pull_request: {} } : undefined,
      comment:
        eventName === "issue_comment"
          ? { user: { login: "greptile-apps[bot]", type: "Bot" } }
          : undefined,
      workflow_run: eventName === "workflow_run" ? run : undefined,
    },
  };
  await new AsyncFunction("github", "context", "core", script)(github, context, { info: () => {} });
  return { statuses, pullListQueries };
}

test("deja un solo requisito de Greptile en cada PR", () => {
  expect(ciWorkflow.jobs.greptile_score).toBeUndefined();
  expect(workflow.on.pull_request_target).toBeUndefined();
  expect(workflow.on.issue_comment.types).toEqual(["created", "edited", "deleted"]);
  expect(workflow.on.workflow_run).toMatchObject({ workflows: ["CI"], types: ["completed"] });
  expect(workflow.jobs.score.permissions).toEqual({
    issues: "read",
    "pull-requests": "read",
    statuses: "write",
  });
});

test("aprueba solo 5/5 para el commit actual", async () => {
  const result = await publish([summary("5/5")]);
  expect(result.statuses[0]).toMatchObject({
    sha,
    context: "Greptile 5/5",
    state: "success",
    description: "Greptile aprobó 5/5 para el commit actual.",
    target_url: summary("5/5").html_url,
  });
});

test("lee el formato publicado por Greptile en una PR real", async () => {
  const comment = {
    ...summary("5/5", reviewedRealSha),
    body: `<!-- greptile_summary -->

<h2><a href="https://app.greptile.com/api/retrigger?id=68156626">Retrigger</a>Confidence Score: 5/5</h2>

<!-- greptile_confidence_score:5 -->

<sub>Reviews (1) · Last reviewed commit: ["Update api.d.ts"](https://github.com/fernandovaldes01/ceretime/commit/${reviewedRealSha})</sub>`,
  };
  const result = await publish([comment], { headSha: reviewedRealSha });
  expect(result.statuses[0]).toMatchObject({ sha: reviewedRealSha, state: "success" });
});

test("marca con una X los cambios pendientes de Greptile", async () => {
  const result = await publish([summary("4/5")], { eventName: "issue_comment" });
  expect(result.statuses[0]).toMatchObject({
    sha,
    context: "Greptile 5/5",
    state: "failure",
    description: "Hay cambios pendientes de Greptile (4/5).",
  });
});

test("rechaza una revisión antigua, ausente o de otro autor", async () => {
  expect((await publish([summary("5/5", oldSha)])).statuses[0].state).toBe("failure");
  expect((await publish([])).statuses[0]).toMatchObject({
    state: "failure",
    description: "Falta la revisión de Greptile para este commit.",
  });
  const fake = { ...summary("5/5"), user: { login: "someone", type: "User" } };
  expect((await publish([fake])).statuses[0].state).toBe("failure");
});

test("usa la última nota cuando Greptile edita el resumen", async () => {
  const comments = [summary("5/5"), summary("4/5", sha, "2026-09-23T01:00:00Z")];
  expect((await publish(comments)).statuses[0]).toMatchObject({
    state: "failure",
    description: "Hay cambios pendientes de Greptile (4/5).",
  });
});

test("desempata comentarios de Greptile por su ID", async () => {
  const sameTime = "2026-09-23T01:00:00Z";
  const comments = [summary("5/5", sha, sameTime, 10), summary("4/5", sha, sameTime, 11)];
  expect((await publish(comments)).statuses[0].state).toBe("failure");
});

test("actualiza el status cuando se elimina el comentario de Greptile", async () => {
  expect((await publish([], { eventName: "issue_comment" })).statuses[0].state).toBe("failure");
});

test("encuentra la PR cuando GitHub omite su asociación en el run", async () => {
  const result = await publish([summary("5/5")], { associated: false });
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
  expect(result.statuses[0]).toMatchObject({ sha, state: "success" });
});

test("ignora un run cuyo commit ya no es el de la PR", async () => {
  const result = await publish([summary("5/5")], { runSha: oldSha });
  expect(result.statuses).toEqual([]);
});
