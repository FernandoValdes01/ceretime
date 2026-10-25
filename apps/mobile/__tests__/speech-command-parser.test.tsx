import { parseSpeechCommand } from "../src/application/speech-command-parser";

describe("parseSpeechCommand", () => {
  it.each([
    ["abrir solicitudes", "open-requests"],
    ["  ABRIR   solicitudes. ", "open-requests"],
    ["mis solicitudes", "open-requests"],
    ["ver solicitudes", "open-requests"],
    ["volver", "back"],
    ["regresar", "back"],
    ["cancelar", "cancel"],
  ] as const)("recognizes %s", (transcript, type) => {
    expect(parseSpeechCommand(transcript)).toEqual({ type });
  });

  it.each(["", "solicitudes", "quiero abrir solicitudes", "no cancelar", "atrás", "constructor"])(
    "does not infer commands from %s",
    (transcript) => {
      expect(parseSpeechCommand(transcript)).toEqual({ type: "unknown" });
    },
  );
});
