import { interpretEvent } from "./events";
import { publishMessage } from "./publish";

export async function run(
  env = process.env,
  dryRun = process.argv.includes("--dry-run"),
): Promise<void> {
  if (!env.GITHUB_EVENT_PATH || !env.GITHUB_EVENT_NAME)
    throw new Error("Faltan GITHUB_EVENT_PATH o GITHUB_EVENT_NAME.");
  const event = await Bun.file(env.GITHUB_EVENT_PATH).json();
  const message = interpretEvent(env.GITHUB_EVENT_NAME, event);
  if (!message) {
    console.log("Evento omitido: no corresponde a una notificación.");
    return;
  }
  if (dryRun) {
    console.log(JSON.stringify(message, null, 2));
    return;
  }
  await publishMessage(message, env);
  console.log("Notificación enviada a Discord.");
}

if (import.meta.main) {
  try {
    await run();
  } catch (error) {
    // Only our own sanitized errors are logged; JSON/file errors may contain payload data.
    console.error(
      error instanceof Error &&
        /^(Falta|Enlace|ID de Discord|Discord|No se pudo)/.test(error.message)
        ? error.message
        : "No se pudo procesar el evento de GitHub.",
    );
    process.exitCode = 1;
  }
}
