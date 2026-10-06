import { expect, test } from "bun:test";
import { BOT, respondToInline } from "./ai-review-conversation.cjs";
import { jsonResponse, runDemo } from "./ai-review-demo.cjs";

function harness() {
  const sha = "a".repeat(40);
  const pr = {
    number: 74,
    title: "QA",
    body: "Contexto",
    state: "open",
    draft: false,
    base: { ref: "main", sha: "b".repeat(40) },
    head: { sha, repo: { full_name: "test/repo" } },
  };
  const root = {
    id: 1,
    body: "Validar en Application.",
    path: "example.ts",
    line: 2,
    side: "RIGHT",
    diff_hunk: "@@ -1 +1 @@\n+validate();",
    original_commit_id: sha,
    user: { login: BOT, type: "Bot" },
  };
  const reply = {
    id: 2,
    in_reply_to_id: 1,
    body: "La validación ya ocurre antes.",
    user: { login: "developer", type: "User" },
    author_association: "MEMBER",
  };
  const comments: any[] = [root, reply];
  const sent: any[] = [],
    requests: any[] = [];
  let decision = "not_applicable",
    failed = false;
  const github = {
    paginate: async () => comments,
    rest: {
      pulls: {
        get: async () => ({ data: pr }),
        listReviewComments: () => {},
        createReplyForReviewComment: async (request: any) => {
          sent.push(request);
          comments.push({
            id: 3,
            in_reply_to_id: request.comment_id,
            body: request.body,
            user: root.user,
          });
        },
      },
      repos: {
        getContent: async () => {
          throw new Error("Deleted");
        },
      },
    },
  };
  const context = {
    repo: { owner: "test", repo: "repo" },
    payload: { action: "created", pull_request: pr, comment: reply },
  };
  const options = {
    github,
    context,
    env: { REVIEW_BOT_LOGIN: BOT, OPENROUTER_API_KEY: "simulation" },
    fetchImpl: async (url: string, request: any) => {
      expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(request.headers.Authorization).toBe("Bearer simulation");
      expect(JSON.parse(request.body)).toMatchObject({
        model: "deepseek/deepseek-v4.1-flash",
        reasoning: { enabled: false },
        response_format: { type: "json_object" },
      });
      requests.push(JSON.parse(request.body));
      if (failed) throw new Error("Unavailable");
      return jsonResponse({
        decision,
        explanation: "Según el contexto aportado, la validación ya ocurre antes.",
        depends_on_external_context: true,
      });
    },
  };
  return {
    options,
    pr,
    root,
    reply,
    comments,
    sent,
    requests,
    setDecision: (value: string) => {
      decision = value;
    },
    fail: () => {
      failed = true;
    },
  };
}

test("4/5: pipeline completo, dos inline válidos y conversación en el mismo hilo", async () => {
  const demo = await runDemo();
  expect(demo.report.coverage).toBe("complete");
  expect(demo.report.score).toBe(4);
  expect(demo.report.findings).toHaveLength(2);
  expect(demo.replies[0].comment_id).toBe(demo.inline[0].id);
  expect(demo.evidence).toContain("OpenRouter y GitHub simulados");
});

for (const decision of ["maintain", "correct", "not_applicable", "needs_context"]) {
  test(`conversación reconoce la decisión ${decision}`, async () => {
    const h = harness();
    h.setDecision(decision);
    const result = await respondToInline(h.options);
    expect(result.decision).toBe(decision);
    expect(h.sent[0].comment_id).toBe(1);
    expect(h.sent[0].body).toContain("no puedo verificar tareas o decisiones de Linear");
    const data = JSON.parse(h.requests[0].messages[1].content);
    expect(data.finding.path).toBe("example.ts");
    expect(data.finding.hunk).toContain("validate()");
    expect(data.developer_response).toBe(h.reply.body);
    expect(h.requests).toHaveLength(1);
  });
}

test("no responde al bot ni a comentarios ajenos o usuarios externos", async () => {
  for (const change of [
    (h: any) => {
      h.reply.user = { login: BOT, type: "Bot" };
    },
    (h: any) => {
      h.root.user.login = "other[bot]";
    },
    (h: any) => {
      h.reply.author_association = "NONE";
    },
  ]) {
    const h = harness();
    change(h);
    expect((await respondToInline(h.options)).ignored).toBe(true);
    expect(h.requests).toHaveLength(0);
  }
});

test("reintento del evento no duplica la respuesta", async () => {
  const h = harness();
  await respondToInline(h.options);
  await respondToInline(h.options);
  expect(h.sent).toHaveLength(1);
  expect(h.requests).toHaveLength(1);
});

test("respuesta a una respuesta usa la raíz y conserva la conversación previa", async () => {
  const h = harness();
  h.comments.push({
    id: 4,
    in_reply_to_id: 1,
    body: "Explicación anterior",
    user: { login: BOT, type: "Bot" },
  });
  h.reply.in_reply_to_id = 4;
  await respondToInline(h.options);
  expect(h.sent[0].comment_id).toBe(1);
  expect(JSON.parse(h.requests[0].messages[1].content).prior_messages[0].body).toBe(
    "Explicación anterior",
  );
});

test("head nuevo durante consulta impide publicar una conclusión obsoleta", async () => {
  const h = harness();
  const fetchImpl = h.options.fetchImpl;
  h.options.fetchImpl = async (...args: Parameters<typeof fetchImpl>) => {
    const result = await fetchImpl(...args);
    h.pr.head.sha = "b".repeat(40);
    return result;
  };
  expect((await respondToInline(h.options)).ignored).toBe(true);
  expect(h.sent).toHaveLength(0);
});

test("fallo técnico tiene como máximo dos llamadas y pide reintento sin defender hallazgo", async () => {
  const h = harness();
  h.fail();
  expect((await respondToInline(h.options)).decision).toBe("needs_context");
  expect(h.requests).toHaveLength(2);
  expect(h.sent).toHaveLength(1);
});

test("Draft, fork y App incorrecta no consumen OpenRouter", async () => {
  for (const change of [
    (h: any) => {
      h.pr.draft = true;
    },
    (h: any) => {
      h.pr.head.repo.full_name = "other/repo";
    },
    (h: any) => {
      h.options.env.REVIEW_BOT_LOGIN = "github-actions[bot]";
    },
  ]) {
    const h = harness();
    change(h);
    await respondToInline(h.options);
    expect(h.requests).toHaveLength(0);
  }
});

test("respuesta inválida se recupera y mensajes largos señalan contexto parcial", async () => {
  const h = harness();
  h.reply.body = "a".repeat(5000);
  const valid = h.options.fetchImpl;
  let attempt = 0;
  h.options.fetchImpl = async (...args: Parameters<typeof valid>) => {
    if (attempt++ === 0) return jsonResponse({ decision: "invented", explanation: "Incorrecto" });
    return valid(...args);
  };
  expect((await respondToInline(h.options)).decision).toBe("not_applicable");
  expect(attempt).toBe(2);
  expect(JSON.parse(h.requests[0].messages[1].content).context_truncated).toBe(true);
});

test("sin secret o si desaparece la respuesta humana no publica", async () => {
  const h = harness();
  h.options.env.OPENROUTER_API_KEY = "";
  expect((await respondToInline(h.options)).ignored).toBe(true);
  expect(h.requests).toHaveLength(0);
  const deleted = harness();
  const fetchImpl = deleted.options.fetchImpl;
  deleted.options.fetchImpl = async (...args: Parameters<typeof fetchImpl>) => {
    const result = await fetchImpl(...args);
    deleted.comments.splice(1, 1);
    return result;
  };
  expect((await respondToInline(deleted.options)).ignored).toBe(true);
  expect(deleted.sent).toHaveLength(0);
});

test("conversation accepts an internal stacked PR and supplies its immediate base", async () => {
  const h = harness();
  h.pr.base.ref = "feature/lower-pr";
  const result = await respondToInline(h.options);
  expect(result.decision).toBe("not_applicable");
  const data = JSON.parse(h.requests[0].messages[1].content);
  expect(data.pr.baseRef).toBe("feature/lower-pr");
  expect(data.pr.base).toBe(h.pr.base.sha);
});

for (const change of ["ref", "sha"]) {
  test(`base ${change} changed during conversation suppresses the obsolete reply`, async () => {
    const h = harness();
    const fetchImpl = h.options.fetchImpl;
    h.options.fetchImpl = async (...args: Parameters<typeof fetchImpl>) => {
      const response = await fetchImpl(...args);
      if (change === "ref") h.pr.base.ref = "feature/lower-pr";
      else h.pr.base.sha = "c".repeat(40);
      return response;
    };
    expect((await respondToInline(h.options)).ignored).toBe(true);
    expect(h.sent).toHaveLength(0);
  });
}
