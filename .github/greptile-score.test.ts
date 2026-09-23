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

function summary(score: string, reviewedSha = sha, updatedAt = "2026-09-23T00:00:00Z") {
  return {
    user: { login: "greptile-apps[bot]", type: "Bot" },
    html_url: "https://github.com/owner/repo/pull/1#issuecomment-2",
    updated_at: updatedAt,
    body: `<!-- greptile_summary --><h2><a href="https://app.greptile.com/api/retrigger">Retrigger</a>Confidence Score: ${score}</h2><sub>Reviews (2) · Last reviewed commit: ["review"](https://github.com/owner/repo/commit/${reviewedSha})</sub>`,
  };
}

async function check(comments: object[], eventName = "pull_request_target", headSha = sha) {
  const statuses: any[] = [];
  const github = {
    rest: {
      pulls: {
        get: async () => ({
          data: {
            base: { ref: "main" },
            state: "open",
            head: { sha: headSha },
            html_url: "https://github.com/owner/repo/pull/1",
          },
        }),
      },
      issues: { listComments: () => {} },
      repos: { createCommitStatus: async (args: any) => statuses.push(args) },
    },
    paginate: async () => comments,
  };
  const context = {
    eventName,
    repo: { owner: "owner", repo: "repo" },
    payload: {
      pull_request: eventName === "pull_request_target" ? { number: 1 } : undefined,
      issue: eventName === "issue_comment" ? { number: 1, pull_request: {} } : undefined,
      comment:
        eventName === "issue_comment" ? { user: { login: "greptile-apps[bot]" } } : undefined,
    },
  };
  await new AsyncFunction("github", "context", "core", script)(github, context, {
    info: () => {},
  });
  return statuses;
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
  const [status] = await check([summary("5/5")]);
  expect(status).toMatchObject({ sha, context: "Greptile 5/5", state: "success" });
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
  const [status] = await check([comment], "pull_request_target", reviewedRealSha);
  expect(status).toMatchObject({
    sha: reviewedRealSha,
    context: "Greptile 5/5",
    state: "success",
    target_url: comment.html_url,
  });
});

test("rechaza 4/5 aunque Greptile publique su propio check correcto", async () => {
  const [status] = await check([summary("4/5")], "issue_comment");
  expect(status).toMatchObject({ sha, context: "Greptile 5/5", state: "failure" });
  expect(status.description).toContain("4/5");
});

test("rechaza revisiones anteriores y la ausencia de revisión", async () => {
  expect((await check([summary("5/5", oldSha)]))[0].state).toBe("failure");
  expect((await check([]))[0].state).toBe("failure");
});

test("actualiza el status cuando se elimina el comentario de Greptile", async () => {
  expect(workflow.on.issue_comment.types).toContain("deleted");
  expect((await check([], "issue_comment"))[0].state).toBe("failure");
});

test("usa la última revisión cuando hay varios comentarios de Greptile", async () => {
  const comments = [summary("5/5"), summary("4/5", sha, "2026-09-23T01:00:00Z")];
  expect((await check(comments))[0].state).toBe("failure");
});

test("ignora comentarios que imitan el marcador de Greptile", async () => {
  const fake = { ...summary("5/5"), user: { login: "someone", type: "User" } };
  expect((await check([fake]))[0].state).toBe("failure");
});

test("no ejecuta código de la PR ni comparte permisos de escritura con otros jobs", () => {
  expect(workflow.on.pull_request_target.branches).toEqual(["main"]);
  expect(workflow.on.pull_request_target.types).toContain("ready_for_review");
  expect(workflow.on.issue_comment.types).toEqual(["created", "edited", "deleted"]);
  expect(workflow.jobs.score.permissions.statuses).toBe("write");
  expect(workflow.jobs.score.steps).toHaveLength(1);
  expect(workflow.jobs.score.steps[0].uses).toMatch(/^actions\/github-script@[0-9a-f]{40}$/);
});

test("el check de CI está disponible en PR listas y solo lee GitHub", () => {
  const gate = ciWorkflow.jobs.greptile_score;
  expect(ciWorkflow.on.pull_request.types).toContain("ready_for_review");
  expect(gate.name).toBe("Greptile 5/5");
  expect(gate.if).toContain("pull_request.draft == false");
  expect(gate.permissions).toEqual({ issues: "read", "pull-requests": "read" });
  expect(gate.timeout).toBeUndefined();
  expect(gate["timeout-minutes"]).toBe(360);
});

test("el CI activo falla cuando la revisión actual de Greptile es 4/5", async () => {
  expect(gateScript).not.toBe("");
  expect(await checkCiGate([[summary("4/5")]])).toEqual({
    failures: ["Oye, Greptile dice 4/5; no puedes mergear así."],
    infos: [],
  });
});

test("el CI activo acepta 5/5 para el SHA actual", async () => {
  expect(await checkCiGate([[summary("5/5")]])).toEqual({
    failures: [],
    infos: ["Greptile dice 5/5 para el commit actual; puedes mergear."],
  });
});

test("el CI activo acepta una revisión actual que llega después de diez minutos", async () => {
  const staleReview = [summary("5/5", oldSha)];
  const snapshots = [...Array.from({ length: 11 }, () => staleReview), [summary("5/5")]];

  expect(await checkCiGate(snapshots)).toEqual({
    failures: [],
    infos: ["Greptile dice 5/5 para el commit actual; puedes mergear."],
  });
});

test("el CI activo espera la revisión actual y rechaza la nota 4/5", async () => {
  expect(await checkCiGate([[summary("5/5", oldSha)], [summary("4/5")]])).toEqual({
    failures: ["Oye, Greptile dice 4/5; no puedes mergear así."],
    infos: [],
  });
});

test("el CI activo falla si no llega revisión para el SHA actual", async () => {
  expect(await checkCiGate([[summary("5/5", oldSha)]])).toEqual({
    failures: ["Falta la revisión de Greptile para el commit actual."],
    infos: [],
  });
});
