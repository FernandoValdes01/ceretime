import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type {
  SpeechRecognitionPort,
  SpeechRecognitionResult,
} from "../src/application/speech-port";
import { NativeSpeechProbe } from "../docs/evidence/ti4-56/native-probe";

let mockBlurCleanup: (() => void) | undefined;

jest.mock("expo-router", () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = jest.requireActual<typeof import("react")>("react");
    React.useEffect(() => {
      const cleanup = callback();
      let active = true;
      mockBlurCleanup = () => {
        if (!active) return;
        active = false;
        cleanup?.();
      };
      return () => mockBlurCleanup?.();
    }, [callback]);
  },
}));

describe("SpeechCommandProbe", () => {
  it.each([
    ["abrir solicitudes", "Comando reconocido: Abrir solicitudes."],
    ["volver", "Comando reconocido: Volver."],
    ["cancelar", "Comando reconocido: Cancelar."],
  ])("shows only the interpreted intent for %s", async (transcript, message) => {
    const recognitionPort: SpeechRecognitionPort = {
      recognize: jest.fn().mockResolvedValue({ status: "recognized", transcript }),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    const view = render(<NativeSpeechProbe recognitionPort={recognitionPort} />);

    fireEvent.press(view.getByRole("button", { name: "Probar comando de voz" }));
    await waitFor(() => expect(view.getByText(message, { exact: false })).toBeTruthy());
    expect(view.queryByText(transcript)).toBeNull();
  });

  it("shows unknown without invoking an action", async () => {
    const recognitionPort: SpeechRecognitionPort = {
      recognize: jest.fn().mockResolvedValue({
        status: "recognized",
        transcript: "quiero abrir solicitudes",
      }),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    const view = render(<NativeSpeechProbe recognitionPort={recognitionPort} />);

    fireEvent.press(view.getByRole("button", { name: "Probar comando de voz" }));
    await waitFor(() =>
      expect(view.getByText("Frase desconocida. No se realizará ninguna acción.")).toBeTruthy(),
    );
  });

  it("stops with a tactile control and ignores a late result", async () => {
    let finishRecognition!: (result: SpeechRecognitionResult) => void;
    const recognitionPort: SpeechRecognitionPort = {
      recognize: jest.fn(() => new Promise((resolve) => (finishRecognition = resolve))),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    const view = render(<NativeSpeechProbe recognitionPort={recognitionPort} />);

    fireEvent.press(view.getByRole("button", { name: "Probar comando de voz" }));
    fireEvent.press(await view.findByRole("button", { name: "Detener reconocimiento" }));
    finishRecognition({ status: "recognized", transcript: "cancelar" });

    await waitFor(() => expect(recognitionPort.stop).toHaveBeenCalledTimes(1));
    expect(view.queryByText(/Comando reconocido/)).toBeNull();
  });

  it("stops on unmount and ignores late results", async () => {
    let finishRecognition!: (result: SpeechRecognitionResult) => void;
    const recognitionPort: SpeechRecognitionPort = {
      recognize: jest.fn(() => new Promise((resolve) => (finishRecognition = resolve))),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    const view = render(<NativeSpeechProbe recognitionPort={recognitionPort} />);

    fireEvent.press(view.getByRole("button", { name: "Probar comando de voz" }));
    view.unmount();
    finishRecognition({ status: "recognized", transcript: "cancelar" });

    await waitFor(() => expect(recognitionPort.stop).toHaveBeenCalledTimes(1));
  });

  it("stops on blur and ignores late results", async () => {
    let finishRecognition!: (result: SpeechRecognitionResult) => void;
    const recognitionPort: SpeechRecognitionPort = {
      recognize: jest.fn(() => new Promise((resolve) => (finishRecognition = resolve))),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    const view = render(<NativeSpeechProbe recognitionPort={recognitionPort} />);

    fireEvent.press(view.getByRole("button", { name: "Probar comando de voz" }));
    await act(async () => {
      mockBlurCleanup?.();
      finishRecognition({ status: "recognized", transcript: "cancelar" });
    });

    await waitFor(() => expect(recognitionPort.stop).toHaveBeenCalledTimes(1));
    expect(view.queryByText(/Comando reconocido/)).toBeNull();
    view.unmount();
  });
});
