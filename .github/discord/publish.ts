import type { Message } from "./events";

export async function publishMessage(
  message: Message,
  env: Record<string, string | undefined>,
  dependencies = { fetch: globalThis.fetch, sleep: (ms: number) => Bun.sleep(ms) },
): Promise<void> {
  const token = env.DISCORD_BOT_TOKEN?.trim();
  const channel = env.DISCORD_CHANNEL_ID?.trim();
  if (!token) throw new Error("Falta DISCORD_BOT_TOKEN.");
  if (!channel || !/^\d{17,20}$/.test(channel))
    throw new Error("Falta DISCORD_CHANNEL_ID o su formato es inválido.");
  // Discord deduplicates the same nonce for a few minutes, including retry attempts.
  const nonce = env.GITHUB_RUN_ID;
  const body = JSON.stringify({ ...message, ...(nonce ? { nonce, enforce_nonce: true } : {}) });
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await dependencies.fetch(
        `https://discord.com/api/v10/channels/${channel}/messages`,
        {
          method: "POST",
          headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(15_000),
          redirect: "error",
        },
      );
    } catch {
      // Never propagate fetch exceptions: they may contain request headers or the token.
      throw new Error(
        "No se pudo contactar con Discord; comprueba la red antes de repetir la ejecución.",
      );
    }
    if (response.ok) return;
    if (response.status === 429 && attempt < 2) {
      const data = (await response.json().catch(() => null)) as { retry_after?: unknown } | null;
      const seconds = data?.retry_after;
      if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0 || seconds > 60) {
        throw new Error("Discord limitó la frecuencia; espera y repite la ejecución.");
      }
      await dependencies.sleep(Math.ceil(seconds * 1000));
      continue;
    }
    if (response.status >= 500 && attempt < 2) {
      await dependencies.sleep(1000 * (attempt + 1));
      continue;
    }
    // Do not log response bodies, which can reflect untrusted data or credentials.
    throw new Error(
      `Discord respondió HTTP ${response.status}. Comprueba las credenciales, los permisos del bot o el estado de Discord.`,
    );
  }
}
