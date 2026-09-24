import { expect, test } from "bun:test";

const workflow = Bun.YAML.parse(
  await Bun.file(`${import.meta.dir}/workflows/build-validation.yml`).text(),
) as any;
const pullRequestWorkflow = Bun.YAML.parse(
  await Bun.file(`${import.meta.dir}/workflows/ci.yml`).text(),
) as any;
const publicationStep = workflow.jobs["publish-pr-result"].steps[0];
const publication = publicationStep.with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function publish({
  sha = "current",
  ref = "feature",
  repository = "owner/repo",
  previous = false,
  result = "success",
  number = "18",
} = {}) {
  const failures: string[] = [];
  const writes: any[] = [];
  const paginationRequests: any[] = [];
  const listComments = () => {};
  const github = {
    rest: {
      pulls: {
        get: async () => ({ data: { head: { sha, ref, repo: { full_name: repository } } } }),
      },
      issues: {
        listComments,
        createComment: async (args: any) => writes.push({ operation: "create", ...args }),
        updateComment: async (args: any) => writes.push({ operation: "update", ...args }),
      },
    },
    paginate: async (method: unknown, args: unknown) => {
      paginationRequests.push({ method, args });
      return previous
        ? [{ id: 9, user: { type: "Bot" }, body: "<!-- ceretime-ci-build-result -->" }]
        : [];
    },
  };
  await new AsyncFunction("core", "github", "context", "process", publication)(
    { setFailed: (message: string) => failures.push(message) },
    github,
    { repo: { owner: "owner", repo: "repo" }, sha: "current" },
    {
      env: {
        PR_NUMBER: number,
        WORKFLOW_REF: "refs/heads/feature",
        RUN_RESULT: result,
        RUN_URL: "https://example.com/run",
      },
    },
  );
  return { failures, writes, paginationRequests, listComments };
}

test("creates evidence for the validated commit", async () => {
  const { failures, writes, paginationRequests, listComments } = await publish();
  expect(failures).toHaveLength(0);
  expect(writes).toHaveLength(1);
  expect(writes[0].operation).toBe("create");
  expect(writes[0].body).toContain("Commit validado: current");
  expect(paginationRequests).toHaveLength(1);
  expect(paginationRequests[0].args).toEqual({
    owner: "owner",
    repo: "repo",
    issue_number: 18,
    per_page: 100,
  });
  expect(paginationRequests[0].method).toBe(listComments);
});

test("updates existing evidence with a failed build", async () => {
  const { failures, writes, paginationRequests, listComments } = await publish({
    previous: true,
    result: "failure",
  });
  expect(failures).toHaveLength(0);
  expect(writes).toHaveLength(1);
  expect(writes[0].operation).toBe("update");
  expect(writes[0].comment_id).toBe(9);
  expect(writes[0].body).toContain("Estado: **failure**");
  expect(paginationRequests).toHaveLength(1);
  expect(paginationRequests[0].args).toEqual({
    owner: "owner",
    repo: "repo",
    issue_number: 18,
    per_page: 100,
  });
  expect(paginationRequests[0].method).toBe(listComments);
});

for (const scenario of [
  { sha: "newer" },
  { ref: "other" },
  { repository: "fork/repo" },
  { number: "invalid" },
]) {
  test(`rejects mismatched PR data ${JSON.stringify(scenario)}`, async () => {
    const { failures, writes } = await publish(scenario);
    expect(failures).toHaveLength(1);
    expect(writes).toHaveLength(0);
  });
}

test("requires artifacts and keeps each attempt separate", () => {
  const upload = workflow.jobs.builds.steps.find((step: any) =>
    step.uses?.startsWith("actions/upload-artifact@"),
  );
  expect(upload.uses).toMatch(/^actions\/upload-artifact@[0-9a-f]{40}$/);
  expect(upload.with["if-no-files-found"]).toBe("error");
  expect(upload.with.name).toContain("github.run_attempt");
});

test("serializes manual builds and wires publication inputs", () => {
  expect(workflow.concurrency.group).toContain("github.ref");
  expect(workflow.concurrency["cancel-in-progress"]).toBe(true);
  expect(workflow.on.workflow_dispatch.inputs.pr_number).toMatchObject({
    required: true,
    type: "string",
  });
  expect(workflow.jobs.builds.if).toBeUndefined();
  expect(
    workflow.jobs.builds.steps.filter((step: any) => step.if && step.if !== "${{ always() }}"),
  ).toHaveLength(0);
  expect(workflow.jobs["publish-pr-result"].if).toContain("always()");
  expect(publicationStep.env).toEqual({
    PR_NUMBER: "${{ inputs.pr_number }}",
    RUN_RESULT: "${{ needs.builds.result }}",
    RUN_URL: "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
    WORKFLOW_REF: "${{ github.ref }}",
  });
});

test("keeps manual builds out of pull request CI", () => {
  expect(pullRequestWorkflow.on.pull_request).toBeDefined();
  expect(pullRequestWorkflow.on.workflow_dispatch).toBeUndefined();
  expect(pullRequestWorkflow.jobs.builds).toBeUndefined();
  expect(pullRequestWorkflow.jobs["publish-pr-result"]).toBeUndefined();
});

test("runs four integrated CI jobs for pull requests and pushes to main", () => {
  expect(pullRequestWorkflow.on.pull_request.branches).toEqual(["main"]);
  expect(pullRequestWorkflow.on.pull_request.types).toContain("ready_for_review");
  expect(pullRequestWorkflow.on.push.branches).toEqual(["main"]);
  const jobNames = Object.values(pullRequestWorkflow.jobs)
    .map((job: any) => job.name)
    .sort();
  expect(jobNames).toEqual(
    ["Lint y formato", "Validación Mobile", "Validación Web", "Verificación Backend"].sort(),
  );
});
