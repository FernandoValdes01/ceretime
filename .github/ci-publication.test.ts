import { expect, test } from "bun:test";

const workflow = Bun.YAML.parse(
  await Bun.file(`${import.meta.dir}/workflows/ci.yml`).text(),
) as any;
const publication = workflow.jobs["publish-pr-result"].steps[0].with.script;
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
  const github = {
    rest: {
      pulls: {
        get: async () => ({ data: { head: { sha, ref, repo: { full_name: repository } } } }),
      },
      issues: {
        listComments: () => {},
        createComment: async (args: any) => writes.push({ operation: "create", ...args }),
        updateComment: async (args: any) => writes.push({ operation: "update", ...args }),
      },
    },
    paginate: async () =>
      previous ? [{ id: 9, user: { type: "Bot" }, body: "<!-- ceretime-ci-build-result -->" }] : [],
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
  return { failures, writes };
}

test("creates evidence for the validated commit", async () => {
  const { failures, writes } = await publish();
  expect(failures).toHaveLength(0);
  expect(writes).toHaveLength(1);
  expect(writes[0].operation).toBe("create");
  expect(writes[0].body).toContain("Commit validado: current");
});

test("updates existing evidence with a failed build", async () => {
  const { failures, writes } = await publish({ previous: true, result: "failure" });
  expect(failures).toHaveLength(0);
  expect(writes).toHaveLength(1);
  expect(writes[0].operation).toBe("update");
  expect(writes[0].comment_id).toBe(9);
  expect(writes[0].body).toContain("Estado: **failure**");
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
  const upload = workflow.jobs.builds.steps.find(
    (step: any) => step.uses === "actions/upload-artifact@v4",
  );
  expect(upload.with["if-no-files-found"]).toBe("error");
  expect(upload.with.name).toContain("github.run_attempt");
});
