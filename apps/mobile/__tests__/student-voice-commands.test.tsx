import path from "node:path";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import type { SpeechRecognitionResult } from "@/application/speech-port";

jest.mock("../src/composition/mobile-dependencies", () => {
  const actual = jest.requireActual("../src/composition/mobile-dependencies");
  const recognize = jest.fn();
  const stop = jest.fn().mockResolvedValue(undefined);
  return {
    ...actual,
    mobileDependencies: {
      ...actual.mobileDependencies,
      speechRecognitionPort: { recognize, stop },
    },
    __mockSpeech: { recognize, stop },
  };
});

const { __mockSpeech } = jest.requireMock("../src/composition/mobile-dependencies") as {
  readonly __mockSpeech: {
    readonly recognize: jest.Mock<Promise<SpeechRecognitionResult>, []>;
    readonly stop: jest.Mock<Promise<void>, []>;
  };
};

const appDirectory = path.resolve(__dirname, "../app");

async function enterStudent() {
  const navigation = renderRouter(appDirectory);
  fireEvent.press(await screen.findByRole("button", { name: "Entrar como Estudiante" }));
  await waitFor(() => expect(navigation.getPathname()).toBe("/estudiante"));
  return navigation;
}

async function useVoiceCommand(transcript: string) {
  __mockSpeech.recognize.mockResolvedValueOnce({ status: "recognized", transcript });
  fireEvent.press(screen.getByRole("button", { name: "Comandos de voz" }));
  await act(async () =>
    fireEvent.press(screen.getByRole("button", { name: "Usar comando de voz" })),
  );
}

test("abrir solicitudes y volver funcionan por voz desde una ruta normal", async () => {
  const navigation = await enterStudent();

  await useVoiceCommand("abrir solicitudes");
  await waitFor(() => expect(navigation.getPathname()).toBe("/estudiante/solicitudes"));
  expect(screen.queryByRole("button", { name: "Usar comando de voz" })).toBeNull();

  await useVoiceCommand("volver");
  await waitFor(() => expect(navigation.getPathname()).toBe("/estudiante"));
});

test("denegación y silencio conservan los tres controles táctiles", async () => {
  __mockSpeech.recognize.mockResolvedValueOnce({ status: "denied" });
  const navigation = await enterStudent();

  fireEvent.press(screen.getByRole("button", { name: "Comandos de voz" }));
  await act(async () =>
    fireEvent.press(screen.getByRole("button", { name: "Usar comando de voz" })),
  );
  expect(await screen.findByText(/No hay permiso para usar el micrófono/)).toBeOnTheScreen();
  for (const label of ["Abrir solicitudes", "Volver", "Cancelar"]) {
    expect(screen.getByRole("button", { name: label })).toBeEnabled();
  }

  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Cancelar" })));
  expect(screen.queryByRole("button", { name: "Usar comando de voz" })).toBeNull();

  fireEvent.press(screen.getByRole("button", { name: "Comandos de voz" }));
  fireEvent.press(screen.getByRole("button", { name: "Abrir solicitudes" }));
  await waitFor(() => expect(navigation.getPathname()).toBe("/estudiante/solicitudes"));
});
