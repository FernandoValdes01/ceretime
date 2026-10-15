import { expect, test } from "bun:test";
import { interpretEvent, type GitHubEvent, type Message } from "./events";
import { notifyEvents, type TimelineEvent } from "./recovery";

const now = Date.parse("2026-10-14T22:00:00Z");
const env = {
  GITHUB_TOKEN: "github-secret",
  DISCORD_BOT_TOKEN: "discord-secret",
  DISCORD_CHANNEL_ID: "1559310191185629215",
};
const pr = {
  number: 111,
  html_url: "https://github.com/FernandoValdes01/ceretime/pull/111",
  user: { login: "RallenCastro" },
  base: { ref: "main" },
  updated_at: "2026-10-14T21:36:14Z",
  state: "open",
  closed_at: null as string | null,
  mergeable: false,
};
const review = {
  id: 5524984043,
  state: "CHANGES_REQUESTED",
  user: { login: "vcntttt", type: "User" },
  submitted_at: "2026-10-14T21:36:14Z",
};
const event: GitHubEvent = { action: "submitted", pull_request: pr, review };
const reviewUrl = `${pr.html_url}#pullrequestreview-${review.id}`;

function harness() {
  const messages: { id: string; content: string; timestamp: string; author: { id: string } }[] = [];
  const sent: Message[] = [];
  const requests: string[] = [];
  let reviews = [review];
  let prs = [pr];
  let timeline: TimelineEvent[] | undefined;
  const fetcher = (async (input, init) => {
    const url = String(input);
    requests.push(url);
    const headers = init!.headers as Record<string, string>;
    expect(init!.redirect).toBe("error");
    if (url.startsWith("https://api.github.com/")) {
      expect(headers.Authorization).toBe("Bearer github-secret");
      if (url.includes("/timeline?"))
        return Response.json(timeline ?? reviews.map((value) => ({ ...value, event: "reviewed" })));
      expect(url).toContain("state=all");
      return Response.json(prs);
    }
    expect(headers.Authorization).toBe("Bot discord-secret");
    if (url.endsWith("/users/@me")) return Response.json({ id: "1559310191185629000" });
    if (url.endsWith(`/channels/${env.DISCORD_CHANNEL_ID}`))
      return Response.json({ last_message_id: messages.at(-1)?.id ?? null });
    if (url.includes("/messages?")) return Response.json(messages);
    return Response.json(messages.at(-1) ?? {});
  }) as typeof fetch;
  const dependencies = {
    now: () => now,
    fetch: fetcher,
    publish: async (message: Message, deliveryEnv: Record<string, string | undefined>) => {
      expect(deliveryEnv.GITHUB_RUN_ID).toMatch(/^(review|request|merge)-[0-9]+$/);
      expect(deliveryEnv.GITHUB_RUN_ID!.length).toBeLessThanOrEqual(25);
      sent.push(message);
      messages.push({
        id: "1559310191185629216",
        content: message.content,
        timestamp: new Date(now).toISOString(),
        author: { id: "1559310191185629000" },
      });
    },
  };
  return {
    messages,
    sent,
    requests,
    dependencies,
    setReviews: (value: typeof reviews) => {
      reviews = value;
    },
    setTimeline: (value: TimelineEvent[]) => {
      timeline = value;
    },
    setPrs: (value: typeof prs) => {
      prs = value;
    },
  };
}

test("recupera la solicitud real de la PR #111 sin evento y con conflictos", async () => {
  const h = harness();
  await notifyEvents(env, undefined, h.dependencies);
  expect(h.sent).toHaveLength(1);
  expect(h.sent[0]!.content).toContain(reviewUrl);
  expect(h.sent[0]!.allowed_mentions.users).toEqual(["905194636790882385"]);
  expect(h.requests.some((url) => url.includes("/merge"))).toBe(false);
});

test("evento inmediato y dos recuperaciones envían una sola notificación", async () => {
  const h = harness();
  await notifyEvents(env, event, h.dependencies);
  await notifyEvents(env, undefined, h.dependencies);
  await notifyEvents(env, undefined, h.dependencies);
  expect(h.sent).toHaveLength(1);
});

test("un mensaje humano copiado no impide la notificación del bot", async () => {
  const h = harness();
  h.messages.push({
    id: "1559310191185629216",
    content: reviewUrl,
    timestamp: new Date(now).toISOString(),
    author: { id: "human" },
  });
  await notifyEvents(env, event, h.dependencies);
  expect(h.sent).toHaveLength(1);
});

test("reconoce avisos antiguos y permite otra revisión posterior de la misma PR", async () => {
  const h = harness();
  h.messages.push({
    id: "1559310191185629216",
    content: interpretEvent("pull_request_review", event)!.content,
    timestamp: "2026-10-14T21:36:20Z",
    author: { id: "1559310191185629000" },
  });
  await notifyEvents(env, event, h.dependencies);
  expect(h.sent).toHaveLength(0);
  await notifyEvents(
    env,
    {
      ...event,
      review: { ...review, id: review.id + 1, submitted_at: "2026-10-14T21:40:00Z" },
    } as GitHubEvent,
    h.dependencies,
  );
  expect(h.sent).toHaveLength(1);
});

test("recupera revisiones aunque updated_at sea antiguo o la PR se haya cerrado después", async () => {
  for (const value of [
    { ...pr, updated_at: "2026-10-01T00:00:00Z" },
    { ...pr, state: "closed", closed_at: "2026-10-14T21:40:00Z" },
  ]) {
    const h = harness();
    h.setPrs([value]);
    await notifyEvents(env, undefined, h.dependencies);
    expect(h.sent).toHaveLength(1);
  }
});

test("recorre varias páginas de PR y revisiones", async () => {
  const h = harness();
  const original = h.dependencies.fetch;
  h.dependencies.fetch = (async (input, init) => {
    const url = String(input);
    if (url.includes("/pulls?")) {
      if (url.endsWith("page=1"))
        return Response.json(
          Array.from({ length: 100 }, () => ({
            ...pr,
            state: "closed",
            closed_at: "2026-10-01T00:00:00Z",
          })),
        );
      return Response.json([pr]);
    }
    if (url.includes("/timeline?") && url.endsWith("page=1"))
      return Response.json(
        Array.from({ length: 100 }, () => ({ ...review, event: "reviewed", state: "COMMENTED" })),
      );
    return original(input, init);
  }) as typeof fetch;
  await notifyEvents(env, undefined, h.dependencies);
  expect(h.sent).toHaveLength(1);
  expect(h.requests.some((url) => url.includes("/timeline?") && url.endsWith("page=2"))).toBe(true);
});

test("busca mensajes previos después de la primera página del historial", async () => {
  const h = harness();
  const original = h.dependencies.fetch;
  h.dependencies.fetch = (async (input, init) => {
    const url = String(input);
    if (url.includes("/messages?")) {
      if (!url.includes("before="))
        return Response.json(
          Array.from({ length: 100 }, () => ({
            id: "1559310191185629216",
            content: "other",
            timestamp: new Date(now).toISOString(),
            author: { id: "human" },
          })),
        );
      return Response.json([
        {
          id: "1559310191185629215",
          content: reviewUrl,
          timestamp: new Date(now).toISOString(),
          author: { id: "1559310191185629000" },
        },
      ]);
    }
    return original(input, init);
  }) as typeof fetch;
  await notifyEvents(env, undefined, h.dependencies);
  expect(h.sent).toHaveLength(0);
});

test("omite bots y revisiones anteriores al inicio de recuperación", async () => {
  for (const reviews of [
    [{ ...review, user: { login: "robot", type: "Bot" } }],
    [{ ...review, submitted_at: "2026-10-01T00:00:00Z" }],
  ]) {
    const h = harness();
    h.setReviews(reviews);
    await notifyEvents(env, undefined, h.dependencies);
    expect(h.sent).toHaveLength(0);
  }
});

test("un comentario posterior conserva la solicitud de cambios", async () => {
  const h = harness();
  h.setReviews([review, { ...review, id: review.id + 1, state: "COMMENTED" }]);
  await notifyEvents(env, undefined, h.dependencies);
  expect(h.sent).toHaveLength(1);
});

test("una aprobación posterior no borra el aviso de cambios omitido", async () => {
  const h = harness();
  h.setReviews([review, { ...review, id: review.id + 1, state: "APPROVED" }]);
  await notifyEvents(env, undefined, h.dependencies);
  expect(h.sent).toHaveLength(1);
});

test("sin permiso para leer mensajes falla antes de publicar", async () => {
  const h = harness();
  h.messages.push({
    id: "1559310191185629216",
    content: "previous",
    timestamp: new Date(now).toISOString(),
    author: { id: "1559310191185629000" },
  });
  const original = h.dependencies.fetch;
  h.dependencies.fetch = (async (input, init) =>
    String(input).includes("/messages/155")
      ? new Response("discord-secret", { status: 403 })
      : original(input, init)) as typeof fetch;
  await expect(notifyEvents(env, undefined, h.dependencies)).rejects.toThrow("HTTP 403");
  expect(h.sent).toHaveLength(0);
});

test("un fallo de publicación se recupera en la siguiente consulta", async () => {
  const h = harness();
  const original = h.dependencies.publish;
  h.dependencies.publish = async () => {
    throw new Error("Discord respondió HTTP 500.");
  };
  await expect(notifyEvents(env, undefined, h.dependencies)).rejects.toThrow("HTTP 500");
  h.dependencies.publish = original;
  await notifyEvents(env, undefined, h.dependencies);
  expect(h.sent).toHaveLength(1);
});

const request = (
  id: number,
  login = "Juanfra272",
  created_at = "2026-10-14T21:35:00Z",
): TimelineEvent => ({
  event: "review_requested",
  id,
  created_at,
  actor: { login: "RallenCastro" },
  requested_reviewer: { login },
});
const change: TimelineEvent = { ...review, event: "reviewed" };
const merge: TimelineEvent = {
  event: "merged",
  id: 33269456706,
  created_at: "2026-10-14T21:40:00Z",
  actor: { login: "Juanfra272" },
};

test("recupera los tres avisos omitidos y cada destinatario una sola vez", async () => {
  const h = harness();
  h.setTimeline([request(33264777030), request(33264777031, "vcntttt"), change, merge]);
  await notifyEvents(env, undefined, h.dependencies);
  expect(h.sent).toHaveLength(4);
  expect(h.sent[0]!.allowed_mentions.users).toEqual(["262014594158034954"]);
  expect(h.sent[1]!.allowed_mentions.users).toEqual(["359799491022553111"]);
  expect(h.sent[3]!.allowed_mentions.parse).toEqual(["everyone"]);
  await notifyEvents(env, undefined, h.dependencies);
  expect(h.sent).toHaveLength(4);
});

test("una solicitud inmediata y un merge inmediato no se repiten al recuperar", async () => {
  for (const payload of [
    { action: "review_requested", pull_request: pr, requested_reviewer: { login: "Juanfra272" } },
    { action: "closed", pull_request: { ...pr, merged: true, merged_by: { login: "Juanfra272" } } },
  ]) {
    const h = harness();
    h.setTimeline([request(33264777030), merge]);
    await notifyEvents(env, payload, h.dependencies);
    await notifyEvents(env, undefined, h.dependencies);
    expect(h.sent).toHaveLength(2);
  }
});

test("retirar y volver a solicitar revisión conserva dos eventos distintos", async () => {
  const h = harness();
  h.setTimeline([
    request(33264777030),
    { event: "review_request_removed", id: 33264777031, created_at: "2026-10-14T21:36:00Z" },
    request(33264777032, "Juanfra272", "2026-10-14T21:37:00Z"),
  ]);
  await notifyEvents(env, undefined, h.dependencies);
  await notifyEvents(env, undefined, h.dependencies);
  expect(h.sent).toHaveLength(2);
  expect(h.sent[0]!.content).toContain("#event-33264777030");
  expect(h.sent[1]!.content).toContain("#event-33264777032");
});

test("un aviso antiguo no representa dos solicitudes distintas a la misma persona", async () => {
  const h = harness();
  const payload = {
    action: "review_requested",
    pull_request: pr,
    sender: { login: "RallenCastro" },
    requested_reviewer: { login: "Juanfra272" },
  };
  h.messages.push({
    id: "1559310191185629216",
    content: interpretEvent("pull_request_target", payload)!.content,
    timestamp: "2026-10-14T21:35:10Z",
    author: { id: "1559310191185629000" },
  });
  h.setTimeline([request(33264777030), request(33264777032, "Juanfra272", "2026-10-14T21:37:00Z")]);
  await notifyEvents(env, undefined, h.dependencies);
  expect(h.sent).toHaveLength(1);
  expect(h.sent[0]!.content).toContain("#event-33264777032");
});

test("el inicio es medianoche de Chile y no caduca después de siete días", async () => {
  const h = harness();
  h.setTimeline([
    request(33264777030, "Juanfra272", "2026-10-14T02:59:59Z"),
    request(33264777031, "Juanfra272", "2026-10-14T03:00:00Z"),
  ]);
  h.dependencies.now = () => Date.parse("2026-10-25T22:00:00Z");
  await notifyEvents(env, undefined, h.dependencies);
  expect(h.sent).toHaveLength(1);
  expect(h.sent[0]!.content).toContain("#event-33264777031");
});

test("una revisión descartada recupera la solicitud original de cambios", async () => {
  const h = harness();
  h.setTimeline([
    { ...change, state: "dismissed" },
    {
      event: "review_dismissed",
      id: 33264777033,
      created_at: "2026-10-14T21:39:00Z",
      dismissed_review: { review_id: review.id, state: "changes_requested" },
    },
  ]);
  await notifyEvents(env, undefined, h.dependencies);
  expect(h.sent).toHaveLength(1);
  expect(h.sent[0]!.content).toContain(reviewUrl);
});

test("omite equipos, comentarios, bots, cierres sin merge y merges a otra rama", async () => {
  const h = harness();
  h.setPrs([{ ...pr, base: { ref: "develop" } }]);
  h.setTimeline([
    { ...request(33264777030), requested_reviewer: undefined },
    { ...change, state: "commented" },
    { ...change, user: { login: "greptile-apps", type: "Bot" } },
    { ...merge, event: "closed" },
    merge,
  ]);
  await notifyEvents(env, undefined, h.dependencies);
  expect(h.sent).toHaveLength(0);
});

test("borrar el último mensaje no bloquea la lectura del historial restante", async () => {
  const h = harness();
  h.messages.push({
    id: "1559310191185629216",
    content: "existing",
    timestamp: new Date(now).toISOString(),
    author: { id: "human" },
  });
  const original = h.dependencies.fetch;
  h.dependencies.fetch = (async (input, init) => {
    const url = String(input);
    if (url.endsWith(`/channels/${env.DISCORD_CHANNEL_ID}`))
      return Response.json({ last_message_id: "1559310191185629999" });
    if (url.endsWith("/messages/1559310191185629999")) return new Response("", { status: 404 });
    return original(input, init);
  }) as typeof fetch;
  await notifyEvents(env, undefined, h.dependencies);
  expect(h.sent).toHaveLength(1);
});

test("un fallo parcial no bloquea los avisos posteriores", async () => {
  const h = harness();
  h.setTimeline([request(33264777030), change, merge]);
  const original = h.dependencies.publish;
  h.dependencies.publish = async (message, deliveryEnv) => {
    if (deliveryEnv.GITHUB_RUN_ID === "request-33264777030")
      throw new Error("Discord respondió HTTP 500.");
    await original(message, deliveryEnv);
  };
  await expect(notifyEvents(env, undefined, h.dependencies)).rejects.toThrow("HTTP 500");
  expect(h.sent).toHaveLength(2);
  h.dependencies.publish = original;
  await notifyEvents(env, undefined, h.dependencies);
  expect(h.sent).toHaveLength(3);
});

test("Discord acepta el mensaje y pierde la respuesta: el sondeo no lo duplica", async () => {
  const h = harness();
  const original = h.dependencies.publish;
  h.dependencies.publish = async (message, deliveryEnv) => {
    await original(message, deliveryEnv);
    throw new Error("No se pudo contactar con Discord.");
  };
  await expect(notifyEvents(env, undefined, h.dependencies)).rejects.toThrow(
    "No se pudo contactar",
  );
  h.dependencies.publish = original;
  await notifyEvents(env, undefined, h.dependencies);
  expect(h.sent).toHaveLength(1);
});

test("si GitHub limita la consulta no publica a ciegas y recupera después", async () => {
  const h = harness();
  const original = h.dependencies.fetch;
  h.dependencies.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response("github-secret", { status: 429 })) as typeof fetch;
  await expect(notifyEvents(env, undefined, h.dependencies)).rejects.toThrow("HTTP 429");
  expect(h.sent).toHaveLength(0);
  h.dependencies.fetch = original;
  await notifyEvents(env, undefined, h.dependencies);
  expect(h.sent).toHaveLength(1);
});

test("una ejecución inmediata cancelada se recupera íntegra en el sondeo", async () => {
  const h = harness();
  h.setTimeline([request(33264777030), change, merge]);
  await notifyEvents(env, event, h.dependencies);
  // The request and merge trigger never execute, as with replaced pending runs.
  await notifyEvents(env, undefined, h.dependencies);
  expect(h.sent).toHaveLength(3);
});

test("simulación de recuperación solo lee GitHub y nunca requiere Discord", async () => {
  const h = harness();
  await notifyEvents({ GITHUB_TOKEN: env.GITHUB_TOKEN }, undefined, h.dependencies, true);
  expect(h.sent).toHaveLength(0);
  expect(h.requests.every((url) => url.startsWith("https://api.github.com/"))).toBe(true);
});

test("primera activación: doce avisos antiguos y uno pendiente producen solo un mensaje", async () => {
  const h = harness();
  const requests = Array.from({ length: 10 }, (_, index) =>
    request(
      33260000000 + index,
      "Juanfra272",
      new Date(now - 60 * 60 * 1000 + index * 60_000).toISOString(),
    ),
  );
  const earlierChange: TimelineEvent = {
    ...change,
    id: review.id - 1,
    submitted_at: "2026-10-14T21:33:00Z",
  };
  const delivered = [...requests, earlierChange, merge];
  for (const [index, item] of delivered.entries()) {
    const payload: GitHubEvent =
      item.event === "reviewed"
        ? {
            action: "submitted",
            pull_request: pr,
            review: { state: item.state!, user: item.user! },
          }
        : item.event === "merged"
          ? { action: "closed", pull_request: { ...pr, merged: true, merged_by: item.actor } }
          : {
              action: "review_requested",
              pull_request: pr,
              sender: item.actor,
              requested_reviewer: item.requested_reviewer,
            };
    const legacy = interpretEvent(
      item.event === "reviewed" ? "pull_request_review" : "pull_request_target",
      payload,
    )!;
    h.messages.push({
      id: String(1559310191185629200n + BigInt(index)),
      content: legacy.content,
      timestamp: new Date(Date.parse(item.submitted_at ?? item.created_at!) + 1000).toISOString(),
      author: { id: "1559310191185629000" },
    });
  }
  h.messages.reverse();
  h.setTimeline([...delivered, change]);
  for (let poll = 0; poll < 5; poll++) await notifyEvents(env, undefined, h.dependencies);
  expect(h.sent).toHaveLength(1);
  expect(h.sent[0]!.content).toContain(reviewUrl);
  expect(h.sent[0]!.allowed_mentions.users).toEqual(["905194636790882385"]);
  expect(h.sent[0]!.allowed_mentions.parse).toEqual([]);
  expect(h.sent[0]!.content).not.toContain("@everyone");
});
