import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import * as NativeSpeech from "expo-speech";
import type { SpeechResult } from "@/application/speech-port";
import { createNativeSpeechAdapter } from "@/infrastructure/native-speech-adapter";
import { SpeechControls } from "@/presentation/accessibility/speech-controls";

jest.mock("expo-router", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    useFocusEffect: (effect: () => void | (() => void)) => React.useEffect(effect, [effect]),
  };
});

jest.mock("expo-speech", () => ({
  maxSpeechInputLength: 1000,
  getAvailableVoicesAsync: jest.fn(),
  speak: jest.fn(),
  stop: jest.fn(),
}));

const voices: NativeSpeech.Voice[] = [
  {
    identifier: "es-ES",
    language: "es-ES",
    name: "Español",
    quality: "Default" as NativeSpeech.Voice["quality"],
  },
  {
    identifier: "es-CL",
    language: "es-CL",
    name: "Español Chile",
    quality: "Default" as NativeSpeech.Voice["quality"],
  },
];

const testText = "El acompañamiento continúa mañana.";

describe("createNativeSpeechAdapter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(NativeSpeech.getAvailableVoicesAsync).mockResolvedValue(voices);
    jest.mocked(NativeSpeech.stop).mockResolvedValue(undefined);
  });

  it("uses an available Chilean Spanish voice and resolves after native completion", async () => {
    const port = createNativeSpeechAdapter();
    const result = port.speak(testText);

    await waitFor(() => expect(NativeSpeech.speak).toHaveBeenCalledTimes(1));
    expect(NativeSpeech.speak).toHaveBeenCalledWith(
      testText,
      expect.objectContaining({ language: "es-CL", voice: "es-CL" }),
    );
    const options = jest.mocked(NativeSpeech.speak).mock.calls[0][1];
    options?.onDone?.();
    await expect(result).resolves.toEqual({ status: "completed" });
  });

  it("reports when no voice for the requested locale is available without starting speech", async () => {
    jest.mocked(NativeSpeech.getAvailableVoicesAsync).mockResolvedValue([
      {
        identifier: "en-US",
        language: "en-US",
        name: "English",
        quality: "Default" as NativeSpeech.Voice["quality"],
      },
    ]);
    const port = createNativeSpeechAdapter();

    await expect(port.speak(testText)).resolves.toEqual({
      status: "failed",
      reason: "locale-voice-unavailable",
    });
    expect(NativeSpeech.speak).not.toHaveBeenCalled();
  });

  it("rejects text beyond the platform limit before calling the native module", async () => {
    const port = createNativeSpeechAdapter();

    await expect(port.speak("x".repeat(NativeSpeech.maxSpeechInputLength + 1))).resolves.toEqual({
      status: "failed",
      reason: "text-too-long",
    });
    expect(NativeSpeech.getAvailableVoicesAsync).not.toHaveBeenCalled();
  });

  it("stops the current utterance and resolves it as stopped", async () => {
    const port = createNativeSpeechAdapter();
    const result = port.speak(testText);
    await waitFor(() => expect(NativeSpeech.speak).toHaveBeenCalledTimes(1));

    await port.stop();

    await expect(result).resolves.toEqual({ status: "stopped" });
    expect(NativeSpeech.stop).toHaveBeenCalledTimes(2);
  });

  it("does not start a stale read when a newer request arrives first", async () => {
    let resolveVoices: ((value: NativeSpeech.Voice[]) => void) | undefined;
    jest
      .mocked(NativeSpeech.getAvailableVoicesAsync)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveVoices = resolve)))
      .mockResolvedValueOnce(voices);
    const port = createNativeSpeechAdapter();
    const first = port.speak("Texto antiguo");
    const second = port.speak("Texto vigente");

    await waitFor(() => expect(NativeSpeech.speak).toHaveBeenCalledTimes(1));
    resolveVoices?.(voices);

    await expect(first).resolves.toEqual({ status: "stopped" });
    expect(NativeSpeech.speak).toHaveBeenCalledWith(
      "Texto vigente",
      expect.objectContaining({ language: "es-CL" }),
    );
    await port.stop();
    await expect(second).resolves.toEqual({ status: "stopped" });
  });

  it("turns native errors into a safe failure result", async () => {
    const port = createNativeSpeechAdapter();
    const result = port.speak(testText);
    await waitFor(() => expect(NativeSpeech.speak).toHaveBeenCalledTimes(1));
    jest.mocked(NativeSpeech.speak).mock.calls[0][1]?.onError?.(new Error("native detail"));

    await expect(result).resolves.toEqual({ status: "failed", reason: "speech-failed" });
  });
});

describe("SpeechControls", () => {
  let screenReaderChanged: ((enabled: boolean) => void) | undefined;

  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation((_event, listener) => {
      screenReaderChanged = listener as unknown as (enabled: boolean) => void;
      return {
        remove: jest.fn(),
      } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it("keeps speech off and the visible text available while a screen reader is active", async () => {
    const speechPort = { speak: jest.fn(), stop: jest.fn().mockResolvedValue(undefined) };
    const view = render(<SpeechControls speechPort={speechPort} text={testText} />);
    await waitFor(() =>
      expect(
        view.getByText("El lector de pantalla del sistema puede leer el texto visible."),
      ).toBeTruthy(),
    );
    act(() => screenReaderChanged?.(true));

    expect(view.getByRole("button", { name: "Leer en voz alta" })).toBeDisabled();
    expect(
      view.getByText("El lector de pantalla del sistema puede leer el texto visible."),
    ).toBeTruthy();
    fireEvent.press(view.getByRole("button", { name: "Leer en voz alta" }));
    expect(speechPort.speak).not.toHaveBeenCalled();
    expect(speechPort.stop).toHaveBeenCalled();
  });

  it("stops playback when the controls leave the focused route", async () => {
    const speechPort = { speak: jest.fn(), stop: jest.fn().mockResolvedValue(undefined) };
    const view = render(<SpeechControls speechPort={speechPort} text={testText} />);
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Leer en voz alta" })).toBeEnabled(),
    );

    fireEvent.press(view.getByRole("button", { name: "Leer en voz alta" }));
    await waitFor(() => expect(speechPort.speak).toHaveBeenCalledWith(testText));
    view.unmount();

    expect(speechPort.stop).toHaveBeenCalled();
  });

  it("lets the user stop an active read", async () => {
    const speechPort = {
      speak: jest.fn(() => new Promise<SpeechResult>(() => {})),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    const view = render(<SpeechControls speechPort={speechPort} text={testText} />);
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Leer en voz alta" })).toBeEnabled(),
    );

    fireEvent.press(view.getByRole("button", { name: "Leer en voz alta" }));
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Detener lectura" })).toBeEnabled(),
    );
    fireEvent.press(view.getByRole("button", { name: "Detener lectura" }));

    expect(speechPort.stop).toHaveBeenCalled();
    expect(view.getByRole("button", { name: "Leer en voz alta" })).toBeEnabled();
  });

  it("keeps the visible text available and explains native speech failures", async () => {
    const speechPort = {
      speak: jest.fn().mockResolvedValue({ status: "failed", reason: "locale-voice-unavailable" }),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    const view = render(<SpeechControls speechPort={speechPort} text={testText} />);
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Leer en voz alta" })).toBeEnabled(),
    );
    fireEvent.press(view.getByRole("button", { name: "Leer en voz alta" }));

    expect(
      await view.findByText(
        "No se pudo reproducir el audio. Revisa el texto en pantalla y vuelve a intentarlo.",
      ),
    ).toBeTruthy();
    expect(view.getByRole("button", { name: "Leer en voz alta" })).toBeEnabled();
  });
});
