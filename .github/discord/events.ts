import users from "./users.json";

interface User {
  login: string;
  type?: string;
}

export interface GitHubEvent {
  action?: string;
  sender?: User;
  requested_reviewer?: User;
  requested_team?: unknown;
  review?: { state: string; user: User };
  pull_request?: {
    number: number;
    html_url: string;
    user: User;
    merged?: boolean;
    merged_by?: User;
    base: { ref: string };
  };
}

export interface Message {
  content: string;
  allowed_mentions: { parse: string[]; users: string[]; roles: string[]; replied_user: false };
}

// Remove mention syntax and escape Discord Markdown in all untrusted names.
export function escapeName(value: string): string {
  return value
    .slice(0, 100)
    .replace(/[\r\n]/g, " ")
    .replace(/@/g, "＠")
    .replace(/</g, "＜")
    .replace(/>/g, "＞")
    .replace(/[\\`*_~|[\]()]/g, "\\$&");
}

export function interpretEvent(
  eventName: string,
  event: GitHubEvent,
  warn: (message: string) => void = console.warn,
): Message | null {
  const pr = event.pull_request;
  if (!pr) return null;
  let title: string;
  let text: string;
  const mentions: string[] = [];
  let everyone = false;
  function recipient(user: User): string {
    const entry = Object.entries(users).find(
      ([login]) => login.toLowerCase() === user.login.toLowerCase(),
    );
    if (!entry) {
      warn(`Usuario sin mapeo de Discord: ${escapeName(user.login)}`);
      return escapeName(user.login);
    }
    const id = entry[1];
    if (!/^\d{17,20}$/.test(id)) throw new Error("ID de Discord inválido en users.json.");
    if (!mentions.includes(id)) mentions.push(id);
    return `<@${id}>`;
  }
  if (eventName === "pull_request_target" && event.action === "review_requested") {
    // GitHub emits a separate event for each individual requested reviewer.
    if (!event.requested_reviewer) return null;
    title = "Revisión solicitada";
    text = `${escapeName(event.sender?.login ?? "Usuario desconocido")} solicitó una revisión a ${recipient(event.requested_reviewer)} en la PR #${pr.number}.`;
  } else if (eventName === "pull_request_review" && event.action === "submitted") {
    const review = event.review;
    if (!review || review.state.toLowerCase() !== "changes_requested") return null;
    if (
      review.user.type === "Bot" ||
      /\[bot\]$/i.test(review.user.login) ||
      /greptile/i.test(review.user.login)
    )
      return null;
    title = "Cambios solicitados";
    text = `${escapeName(review.user.login)} solicitó cambios a ${recipient(pr.user)} en la PR #${pr.number}.`;
  } else if (
    eventName === "pull_request_target" &&
    event.action === "closed" &&
    pr.merged === true &&
    pr.base.ref === "main"
  ) {
    if (!pr.merged_by) throw new Error("Falta el usuario que realizó el merge.");
    title = "PR fusionada a main";
    everyone = true;
    text = `@everyone ${escapeName(pr.merged_by.login)} fusionó la PR #${pr.number} a main. ¡Actualicen sus ramas y PRs para evitar conflictos!`;
  } else return null;

  // Only accept canonical repository PR URLs; no Markdown or mention injection via links.
  if (
    !Number.isSafeInteger(pr.number) ||
    pr.number < 1 ||
    pr.html_url !== `https://github.com/FernandoValdes01/ceretime/pull/${pr.number}`
  ) {
    throw new Error("Enlace o número de PR inválido.");
  }
  return {
    content: `**${title}**\n\n${text}\n\n${pr.html_url}`,
    allowed_mentions: {
      parse: everyone ? ["everyone"] : [],
      users: mentions,
      roles: [],
      replied_user: false,
    },
  };
}
