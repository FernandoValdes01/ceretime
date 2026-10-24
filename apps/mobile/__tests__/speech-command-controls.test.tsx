import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { SpeechRecognitionPort, SpeechRecognitionResult } from "@/application/speech-port";
import { SpeechCommandControls } from "@/presentation/accessibility/speech-controls";

jest.mock("expo-router", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    useFocusEffect: (effect: () => void | (() => void)) => React.useEffect(effect, [effect]),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function setup(
  speechPort: SpeechRecognitionPort = {
    recognize: jest.fn().mockResolvedValue({ status: "silence" }),
    stop: jest.fn().mockResolvedValue(undefined),
  },
) {
  const onOpenRequests = jest.fn();
  const onBack = jest.fn();
  const onCancel = jest.fn();
  const view = render(
    <SpeechCommandControls
      speechPort={speechPort}
      onOpenRequests={onOpenRequests}
      onBack={onBack}
      onCancel={onCancel}
    />,
  );
  return { view, onOpenRequests, onBack, onCancel, speechPort };
}

describe("SpeechCommandControls", () => {
  it.each([
    ["abrir solicitudes", "onOpenRequests"],
    ["volver", "onBack"],
    ["cancelar", "onCancel"],
  ] as const)("maps the confirmed command %s to only %s", async (transcript, callback) => {
    const speechPort = {
      recognize: jest.fn().mockResolvedValue({ status: "recognized", transcript }),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    const result = setup(speechPort);

    await act(async () =>
      fireEvent.press(result.view.getByRole("button", { name: "Usar comando de voz" })),
    );

    expect(result[callback]).toHaveBeenCalledTimes(1);
    expect(
      (["onOpenRequests", "onBack", "onCancel"] as const).map(
        (name) => result[name].mock.calls.length,
      ),
    ).toEqual(
      (["onOpenRequests", "onBack", "onCancel"] as const).map((name) => Number(name === callback)),
    );
  });

  it.each<SpeechRecognitionResult>([
    { status: "silence" },
    { status: "denied" },
    { status: "unavailable" },
    { status: "failed" },
    { status: "recognized", transcript: "crear solicitud" },
  ])(
    "keeps all tactile controls enabled after recognition result %o",
    async (recognitionResult) => {
      const speechPort = {
        recognize: jest.fn().mockResolvedValue(recognitionResult),
        stop: jest.fn().mockResolvedValue(undefined),
      };
      const result = setup(speechPort);
      await act(async () =>
        fireEvent.press(result.view.getByRole("button", { name: "Usar comando de voz" })),
      );

      for (const label of ["Abrir solicitudes", "Volver", "Cancelar"]) {
        expect(result.view.getByRole("button", { name: label })).toBeEnabled();
        fireEvent.press(result.view.getByRole("button", { name: label }));
      }
      expect(result.onOpenRequests).toHaveBeenCalledTimes(1);
      expect(result.onBack).toHaveBeenCalledTimes(1);
      expect(result.onCancel).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps tactile navigation available while listening and invalidates a late transcript first", async () => {
    const recognition = deferred<SpeechRecognitionResult>();
    const stop = deferred<void>();
    const speechPort = {
      recognize: jest.fn(() => recognition.promise),
      stop: jest.fn(() => stop.promise),
    };
    const result = setup(speechPort);

    fireEvent.press(result.view.getByRole("button", { name: "Usar comando de voz" }));
    await waitFor(() => expect(result.view.getByText(/Escuchando/)).toBeTruthy());
    fireEvent.press(result.view.getByRole("button", { name: "Volver" }));
    recognition.resolve({ status: "recognized", transcript: "abrir solicitudes" });
    await act(async () => Promise.resolve());

    expect(result.onBack).toHaveBeenCalledTimes(1);
    expect(result.onOpenRequests).not.toHaveBeenCalled();
    expect(speechPort.stop).toHaveBeenCalledTimes(1);
  });

  it("executes local cancel even if stopping recognition rejects", async () => {
    const speechPort = {
      recognize: jest.fn(() => new Promise<SpeechRecognitionResult>(() => undefined)),
      stop: jest.fn().mockRejectedValue(new Error("stop unavailable")),
    };
    const result = setup(speechPort);
    fireEvent.press(result.view.getByRole("button", { name: "Usar comando de voz" }));
    fireEvent.press(result.view.getByRole("button", { name: "Cancelar" }));

    expect(result.onCancel).toHaveBeenCalledTimes(1);
    expect(result.onOpenRequests).not.toHaveBeenCalled();
    expect(result.onBack).not.toHaveBeenCalled();
  });

  it("stops from the voice control and ignores the late transcript", async () => {
    const recognition = deferred<SpeechRecognitionResult>();
    const speechPort = {
      recognize: jest.fn(() => recognition.promise),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    const result = setup(speechPort);
    fireEvent.press(result.view.getByRole("button", { name: "Usar comando de voz" }));
    fireEvent.press(result.view.getByRole("button", { name: "Detener reconocimiento" }));
    recognition.resolve({ status: "recognized", transcript: "abrir solicitudes" });
    await act(async () => Promise.resolve());

    expect(speechPort.stop).toHaveBeenCalledTimes(1);
    expect(result.onOpenRequests).not.toHaveBeenCalled();
  });

  it("does not navigate after recognition rejects or after unmount", async () => {
    const speechPort = {
      recognize: jest.fn().mockRejectedValue(new Error("native failure")),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    const result = setup(speechPort);
    fireEvent.press(result.view.getByRole("button", { name: "Usar comando de voz" }));
    await waitFor(() => expect(result.view.getByText(/Falló el reconocimiento/)).toBeTruthy());

    const recognition = deferred<SpeechRecognitionResult>();
    speechPort.recognize.mockReturnValueOnce(recognition.promise);
    fireEvent.press(result.view.getByRole("button", { name: "Usar comando de voz" }));
    result.view.unmount();
    recognition.resolve({ status: "recognized", transcript: "abrir solicitudes" });
    await act(async () => Promise.resolve());

    expect(result.onOpenRequests).not.toHaveBeenCalled();
    expect(result.onBack).not.toHaveBeenCalled();
    expect(result.onCancel).not.toHaveBeenCalled();
    expect(speechPort.stop).toHaveBeenCalled();
  });
});
