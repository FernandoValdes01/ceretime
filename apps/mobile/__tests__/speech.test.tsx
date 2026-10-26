import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, Button } from "react-native";
import * as NativeSpeech from "expo-speech";
import type { SpeechResult } from "@/application/speech-port";
import { createNativeSpeechAdapter } from "@/infrastructure/native-speech-adapter";
import {
  SpeechControls,
  StudentRequestSpeechControls,
} from "@/presentation/accessibility/speech-controls";
import { useSubmitStudentRequest } from "@/presentation/hooks/use-submit-student-request";
import type { StudentRequestSubmitter } from "@/application/student-area-port";
import { contrastRatio } from "@/presentation/accessibility/accessibility-color-palette";

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

  it("cancels voice discovery before playback starts", async () => {
    let resolveVoices: ((value: NativeSpeech.Voice[]) => void) | undefined;
    jest
      .mocked(NativeSpeech.getAvailableVoicesAsync)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveVoices = resolve)));
    const port = createNativeSpeechAdapter();
    const result = port.speak(testText);
    await port.stop();
    resolveVoices?.(voices);
    await expect(result).resolves.toEqual({ status: "stopped" });
    expect(NativeSpeech.speak).not.toHaveBeenCalled();
  });

  it("reports a failed native stop and never starts another utterance", async () => {
    jest.mocked(NativeSpeech.stop).mockRejectedValueOnce(new Error("native detail"));
    await expect(createNativeSpeechAdapter().speak(testText)).resolves.toEqual({
      status: "failed",
      reason: "speech-failed",
    });
    expect(NativeSpeech.speak).not.toHaveBeenCalled();
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

  it("does not let a stale screen reader query override a newer TalkBack event", async () => {
    let resolveInitialQuery: ((enabled: boolean) => void) | undefined;
    jest
      .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
      .mockReturnValue(new Promise((resolve) => (resolveInitialQuery = resolve)));
    const speechPort = { speak: jest.fn(), stop: jest.fn().mockResolvedValue(undefined) };
    const view = render(<SpeechControls speechPort={speechPort} text={testText} />);

    act(() => screenReaderChanged?.(true));
    await act(async () => resolveInitialQuery?.(false));

    expect(view.getByRole("button", { name: "Leer en voz alta" })).toBeDisabled();
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
    expect(view.getByText(testText)).toBeTruthy();
    expect(view.getByRole("button", { name: "Leer en voz alta" })).toBeEnabled();
  });

  it("cancels stale messages and ignores their delayed completion", async () => {
    let finishOldRead: ((value: SpeechResult) => void) | undefined;
    const speechPort = {
      speak: jest.fn(() => new Promise<SpeechResult>((resolve) => (finishOldRead = resolve))),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    const view = render(<SpeechControls speechPort={speechPort} text={testText} />);
    await waitFor(() => expect(view.getByRole("button")).toBeEnabled());
    fireEvent.press(view.getByRole("button"));
    expect(speechPort.speak).toHaveBeenCalledTimes(1);

    view.rerender(<SpeechControls speechPort={speechPort} text="Solicitud ficticia enviada." />);
    expect(speechPort.stop).toHaveBeenCalled();
    expect(view.queryByText(testText)).toBeNull();
    expect(speechPort.speak).toHaveBeenCalledTimes(1);
    await act(async () => finishOldRead?.({ status: "failed", reason: "speech-failed" }));
    expect(view.queryByText(/No se pudo reproducir/)).toBeNull();
    expect(view.getByRole("button", { name: "Leer en voz alta" })).toBeEnabled();
  });

  it("stops an active read when TalkBack turns on without starting a second voice", async () => {
    const speechPort = {
      speak: jest.fn(() => new Promise<SpeechResult>(() => {})),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    const view = render(<SpeechControls speechPort={speechPort} text={testText} />);
    await waitFor(() => expect(view.getByRole("button")).toBeEnabled());
    fireEvent.press(view.getByRole("button"));
    act(() => screenReaderChanged?.(true));
    expect(view.getByRole("button", { name: "Leer en voz alta" })).toBeDisabled();
    expect(speechPort.stop).toHaveBeenCalledTimes(1);
    expect(speechPort.speak).toHaveBeenCalledTimes(1);
    expect(view.getByText(testText)).toBeTruthy();
  });

  it("consumes real submission hook transitions without speaking automatically or exposing errors", async () => {
    let completeSubmission:
      | ((value: { requestId: string; receivedAt: string }) => void)
      | undefined;
    const submitter: StudentRequestSubmitter = {
      submitStudentRequest: jest.fn(() => new Promise((resolve) => (completeSubmission = resolve))),
    };
    const speechPort = {
      speak: jest.fn().mockResolvedValue({ status: "completed" }),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    function Consumer() {
      const submission = useSubmitStudentRequest(submitter);
      return (
        <>
          <Button
            title="Enviar ejemplo"
            onPress={() =>
              void submission.submit({
                needSummary: "Material ficticio.",
                expectedOutcome: "Leer material ficticio.",
                accessNeeds: [{ id: "writtenCommunication", label: "Comunicación escrita" }],
                generalAvailability: { preferredWeekdays: [1] },
                modalityPreference: "online",
                preferredAccessibleInformationChannel: "Correo accesible",
              })
            }
          />
          <StudentRequestSpeechControls speechPort={speechPort} submission={submission} />
        </>
      );
    }
    const view = render(<Consumer />);
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Leer en voz alta" })).toBeDisabled(),
    );
    fireEvent.press(view.getByText("Enviar ejemplo"));
    expect(view.getByText("Enviando solicitud ficticia.")).toBeTruthy();
    expect(speechPort.speak).not.toHaveBeenCalled();
    fireEvent.press(view.getByRole("button", { name: "Leer en voz alta" }));
    await waitFor(() =>
      expect(speechPort.speak).toHaveBeenCalledWith("Enviando solicitud ficticia."),
    );
    await act(async () =>
      completeSubmission?.({ requestId: "SOL-DEMO-60", receivedAt: "2026-10-25T12:00:00Z" }),
    );
    expect(view.getByText("Solicitud ficticia enviada. Referencia: SOL-DEMO-60.")).toBeTruthy();
    expect(speechPort.speak).toHaveBeenCalledTimes(1);
    fireEvent.press(view.getByRole("button", { name: "Leer en voz alta" }));
    await waitFor(() =>
      expect(speechPort.speak).toHaveBeenLastCalledWith(
        "Solicitud ficticia enviada. Referencia: SOL-DEMO-60.",
      ),
    );

    jest
      .mocked(submitter.submitStudentRequest)
      .mockRejectedValueOnce(new Error("detalle sensible"));
    fireEvent.press(view.getByText("Enviar ejemplo"));
    expect(
      await view.findByText("No pudimos enviar la solicitud ficticia. Puedes reintentar."),
    ).toBeTruthy();
    expect(view.queryByText(/detalle sensible/)).toBeNull();
    expect(view.queryByText(/SOL-DEMO-60/)).toBeNull();
  });

  it("keeps speech disabled when screen reader detection fails", async () => {
    jest
      .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
      .mockRejectedValueOnce(new Error("query failed"));
    const speechPort = { speak: jest.fn(), stop: jest.fn().mockResolvedValue(undefined) };
    const view = render(<SpeechControls speechPort={speechPort} text={testText} />);
    await act(async () => {});
    expect(view.getByRole("button")).toBeDisabled();
    expect(view.getByText(testText)).toBeTruthy();
    expect(speechPort.speak).not.toHaveBeenCalled();
  });

  it("ignores a failed stop from a previous message while the new message is speaking", async () => {
    let rejectStop: ((error: Error) => void) | undefined;
    const speechPort = {
      speak: jest.fn(() => new Promise<SpeechResult>(() => {})),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    const view = render(<SpeechControls speechPort={speechPort} text={testText} />);
    await waitFor(() => expect(view.getByRole("button")).toBeEnabled());
    fireEvent.press(view.getByRole("button"));
    speechPort.stop.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectStop = reject)),
    );
    fireEvent.press(view.getByRole("button", { name: "Detener lectura" }));
    view.rerender(<SpeechControls speechPort={speechPort} text="Mensaje vigente." />);
    fireEvent.press(view.getByRole("button", { name: "Leer en voz alta" }));
    await act(async () => rejectStop?.(new Error("late error")));
    expect(view.getByRole("button", { name: "Detener lectura" })).toBeEnabled();
    expect(view.queryByText(/No se pudo reproducir/)).toBeNull();
  });

  it("keeps readable active colors and a touch target without fixed text height", async () => {
    const speechPort = { speak: jest.fn(), stop: jest.fn().mockResolvedValue(undefined) };
    const view = render(<SpeechControls speechPort={speechPort} text={testText} />);
    await waitFor(() => expect(view.getByRole("button")).toBeEnabled());
    expect(view.getByRole("button")).toHaveStyle({ minHeight: 52, minWidth: 44 });
    expect(contrastRatio("#FFFFFF", "#246259")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#1B1C1C", "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });
});
