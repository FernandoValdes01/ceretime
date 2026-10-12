import { expect, test } from "bun:test";
const ci: any = Bun.YAML.parse(await Bun.file(`${import.meta.dir}/workflows/ci.yml`).text());
const evaluate = (expression: string, github: any) =>
  new Function("github", `return (${expression.replace(/^\$\{\{|\}\}$/g, "")});`)(github);
function event(
  number = 73,
  action = "synchronize",
  base = "main",
  run = 1,
  eventName = "pull_request",
) {
  return {
    workflow: "CI",
    run_id: run,
    event_name: eventName,
    ref: eventName === "push" ? "refs/heads/main" : `refs/pull/${number}/merge`,
    repository: "owner/repo",
    event: {
      action,
      changes: action === "edited" ? { base: { ref: { from: "feature-a" } } } : {},
      pull_request:
        eventName === "push"
          ? ({ number: undefined } as any)
          : { number, base: { ref: base }, head: { repo: { full_name: "owner/repo" } } },
    },
  };
}
const group = (github: any) =>
  ci.concurrency.group.replace(/\$\{\{(.*?)\}\}/g, (_: string, expr: string) =>
    evaluate(expr, github),
  );
const cancels = (old: any, next: any) =>
  group(old) === group(next) && evaluate(ci.concurrency["cancel-in-progress"], next);
test("successive commits and reruns supersede obsolete validation of the same PR", () => {
  expect(cancels(event(), event(73, "synchronize", "main", 2))).toBe(true);
  expect(cancels(event(), event(73, "synchronize", "feature-a", 3))).toBe(true);
});
test("other PRs and main pushes cannot cancel one another", () => {
  expect(cancels(event(), event(75))).toBe(false);
  expect(cancels(event(0, "push", "main", 1, "push"), event())).toBe(false);
  expect(cancels(event(), event(0, "push", "main", 2, "push"))).toBe(false);
  expect(group(event(0, "push", "main", 1, "push"))).not.toBe(
    group(event(0, "push", "main", 2, "push")),
  );
});
test("stacks and base edits receive integrated CI with compatible names", () => {
  expect(ci.on.pull_request.branches).toBeUndefined();
  expect(ci.on.pull_request.types).toContain("edited");
  expect(ci.on.push.branches).toEqual(["main"]);
  expect(["lint-and-format", "mobile", "web", "backend"].map((id) => ci.jobs[id].name)).toEqual([
    "Lint y formato",
    "Validación Mobile",
    "Validación Web",
    "Verificación Backend",
  ]);
  for (const id of ["lint-and-format", "mobile", "web", "backend"]) {
    expect(ci.jobs[id].if).toBeUndefined();
    expect(ci.jobs[id].steps[0].with?.ref).toBeUndefined();
  }
});
test("Preview matches eligible PR events and Production only a main push", () => {
  for (const action of ["opened", "synchronize", "reopened", "ready_for_review", "edited"]) {
    expect(evaluate(ci.jobs["vercel-preview"].if, event(73, action, "feature-a"))).toBeTruthy();
    expect(evaluate(ci.jobs["vercel-production"].if, event(73, action))).toBe(false);
  }
  const metadata = event(73, "edited");
  metadata.event.changes = {} as any;
  expect(cancels(event(), metadata)).toBe(false);
  expect(evaluate(ci.jobs["vercel-preview"].if, metadata)).toBeFalsy();
  const fork = event();
  fork.event.pull_request!.head.repo.full_name = "fork/repo";
  expect(evaluate(ci.jobs["vercel-preview"].if, fork)).toBe(false);
  expect(evaluate(ci.jobs["vercel-preview"].if, event(0, "push", "main", 1, "push"))).toBe(false);
  expect(evaluate(ci.jobs["vercel-production"].if, event(0, "push", "main", 1, "push"))).toBe(true);
});
for (const stale of ["head", "base", "closed"])
  test(`stale Preview ${stale} preserves the current comment`, async () => {
    const step = ci.jobs["vercel-preview"].steps.find(
      (s: any) => s.name === "Publicar URL de Preview en la PR",
    );
    const writes: any[] = [];
    const pr = {
      state: stale === "closed" ? "closed" : "open",
      head: { sha: stale === "head" ? "new" : "head" },
      base: { sha: stale === "base" ? "new" : "base", ref: "main" },
    };
    const github = {
      rest: {
        pulls: { get: async () => ({ data: pr }) },
        issues: {
          listComments: () => {},
          createComment: async (x: any) => writes.push(x),
          updateComment: async (x: any) => writes.push(x),
        },
      },
      paginate: async () => [],
    };
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction("github", "context", "process", "core", step.with.script)(
      github,
      { repo: { owner: "owner", repo: "repo" }, issue: { number: 73 } },
      {
        env: {
          PR_HEAD_SHA: "head",
          PR_BASE_SHA: "base",
          PR_BASE_REF: "main",
          PREVIEW_BUILD_SHA: "merge",
          PREVIEW_URL: "https://preview.example.invalid",
        },
      },
      { info: () => {} },
    );
    expect(writes).toHaveLength(0);
  });
test("an old main rerun cannot promote Production over the current commit", async () => {
  const step = ci.jobs["vercel-production"].steps.find((s: any) => s.id === "production-target");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const messages: string[] = [];
  const core = {
    summary: {
      addRaw: (s: string) => {
        messages.push(s);
        return { write: async () => {} };
      },
    },
  };
  const github = {
    rest: { git: { getRef: async () => ({ data: { object: { sha: "current" } } }) } },
  };
  expect(
    await new AsyncFunction("github", "context", "core", step.with.script)(
      github,
      { repo: { owner: "owner", repo: "repo" }, sha: "obsolete" },
      core,
    ),
  ).toBe(false);
  expect(messages).toHaveLength(1);
  expect(
    await new AsyncFunction("github", "context", "core", step.with.script)(
      github,
      { repo: { owner: "owner", repo: "repo" }, sha: "current" },
      core,
    ),
  ).toBe(true);
  const deploy = ci.jobs["vercel-production"].steps.find(
    (s: any) => s.name === "Desplegar Web Production",
  );
  expect(deploy.if).toBe("steps.production-target.outputs.result == 'true'");
  expect(ci.jobs["vercel-production"].concurrency["cancel-in-progress"]).toBe(false);
});
test("Preview checks again if the PR changes while comments are being read", async () => {
  const step = ci.jobs["vercel-preview"].steps.find(
    (s: any) => s.name === "Publicar URL de Preview en la PR",
  );
  let head = "head";
  const writes: any[] = [];
  const github = {
    rest: {
      pulls: {
        get: async () => ({
          data: { state: "open", head: { sha: head }, base: { sha: "base", ref: "main" } },
        }),
      },
      issues: {
        listComments: () => {},
        createComment: async (x: any) => writes.push(x),
        updateComment: async (x: any) => writes.push(x),
      },
    },
    paginate: async () => {
      head = "new";
      return [];
    },
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction("github", "context", "process", "core", step.with.script)(
    github,
    { repo: { owner: "owner", repo: "repo" }, issue: { number: 73 } },
    {
      env: {
        PR_HEAD_SHA: "head",
        PR_BASE_SHA: "base",
        PR_BASE_REF: "main",
        PREVIEW_BUILD_SHA: "merge",
        PREVIEW_URL: "https://preview.example.invalid",
      },
    },
    { info: () => {} },
  );
  expect(writes).toEqual([]);
});
