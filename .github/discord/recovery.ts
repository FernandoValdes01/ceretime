import { interpretEvent, type GitHubEvent } from "./events";
import { publishMessage } from "./publish";
import recovery from "./recovery-start.json";

type Env = Record<string, string | undefined>;
type PullRequest = NonNullable<GitHubEvent["pull_request"]> & {
  state: string;
  closed_at: string | null;
};
type User = NonNullable<GitHubEvent["sender"]>;
export interface TimelineEvent {
  event: string;
  id: number;
  created_at?: string;
  submitted_at?: string;
  state?: string;
  user?: User;
  actor?: User;
  requested_reviewer?: User;
  dismissed_review?: { review_id: number | string; state: string };
}
interface SentMessage {
  id: string;
  content: string;
  timestamp: string;
  author: { id: string };
}

const repository = "FernandoValdes01/ceretime";
const recoveryStart = Date.parse(recovery.since);

interface Candidate {
  key: string;
  url: string;
  occurredAt: number;
  message: NonNullable<ReturnType<typeof interpretEvent>>;
}

// Fixed API origins keep both credentials away from PR-controlled URLs.
async function read<T>(url: string, authorization: string, fetcher: typeof fetch): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { Authorization: authorization, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
  } catch {
    throw new Error("No se pudo consultar el historial de notificaciones.");
  }
  if (!response.ok) throw new Error(`No se pudo consultar el historial: HTTP ${response.status}.`);
  return response.json() as Promise<T>;
}

async function history(env: Env, since: number, fetcher: typeof fetch) {
  const token = env.DISCORD_BOT_TOKEN?.trim();
  const channel = env.DISCORD_CHANNEL_ID?.trim();
  if (!token) throw new Error("Falta DISCORD_BOT_TOKEN.");
  if (!channel || !/^\d{17,20}$/.test(channel)) throw new Error("Falta DISCORD_CHANNEL_ID válido.");
  const authorization = `Bot ${token}`;
  const origin = "https://discord.com/api/v10";
  const bot = await read<{ id: string }>(`${origin}/users/@me`, authorization, fetcher);
  const info = await read<{ last_message_id: string | null }>(
    `${origin}/channels/${channel}`,
    authorization,
    fetcher,
  );
  const messages: SentMessage[] = [];
  let before = "";
  while (true) {
    const page = await read<SentMessage[]>(
      `${origin}/channels/${channel}/messages?limit=100${before ? `&before=${before}` : ""}`,
      authorization,
      fetcher,
    );
    // A deleted last_message_id must not block a readable channel. Probe an
    // existing message instead; an empty list alone does not prove permission.
    if (!before && (page[0]?.id || info.last_message_id)) {
      await read(
        `${origin}/channels/${channel}/messages/${page[0]?.id ?? info.last_message_id}`,
        authorization,
        fetcher,
      );
    }
    messages.push(...page.filter((message) => message.author.id === bot.id));
    const last = page.at(-1);
    if (page.length < 100 || !last || Date.parse(last.timestamp) < since) break;
    if (!/^\d{17,20}$/.test(last.id) || before === last.id)
      throw new Error("No se pudo paginar el historial de Discord.");
    before = last.id;
  }
  return messages;
}

function candidate(pr: GitHubEvent["pull_request"], item: TimelineEvent): Candidate | null {
  if (!pr) return null;
  let event: GitHubEvent;
  let name: string;
  let key: string;
  let url: string;
  if (item.event === "reviewed") {
    if (!item.user || !item.state) return null;
    name = "pull_request_review";
    key = `review-${item.id}`;
    url = `${pr.html_url}#pullrequestreview-${item.id}`;
    event = {
      action: "submitted",
      pull_request: pr,
      review: { state: item.state, user: item.user },
    };
  } else if (item.event === "review_requested") {
    name = "pull_request_target";
    key = `request-${item.id}`;
    url = `${pr.html_url}#event-${item.id}`;
    event = {
      action: "review_requested",
      pull_request: pr,
      sender: item.actor,
      requested_reviewer: item.requested_reviewer,
    };
  } else if (item.event === "merged") {
    name = "pull_request_target";
    key = `merge-${pr.number}`;
    url = `${pr.html_url}#event-${item.id}`;
    event = { action: "closed", pull_request: { ...pr, merged: true, merged_by: item.actor } };
  } else return null;
  const message = interpretEvent(name, event);
  if (!message) return null;
  const occurredAt = Date.parse(item.submitted_at ?? item.created_at ?? "");
  if (!Number.isSafeInteger(item.id) || item.id < 1 || !Number.isFinite(occurredAt))
    throw new Error("No se pudo validar el evento de GitHub.");
  return { key, url, occurredAt, message };
}

export async function notifyEvents(
  env: Env,
  event?: GitHubEvent,
  dependencies = { fetch: globalThis.fetch, publish: publishMessage, now: () => Date.now() },
  dryRun = false,
) {
  if (!Number.isFinite(recoveryStart))
    throw new Error("No se pudo validar el inicio de recuperación.");
  const since = recoveryStart;
  const pending: Candidate[] = [];
  if (event?.review) {
    const review = event.review as NonNullable<GitHubEvent["review"]> & {
      id: number;
      submitted_at: string;
    };
    const value = candidate(event.pull_request, { ...review, event: "reviewed" });
    if (value && value.occurredAt >= since) pending.push(value);
  } else {
    const token = env.GITHUB_TOKEN?.trim();
    if (!token) throw new Error("Falta GITHUB_TOKEN.");
    const origin = `https://api.github.com/repos/${repository}`;
    for (let page = 1; ; page++) {
      const prs = event?.pull_request
        ? [event.pull_request as PullRequest]
        : await read<PullRequest[]>(
            `${origin}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`,
            `Bearer ${token}`,
            dependencies.fetch,
          );
      for (const pr of prs) {
        // Do not rely on updated_at changing when a review is submitted.
        if (!event && pr.state !== "open" && (!pr.closed_at || Date.parse(pr.closed_at) < since))
          continue;
        const timeline: TimelineEvent[] = [];
        for (let timelinePage = 1; ; timelinePage++) {
          const batch = await read<TimelineEvent[]>(
            `${origin}/issues/${pr.number}/timeline?per_page=100&page=${timelinePage}`,
            `Bearer ${token}`,
            dependencies.fetch,
          );
          timeline.push(...batch);
          if (batch.length < 100) break;
        }
        const dismissed = new Map(
          timeline
            .filter((item) => item.dismissed_review)
            .map((item) => [
              Number(item.dismissed_review!.review_id),
              item.dismissed_review!.state,
            ]),
        );
        for (const item of timeline) {
          const value = candidate(
            pr,
            item.state?.toLowerCase() === "dismissed" && dismissed.has(item.id)
              ? { ...item, state: dismissed.get(item.id) }
              : item,
          );
          if (value && value.occurredAt >= since && value.occurredAt <= dependencies.now())
            pending.push(value);
        }
      }
      if (event || prs.length < 100) break;
    }
  }
  pending.sort((a, b) => a.occurredAt - b.occurredAt || a.key.localeCompare(b.key));
  if (dryRun) {
    console.log(
      JSON.stringify(
        pending.map(({ key, occurredAt, message }) => ({
          key,
          occurredAt: new Date(occurredAt).toISOString(),
          ...message,
        })),
        null,
        2,
      ),
    );
    return;
  }
  if (!pending.length) return;
  const sent = await history(env, since, dependencies.fetch);
  const delivered = new Set<string>();
  for (const previous of sent) {
    const exact = pending.filter((value) => previous.content.split("\n").includes(value.url));
    if (exact.length) {
      exact.forEach((value) => delivered.add(value.key));
      continue;
    }
    // The old format has no event ID. Assign each old message to at most one
    // event, the nearest preceding match, so repeated requests remain distinct.
    const legacy = pending.findLast(
      (value) =>
        value.message.content === previous.content &&
        value.occurredAt <= Date.parse(previous.timestamp) &&
        !delivered.has(value.key),
    );
    if (legacy) delivered.add(legacy.key);
  }
  let failure: unknown;
  for (const value of pending) {
    if (delivered.has(value.key)) continue;
    const message = { ...value.message, content: `${value.message.content}\n${value.url}` };
    try {
      await dependencies.publish(message, { ...env, GITHUB_RUN_ID: value.key });
      delivered.add(value.key);
      console.log(`Notificación ${value.key} enviada a Discord.`);
    } catch (error) {
      failure ??= error;
      console.error(`No se pudo publicar la notificación ${value.key}; se volverá a intentar.`);
    }
  }
  if (failure) throw failure;
}
