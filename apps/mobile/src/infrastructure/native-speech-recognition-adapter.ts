import type {
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionOptions,
  ExpoSpeechRecognitionResultEvent,
} from "expo-speech-recognition";
import { Platform } from "react-native";
import type { SpeechRecognitionPort, SpeechRecognitionResult } from "../application/speech-port";

type Subscription = { remove(): void };
type RecognitionSession = {
  readonly id: number;
  readonly resolve: (result: SpeechRecognitionResult) => void;
  subscriptions: Subscription[];
  result?: SpeechRecognitionResult;
  settled: boolean;
  stopTimeout?: ReturnType<typeof setTimeout>;
};

interface SpeechRecognitionSdk {
  requestPermissionsAsync(): Promise<{ granted: boolean }>;
  supportsOnDeviceRecognition(): boolean;
  isRecognitionAvailable(): boolean;
  getSupportedLocales(options: Record<string, never>): Promise<{ installedLocales: string[] }>;
  addListener(
    event: "result",
    listener: (event: ExpoSpeechRecognitionResultEvent) => void,
  ): Subscription;
  addListener(
    event: "error",
    listener: (event: ExpoSpeechRecognitionErrorEvent) => void,
  ): Subscription;
  addListener(event: "end", listener: () => void): Subscription;
  start(options: ExpoSpeechRecognitionOptions): void;
  abort(): void | Promise<void>;
}

function loadSpeechRecognitionSdk(): SpeechRecognitionSdk | undefined {
  try {
    return require("expo-speech-recognition").ExpoSpeechRecognitionModule as SpeechRecognitionSdk;
  } catch {
    return undefined;
  }
}

function chooseInstalledSpanishLocale(locales: string[]): string | undefined {
  return (
    locales.find((locale) => /^es[-_]cl$/i.test(locale)) ??
    locales.find((locale) => /^es[-_]es$/i.test(locale)) ??
    locales.find((locale) => /^es(?:[-_]|$)/i.test(locale))
  );
}

export function createNativeSpeechRecognitionAdapter(
  sdk?: SpeechRecognitionSdk,
  platform: Pick<typeof Platform, "OS" | "Version"> = Platform,
): SpeechRecognitionPort {
  let generation = 0;
  let pendingId: number | undefined;
  let activeSession: RecognitionSession | undefined;
  let nativeAbortFailed = false;

  function finish(id: number, result: SpeechRecognitionResult): void {
    if (activeSession?.id !== id) return;
    const session = activeSession;
    activeSession = undefined;
    if (session.stopTimeout) clearTimeout(session.stopTimeout);
    session.subscriptions.forEach((subscription) => subscription.remove());
    if (!session.settled) session.resolve(result);
  }

  function resolveSession(session: RecognitionSession, result: SpeechRecognitionResult) {
    if (session.settled) return;
    session.settled = true;
    session.resolve(result);
  }

  return {
    async recognize() {
      if (activeSession || pendingId !== undefined) return { status: "failed" };
      const id = ++generation;
      pendingId = id;
      const recognitionSdk = sdk ?? loadSpeechRecognitionSdk();
      if (!recognitionSdk || nativeAbortFailed) {
        pendingId = undefined;
        return { status: "unavailable" };
      }

      try {
        const permission = await recognitionSdk.requestPermissionsAsync();
        if (id !== generation) return { status: "stopped" };
        if (!permission.granted) return { status: "denied" };
        if (platform.OS === "android" && Number(platform.Version) < 33)
          return { status: "unavailable" };
        if (
          !recognitionSdk.supportsOnDeviceRecognition() ||
          !recognitionSdk.isRecognitionAvailable()
        )
          return { status: "unavailable" };

        const { installedLocales } = await recognitionSdk.getSupportedLocales({});
        if (id !== generation) return { status: "stopped" };
        const locale = chooseInstalledSpanishLocale(installedLocales);
        if (!locale) return { status: "unavailable" };

        return await new Promise<SpeechRecognitionResult>((resolve) => {
          const session: RecognitionSession = {
            id,
            resolve,
            subscriptions: [],
            settled: false,
          };
          activeSession = session;
          try {
            session.subscriptions.push(
              recognitionSdk.addListener("result", (event) => {
                if (session.settled || !event.isFinal) return;
                const transcript = event.results[0]?.transcript?.trim();
                session.result = transcript
                  ? { status: "recognized", transcript }
                  : { status: "silence" };
              }),
            );
            session.subscriptions.push(
              recognitionSdk.addListener("error", (event) => {
                if (session.settled) return;
                const status =
                  event.error === "not-allowed"
                    ? "denied"
                    : event.error === "aborted"
                      ? "stopped"
                      : event.error === "no-speech" || event.error === "speech-timeout"
                        ? "silence"
                        : event.error === "language-not-supported" ||
                            event.error === "service-not-allowed"
                          ? "unavailable"
                          : "failed";
                session.result = { status };
              }),
            );
            session.subscriptions.push(
              recognitionSdk.addListener("end", () =>
                finish(id, session.result ?? { status: "silence" }),
              ),
            );
            recognitionSdk.start({
              lang: locale,
              interimResults: false,
              continuous: false,
              maxAlternatives: 1,
              requiresOnDeviceRecognition: true,
              recordingOptions: { persist: false },
            });
          } catch {
            nativeAbortFailed = true;
            finish(id, { status: "failed" });
            try {
              void Promise.resolve(recognitionSdk.abort()).catch(() => {
                nativeAbortFailed = true;
              });
            } catch {
              nativeAbortFailed = true;
            }
          }
        });
      } catch {
        return id === generation ? { status: "failed" } : { status: "stopped" };
      } finally {
        if (pendingId === id) pendingId = undefined;
      }
    },

    async stop() {
      generation += 1;
      pendingId = undefined;
      const session = activeSession;
      if (!session) return;
      resolveSession(session, { status: "stopped" });
      try {
        await (sdk ?? loadSpeechRecognitionSdk())?.abort();
        if (activeSession === session) {
          if (session.stopTimeout) clearTimeout(session.stopTimeout);
          session.stopTimeout = setTimeout(() => {
            if (activeSession !== session) return;
            nativeAbortFailed = true;
            finish(session.id, { status: "failed" });
          }, 3000);
        }
      } catch {
        nativeAbortFailed = true;
        finish(session.id, { status: "failed" });
      }
    },
  };
}
