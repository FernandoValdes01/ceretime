import { expect, test } from "bun:test";

const workflow = Bun.YAML.parse(
  await Bun.file(`${import.meta.dir}/workflows/greptile-score.yml`).text(),
) as any;
const ciWorkflow = Bun.YAML.parse(
  await Bun.file(`${import.meta.dir}/workflows/ci.yml`).text(),
) as any;
const resolveScript = workflow.jobs.resolve_pr.steps[0].with.script;
const script = workflow.jobs.score.steps[0].with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const sha = "a".repeat(40);
const oldSha = "b".repeat(40);

function summary(score: string, reviewedSha = sha, updatedAt = "2026-09-23T00:00:00Z", id = 1) {
  return {
    id,
    user: { login: "greptile-apps[bot]", type: "Bot" },
    html_url: "https://github.com/owner/repo/pull/1#issuecomment-2",
    updated_at: updatedAt,
    body: `<!-- greptile_summary --><h2>Confidence Score: ${score}</h2><sub>Last reviewed commit: ["review"](https://github.com/owner/repo/commit/${reviewedSha})</sub>`,
  };
}

async function check(
  comments: object[],
  eventName = "issue_comment",
  options: { headSha?: string; runSha?: string } = {},
) {
  const statuses: any[] = [];
  const headSha = options.headSha ?? sha;
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
    head_sha: options.runSha ?? headSha,
  };
  const listComments = () => {};
  const github = {
    rest: {
      pulls: { get: async () => ({ data: pullRequest }) },
      issues: { listComments },
      repos: { createCommitStatus: async (args: any) => statuses.push(args) },
    },
    paginate: async () => comments,
  };
  const context = {
    eventName,
    repo: { owner: "owner", repo: "repo" },
    payload: {
      issue: eventName === "issue_comment" ? { number: 1, pull_request: {} } : undefined,
      workflow_run: eventName === "workflow_run" ? run : undefined,
    },
  };
  await new AsyncFunction("github", "context", "core", script)(github, context, {
    info: () => {},
  });
  return { statuses };
}

async function resolvePullNumber(eventName: string, payload: any) {
  const outputs: Record<string, string> = {};
  const pullListQueries: any[] = [];
  const listPullRequests = async (args: any) => {
    pullListQueries.push(args);
    return {
      data: [
        {
          number: 1,
          head: {
            sha,
            ref: "feature/ti4-34",
            repo: { full_name: "owner/repo" },
          },
        },
      ],
    };
  };
  const github = {
    rest: { pulls: { list: listPullRequests } },
    paginate: async (_method: unknown, args: any) => (await listPullRequests(args)).data,
  };
  const context = { eventName, repo: { owner: "owner", repo: "repo" }, payload };
  const core = { setOutput: (name: string, value: string) => (outputs[name] = value) };
  await new AsyncFunction("github", "context", "core", resolveScript)(github, context, core);
  return { outputs, pullListQueries };
}

test("el check requerido se actualiza desde un workflow confiable", () => {
  expect(workflow.on.pull_request_target).toBeUndefined();
  expect(workflow.on.issue_comment.types).toEqual(["created", "edited", "deleted"]);
  expect(workflow.on.workflow_run).toMatchObject({ workflows: ["CI"], types: ["completed"] });
  expect(workflow.jobs.score.permissions).toEqual({
    issues: "read",
    "pull-requests": "read",
    statuses: "write",
  });
  expect(workflow.jobs.score.concurrency.group).toBe(
    "greptile-score-${{ needs.resolve_pr.outputs.pull_number }}",
  );
  expect(workflow.jobs.score.concurrency["cancel-in-progress"]).toBe(false);
  expect(workflow.jobs.score.steps[0].uses).toMatch(/^actions\/github-script@[0-9a-f]{40}$/);
  expect(ciWorkflow.jobs.greptile_score).toBeUndefined();
});

test("ordena por PR y resuelve su número desde ambos eventos", async () => {
  const issueComment = await resolvePullNumber("issue_comment", {
    issue: { number: 18, pull_request: {} },
  });
  expect(issueComment.outputs.pull_number).toBe("18");

  const workflowRun = await resolvePullNumber("workflow_run", {
    workflow_run: {
      name: "CI",
      event: "pull_request",
      head_sha: sha,
      pull_requests: [{ number: 19, base: { ref: "main" }, head: { sha: oldSha } }],
    },
  });
  expect(workflowRun.outputs.pull_number).toBe("19");
});

test("busca la PR por rama cuando el run de CI no incluye su asociación", async () => {
  const result = await resolvePullNumber("workflow_run", {
    workflow_run: {
      name: "CI",
      event: "pull_request",
      head_sha: oldSha,
      head_branch: "feature/ti4-34",
      head_repository: { full_name: "owner/repo" },
    },
  });
  expect(result.outputs.pull_number).toBe("1");
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
});

test("acepta 5/5 para el SHA actual", async () => {
  const comment = summary("5/5");
  const { statuses } = await check([comment]);
  expect(statuses[0]).toMatchObject({
    sha,
    context: "Greptile 5/5",
    state: "success",
    description: "Greptile 5/5 para el commit actual.",
    target_url: comment.html_url,
  });
});

test("marca el check con error cuando Greptile da 4/5", async () => {
  const { statuses } = await check([summary("4/5")]);
  expect(statuses[0]).toMatchObject({
    sha,
    context: "Greptile 5/5",
    state: "failure",
    description: "Hay cambios pendientes de Greptile (4/5).",
  });
});

test("rechaza revisiones anteriores, ausentes o con una nota inválida", async () => {
  expect((await check([summary("5/5", oldSha)])).statuses[0]).toMatchObject({
    state: "failure",
    description: "La revisión de Greptile no corresponde al commit actual.",
  });
  expect((await check([])).statuses[0]).toMatchObject({
    state: "failure",
    description: "Falta la revisión de Greptile para este commit.",
  });
  expect((await check([summary("sin nota")])).statuses[0]).toMatchObject({
    state: "failure",
    description: "Greptile no publicó una nota válida para el commit actual.",
  });
});

test("usa el comentario más reciente de Greptile", async () => {
  const comments = [summary("5/5"), summary("4/5", sha, "2026-09-23T01:00:00Z")];
  expect((await check(comments)).statuses[0].state).toBe("failure");
});

test("los comentarios editados y eliminados vuelven a evaluar la nota vigente", async () => {
  expect(workflow.on.issue_comment.types).toContain("edited");
  expect(workflow.on.issue_comment.types).toContain("deleted");
  const remaining = [summary("4/5")];
  expect((await check(remaining, "issue_comment")).statuses[0].state).toBe("failure");
});

test("valida el SHA actual aunque CI haya terminado en un commit anterior", async () => {
  const { statuses } = await check([summary("5/5")], "workflow_run", { runSha: oldSha });
  expect(statuses[0]).toMatchObject({ sha, state: "success" });
});

test("ignora runs que no pertenecen a CI de una pull request", async () => {
  const result = await resolvePullNumber("workflow_run", {
    workflow_run: {
      name: "Validación de builds",
      event: "pull_request",
      head_sha: sha,
    },
  });
  expect(result.outputs.pull_number).toBeUndefined();
});
