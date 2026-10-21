jest.mock("expo-speech-recognition", () => ({ ExpoSpeechRecognitionModule: {} }));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { waitFor } from "@testing-library/react-native";
import { createNativeSpeechRecognitionAdapter } from "../src/infrastructure/native-speech-recognition-adapter";

type EventName = "result" | "error" | "end";
type Listener = (event?: unknown) => void;

function createSdk(
  overrides: Partial<{
    granted: boolean;
    onDevice: boolean;
    available: boolean;
    locales: string[];
  }> = {},
) {
  const listeners = new Map<EventName, Listener[]>();
  const start = jest.fn();
  const abort = jest.fn();
  const sdk = {
    requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: overrides.granted ?? true }),
    supportsOnDeviceRecognition: jest.fn(() => overrides.onDevice ?? true),
    isRecognitionAvailable: jest.fn(() => overrides.available ?? true),
    getSupportedLocales: jest
      .fn()
      .mockResolvedValue({ installedLocales: overrides.locales ?? ["es-CL"] }),
    addListener: jest.fn((event: EventName, listener: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return {
        remove: jest.fn(() => {
          listeners.set(
            event,
            (listeners.get(event) ?? []).filter((item) => item !== listener),
          );
        }),
      };
    }),
    start,
    abort,
  };
  return {
    sdk,
    start,
    abort,
    emit(event: EventName, value?: unknown) {
      listeners.get(event)?.forEach((listener) => listener(value));
    },
  };
}

function createRecognition(sdk: ReturnType<typeof createSdk>["sdk"]) {
  return createNativeSpeechRecognitionAdapter(sdk, { OS: "ios", Version: "18" });
}

describe("createNativeSpeechRecognitionAdapter", () => {
  it("requires permission and an installed Spanish on-device model", async () => {
    const denied = createSdk({ granted: false });
    await expect(createRecognition(denied.sdk).recognize()).resolves.toEqual({ status: "denied" });
    expect(denied.start).not.toHaveBeenCalled();

    const missingModel = createSdk({ locales: ["en-US"] });
    await expect(createRecognition(missingModel.sdk).recognize()).resolves.toEqual({
      status: "unavailable",
    });
    expect(missingModel.start).not.toHaveBeenCalled();

    const noOfflineCapability = createSdk({ onDevice: false });
    await expect(createRecognition(noOfflineCapability.sdk).recognize()).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("starts a non-persisting on-device Spanish recognition session", async () => {
    const native = createSdk({ locales: ["es-ES", "es-CL"] });
    const recognition = createRecognition(native.sdk);
    const result = recognition.recognize();

    await waitFor(() => expect(native.start).toHaveBeenCalled());
    expect(native.start).toHaveBeenCalledWith({
      lang: "es-CL",
      interimResults: false,
      continuous: false,
      maxAlternatives: 1,
      requiresOnDeviceRecognition: true,
      recordingOptions: { persist: false },
    });
    native.emit("result", { isFinal: false, results: [{ transcript: "ignorado" }] });
    native.emit("result", { isFinal: true, results: [{ transcript: "  volver  " }] });
    native.emit("end");
    await expect(result).resolves.toEqual({ status: "recognized", transcript: "volver" });
  });

  it("returns silence when recognition ends without a final transcript", async () => {
    const native = createSdk();
    const result = createRecognition(native.sdk).recognize();
    await waitFor(() => expect(native.start).toHaveBeenCalled());
    native.emit("end");
    await expect(result).resolves.toEqual({ status: "silence" });
  });

  it("aborts and ignores late results after stop", async () => {
    const native = createSdk();
    const recognition = createRecognition(native.sdk);
    const result = recognition.recognize();

    await waitFor(() => expect(native.start).toHaveBeenCalled());
    await recognition.stop();
    native.emit("result", { isFinal: true, results: [{ transcript: "cancelar" }] });
    await expect(result).resolves.toEqual({ status: "stopped" });
    expect(native.abort).toHaveBeenCalledTimes(1);
    native.emit("end");
  });

  it("waits for end after a final result before releasing the native session", async () => {
    const native = createSdk();
    const recognition = createRecognition(native.sdk);
    const result = recognition.recognize();
    await waitFor(() => expect(native.start).toHaveBeenCalledTimes(1));
    native.emit("result", { isFinal: true, results: [{ transcript: "cancelar" }] });
    const nextResult = recognition.recognize();
    expect(await nextResult).toEqual({ status: "failed" });
    native.emit("end");
    await expect(result).resolves.toEqual({ status: "recognized", transcript: "cancelar" });

    const secondResult = recognition.recognize();
    await waitFor(() => expect(native.start).toHaveBeenCalledTimes(2));
    native.emit("end");
    await expect(secondResult).resolves.toEqual({ status: "silence" });
  });

  it.each([
    ["no-speech", "silence"],
    ["not-allowed", "denied"],
    ["service-not-allowed", "unavailable"],
    ["network", "failed"],
  ] as const)("maps %s and completes after end", async (error, status) => {
    const native = createSdk();
    const result = createRecognition(native.sdk).recognize();
    await waitFor(() => expect(native.start).toHaveBeenCalled());
    native.emit("error", { error, message: "sanitized test error" });
    native.emit("end");
    await expect(result).resolves.toEqual({ status });
  });

  it("fails closed after native abort throws", async () => {
    const native = createSdk();
    native.sdk.abort = jest.fn(() => {
      throw new Error("native abort failed");
    });
    const recognition = createRecognition(native.sdk);
    const result = recognition.recognize();
    await waitFor(() => expect(native.start).toHaveBeenCalled());
    await recognition.stop();
    await expect(result).resolves.toEqual({ status: "stopped" });
    await expect(recognition.recognize()).resolves.toEqual({ status: "unavailable" });
  });

  it("allows a later session after duplicate stops and the native end event", async () => {
    jest.useFakeTimers();
    const native = createSdk();
    const recognition = createRecognition(native.sdk);
    const result = recognition.recognize();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(native.start).toHaveBeenCalledTimes(1);

    await recognition.stop();
    await recognition.stop();
    native.emit("end");
    await expect(result).resolves.toEqual({ status: "stopped" });
    await jest.advanceTimersByTimeAsync(3000);

    const nextResult = recognition.recognize();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(native.start).toHaveBeenCalledTimes(2);
    native.emit("end");
    await expect(nextResult).resolves.toEqual({ status: "silence" });
    jest.useRealTimers();
  });

  it("cleans up when native start throws", async () => {
    const native = createSdk();
    native.start.mockImplementation(() => {
      throw new Error("native start failed");
    });

    await expect(createRecognition(native.sdk).recognize()).resolves.toEqual({ status: "failed" });
    expect(native.abort).toHaveBeenCalledTimes(1);
  });

  it("does not start if stop happens while permission is pending", async () => {
    let grantPermission!: (value: { granted: boolean }) => void;
    const native = createSdk();
    native.sdk.requestPermissionsAsync.mockImplementation(
      () => new Promise((resolve) => (grantPermission = resolve)),
    );
    const recognition = createRecognition(native.sdk);
    const result = recognition.recognize();

    await recognition.stop();
    grantPermission({ granted: true });
    await expect(result).resolves.toEqual({ status: "stopped" });
    expect(native.start).not.toHaveBeenCalled();
  });

  it("does not start if stop happens while checking installed locales", async () => {
    let resolveLocales!: (value: { installedLocales: string[] }) => void;
    const native = createSdk();
    native.sdk.getSupportedLocales.mockImplementation(
      () => new Promise((resolve) => (resolveLocales = resolve)),
    );
    const recognition = createRecognition(native.sdk);
    const result = recognition.recognize();

    await waitFor(() => expect(native.sdk.getSupportedLocales).toHaveBeenCalled());
    await recognition.stop();
    resolveLocales({ installedLocales: ["es-CL"] });
    await expect(result).resolves.toEqual({ status: "stopped" });
    expect(native.start).not.toHaveBeenCalled();
  });

  it("fails closed on Android versions that cannot guarantee on-device recognition", async () => {
    const native = createSdk();
    const recognition = createNativeSpeechRecognitionAdapter(native.sdk, {
      OS: "android",
      Version: 32,
    });

    await expect(recognition.recognize()).resolves.toEqual({ status: "unavailable" });
    expect(native.sdk.supportsOnDeviceRecognition).not.toHaveBeenCalled();
    expect(native.start).not.toHaveBeenCalled();
  });

  it("does not log recognized text in the patched Android dependency", () => {
    const source = readFileSync(
      resolve(
        __dirname,
        "../node_modules/expo-speech-recognition/android/src/main/java/expo/modules/speechrecognition/ExpoSpeechService.kt",
      ),
      "utf8",
    );

    expect(source).not.toMatch(/onResults\(\), results:/);
    expect(source).not.toMatch(/onPartialResults\(\), results:/);
    expect(source).not.toMatch(/onSegmentResults\(\), transcriptions:/);
  });
});
