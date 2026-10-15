import { describe, expect, test } from "bun:test";
import { interpretEvent, type GitHubEvent } from "./events";
import { publishMessage } from "./publish";
import { run } from "./notify";
import users from "./users.json";

function event(overrides: Partial<GitHubEvent> = {}): GitHubEvent {
  return {
    action: "review_requested",
    sender: { login: "nunezpinillalucas435-dev" },
    requested_reviewer: { login: "Juanfra272" },
    pull_request: {
      number: 92,
      html_url: "https://github.com/FernandoValdes01/ceretime/pull/92",
      user: { login: "Juanfra272" },
      base: { ref: "main" },
    },
    ...overrides,
  };
}
const message = interpretEvent("pull_request_target", event())!;
const env = {
  DISCORD_BOT_TOKEN: "test-secret",
  DISCORD_CHANNEL_ID: "1559310191185629215",
  GITHUB_RUN_ID: "123",
};

describe("Interpretación de eventos", () => {
  test("menciona únicamente al revisor y conserva el enlace", () => {
    expect(message.content).toContain(
      "nunezpinillalucas435-dev solicitó una revisión a <@262014594158034954>",
    );
    expect(message.content).toContain(event().pull_request!.html_url);
    expect(message.allowed_mentions).toEqual({
      parse: [],
      users: [users.Juanfra272],
      roles: [],
      replied_user: false,
    });
  });
  test("busca usuarios sin distinguir mayúsculas", () => {
    expect(
      interpretEvent("pull_request_target", event({ requested_reviewer: { login: "juanfra272" } }))!
        .allowed_mentions.users,
    ).toEqual([users.Juanfra272]);
  });
  test("usuario desconocido se muestra sin mención y genera advertencia", () => {
    const warnings: string[] = [];
    const result = interpretEvent(
      "pull_request_target",
      event({ requested_reviewer: { login: "unknown-user" } }),
      (text) => warnings.push(text),
    )!;
    expect(result.content).toContain("unknown-user");
    expect(result.allowed_mentions.users).toEqual([]);
    expect(warnings).toHaveLength(1);
  });
  test("cada evento de múltiples revisores menciona solo su destinatario", () => {
    for (const login of ["Juanfra272", "vcntttt", "FernandoValdes01"]) {
      const result = interpretEvent(
        "pull_request_target",
        event({ requested_reviewer: { login } }),
      )!;
      expect(result.allowed_mentions.users).toHaveLength(1);
      expect(result.content.match(/<@\d+>/g)).toHaveLength(1);
    }
  });
  test("ignora equipos sin destinatario individual", () => {
    expect(
      interpretEvent(
        "pull_request_target",
        event({ requested_reviewer: undefined, requested_team: { name: "TI4" } }),
      ),
    ).toBeNull();
  });
  test("cambios solicitados mencionan al autor y muestran al revisor", () => {
    const result = interpretEvent(
      "pull_request_review",
      event({
        action: "submitted",
        review: { state: "changes_requested", user: { login: "vcntttt" } },
      }),
    )!;
    expect(result.content).toContain("vcntttt solicitó cambios a <@262014594158034954>");
    expect(result.allowed_mentions.users).toEqual([users.Juanfra272]);
  });
  test("ignora bots y Greptile", () => {
    for (const user of [
      { login: "robot", type: "Bot" },
      { login: "other[bot]" },
      { login: "greptile-apps" },
    ]) {
      expect(
        interpretEvent(
          "pull_request_review",
          event({ action: "submitted", review: { state: "changes_requested", user } }),
        ),
      ).toBeNull();
    }
  });
  test("ignora aprobaciones, comentarios y revisiones editadas", () => {
    for (const state of ["approved", "commented"]) {
      expect(
        interpretEvent(
          "pull_request_review",
          event({ action: "submitted", review: { state, user: { login: "vcntttt" } } }),
        ),
      ).toBeNull();
    }
    expect(
      interpretEvent(
        "pull_request_review",
        event({
          action: "edited",
          review: { state: "changes_requested", user: { login: "vcntttt" } },
        }),
      ),
    ).toBeNull();
  });
  test("merge a main permite everyone y muestra quién fusionó", () => {
    const result = interpretEvent(
      "pull_request_target",
      event({
        action: "closed",
        pull_request: { ...event().pull_request!, merged: true, merged_by: { login: "vcntttt" } },
      }),
    )!;
    expect(result.content).toContain("@everyone vcntttt fusionó la PR #92 a main");
    expect(result.allowed_mentions).toEqual({
      parse: ["everyone"],
      users: [],
      roles: [],
      replied_user: false,
    });
  });
  test("ignora cierre sin merge, otras ramas y push", () => {
    for (const pr of [
      { ...event().pull_request!, merged: false },
      { ...event().pull_request!, merged: true, base: { ref: "develop" } },
    ]) {
      expect(
        interpretEvent("pull_request_target", event({ action: "closed", pull_request: pr })),
      ).toBeNull();
    }
    expect(interpretEvent("push", event())).toBeNull();
  });
  test("escapa menciones y Markdown incluso cuando everyone está permitido", () => {
    const login = "@everyone <@123> <@&456> [fake](https://example.com) **name**";
    const result = interpretEvent(
      "pull_request_target",
      event({
        action: "closed",
        pull_request: { ...event().pull_request!, merged: true, merged_by: { login } },
      }),
    )!;
    expect(result.content.match(/@everyone/g)).toHaveLength(1);
    expect(result.content).not.toContain("<@123>");
    expect(result.content).not.toContain("<@&456>");
    expect(result.content).toContain("\\[fake\\]");
    const unknown = interpretEvent(
      "pull_request_target",
      event({ requested_reviewer: { login } }),
      () => {},
    )!;
    expect(unknown.allowed_mentions.users).toEqual([]);
    expect(unknown.content).not.toContain("@everyone");
  });
  test("rechaza enlaces manipulados y números inválidos", () => {
    for (const pr of [
      { ...event().pull_request!, html_url: "https://evil.example/@everyone" },
      { ...event().pull_request!, number: NaN },
    ]) {
      expect(() => interpretEvent("pull_request_target", event({ pull_request: pr }))).toThrow(
        "inválido",
      );
    }
  });
});

describe("Publicación REST", () => {
  test("envía token de bot, canal, menciones y nonce estable", async () => {
    let called = false;
    const dependencies = {
      fetch: (async (url, init) => {
        called = true;
        expect(url).toBe("https://discord.com/api/v10/channels/1559310191185629215/messages");
        expect(init!.headers).toEqual({
          Authorization: "Bot test-secret",
          "Content-Type": "application/json",
        });
        expect(JSON.parse(init!.body as string)).toEqual({
          ...message,
          nonce: "123",
          enforce_nonce: true,
        });
        expect(init!.redirect).toBe("error");
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
      sleep: async () => {},
    };
    await publishMessage(message, env, dependencies);
    expect(called).toBe(true);
  });
  test("rechaza configuración ausente o canal inválido antes de fetch", async () => {
    for (const config of [
      {},
      { DISCORD_BOT_TOKEN: "token" },
      { ...env, DISCORD_CHANNEL_ID: "../other" },
      { ...env, DISCORD_BOT_TOKEN: " " },
    ]) {
      await expect(publishMessage(message, config)).rejects.toThrow("Falta");
    }
  });
  test("HTTP 400, 401 y 403 no se vuelven a intentar ni exponen el cuerpo", async () => {
    for (const status of [400, 401, 403]) {
      let calls = 0;
      await expect(
        publishMessage(message, env, {
          fetch: (async (_url: RequestInfo | URL, _init?: RequestInit) => {
            calls++;
            return new Response(env.DISCORD_BOT_TOKEN, { status });
          }) as typeof fetch,
          sleep: async () => {},
        }),
      ).rejects.toThrow(`HTTP ${status}`);
      expect(calls).toBe(1);
    }
  });
  test("429 respeta retry_after y reutiliza nonce", async () => {
    const bodies: unknown[] = [];
    const waits: number[] = [];
    await publishMessage(message, env, {
      fetch: (async (_url, init) => {
        bodies.push(init!.body);
        return bodies.length === 1
          ? new Response('{"retry_after":0.25}', { status: 429 })
          : new Response("{}");
      }) as typeof fetch,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(waits).toEqual([250]);
    expect(bodies[0]).toBe(bodies[1]);
  });
  test("limita reintentos para 429 y 5xx", async () => {
    for (const status of [429, 500]) {
      let calls = 0;
      await expect(
        publishMessage(message, env, {
          fetch: (async (_url: RequestInfo | URL, _init?: RequestInit) => {
            calls++;
            return new Response('{"retry_after":0}', { status });
          }) as typeof fetch,
          sleep: async () => {},
        }),
      ).rejects.toThrow(`HTTP ${status}`);
      expect(calls).toBe(3);
    }
  });
  test("rechaza esperas inválidas y excesivas", async () => {
    for (const retry_after of [-1, 61, "1", null]) {
      await expect(
        publishMessage(message, env, {
          fetch: (async (_url: RequestInfo | URL, _init?: RequestInit) =>
            new Response(JSON.stringify({ retry_after }), { status: 429 })) as typeof fetch,
          sleep: async () => {
            throw new Error("No debe esperar");
          },
        }),
      ).rejects.toThrow("limitó la frecuencia");
    }
  });
  test("oculta errores de red que pueden contener credenciales", async () => {
    await expect(
      publishMessage(message, env, {
        fetch: (async (_url: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
          throw new Error(env.DISCORD_BOT_TOKEN);
        }) as typeof fetch,
        sleep: async () => {},
      }),
    ).rejects.toThrow("No se pudo contactar con Discord");
  });
});

describe("Ejecución", () => {
  test("simulación sin credenciales usa el evento y no publica", async () => {
    const child = Bun.spawn([process.execPath, `${import.meta.dir}/notify.ts`, "--dry-run"], {
      env: {
        GITHUB_EVENT_NAME: "pull_request_target",
        GITHUB_EVENT_PATH: `${import.meta.dir}/review-requested.json`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    expect(JSON.parse(output)).toEqual(message);
  });
  test("configuración de evento ausente falla", async () => {
    await expect(run({}, true)).rejects.toThrow("Faltan GITHUB_EVENT_PATH");
  });
  test("un push a main no publica ni necesita credenciales de Discord", async () => {
    await run(
      {
        GITHUB_EVENT_NAME: "push",
        GITHUB_EVENT_PATH: `${import.meta.dir}/review-requested.json`,
      },
      false,
    );
  });
  test("workflow solo usa los eventos pedidos y código de main", async () => {
    const yaml = await Bun.file(`${import.meta.dir}/../workflows/discord-notifications.yml`).text();
    expect(yaml).toContain("types: [review_requested, closed]");
    expect(yaml).toContain("types: [submitted]");
    expect(yaml).toContain("ref: refs/heads/main");
    expect(yaml).toContain("persist-credentials: false");
    expect(yaml).not.toContain("bun install");
    expect(yaml).not.toContain("pull_request.head.sha");
    expect(yaml).toContain("workflow_dispatch:");
    expect(yaml).toContain('cron: "3-59/5 * * * *"');
    expect(yaml).not.toContain("push:");
    expect(yaml).toContain("contents: read");
  });
});

test("condición de Actions filtra bots, forks y cierres sin merge", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(`${import.meta.dir}/../workflows/discord-notifications.yml`).text(),
  ) as {
    on: Record<string, unknown>;
    jobs: { notify: { if: string } };
  };
  expect(Object.keys(workflow.on).sort()).toEqual([
    "pull_request_review",
    "pull_request_target",
    "schedule",
    "workflow_dispatch",
  ]);
  const evaluate = new Function("github", `return (${workflow.jobs.notify.if});`);
  const context = (eventName: string, payload: GitHubEvent, fork = false) => ({
    event_name: eventName,
    repository: "FernandoValdes01/ceretime",
    event: {
      ...payload,
      pull_request: {
        ...payload.pull_request,
        head: { repo: { full_name: fork ? "someone/fork" : "FernandoValdes01/ceretime" } },
      },
    },
  });
  expect(evaluate(context("schedule", {}))).toBeTruthy();
  expect(evaluate(context("workflow_dispatch", {}))).toBeTruthy();
  expect(evaluate(context("push", {}))).toBeFalsy();
  expect(workflow.jobs.notify.if).not.toContain("github.event_name == 'push'");
  expect(evaluate(context("pull_request_target", event(), true))).toBeTruthy();
  expect(
    evaluate(context("pull_request_target", event({ requested_reviewer: undefined }))),
  ).toBeFalsy();
  const review = event({
    action: "submitted",
    review: { state: "changes_requested", user: { login: "vcntttt", type: "User" } },
  });
  expect(evaluate(context("pull_request_review", review))).toBeTruthy();
  expect(evaluate(context("pull_request_review", review, true))).toBeFalsy();
  expect(
    evaluate(
      context("pull_request_review", {
        ...review,
        review: { state: "changes_requested", user: { login: "robot", type: "Bot" } },
      }),
    ),
  ).toBeFalsy();
  expect(
    evaluate(
      context("pull_request_review", {
        ...review,
        review: { state: "approved", user: { login: "vcntttt" } },
      }),
    ),
  ).toBeFalsy();
  for (const merged of [false, true]) {
    const merge = event({ action: "closed", pull_request: { ...event().pull_request!, merged } });
    expect(Boolean(evaluate(context("pull_request_target", merge)))).toBe(merged);
    expect(
      evaluate(
        context("pull_request_target", {
          ...merge,
          pull_request: { ...merge.pull_request!, base: { ref: "develop" } },
        }),
      ),
    ).toBeFalsy();
  }
});
