export type SpeechCommand = "open-requests" | "back" | "cancel";

export type ParsedSpeechCommand = { readonly type: SpeechCommand } | { readonly type: "unknown" };

const commands = new Map<string, SpeechCommand>([
  ["abrir solicitudes", "open-requests"],
  ["mis solicitudes", "open-requests"],
  ["ver solicitudes", "open-requests"],
  ["volver", "back"],
  ["regresar", "back"],
  ["cancelar", "cancel"],
]);

export function parseSpeechCommand(transcript: string): ParsedSpeechCommand {
  const normalized = transcript
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CL")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

  const type = commands.get(normalized);
  return type ? { type } : { type: "unknown" };
}
